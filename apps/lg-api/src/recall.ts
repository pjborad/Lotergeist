import PDFDocument from "pdfkit";
import { autopsy } from "@bsrx/coroner";
import { createLlmFromEnv } from "@bsrx/coroner";
import { normalizeLot } from "@bsrx/gs1";
import { OpenFdaClient, recordFromText, type RecallRecord } from "@bsrx/summoner";
import path from "node:path";
import { audit, emit, HttpError, lotEvent, type Actor, type Ctx } from "./core";
import { ndcFromAny, ndc11Pretty } from "./domain";

const CONFIRM_AT = 0.95;
const RECALL_NO = /\b([A-Z])-(\d{3,4})-(\d{4})\b/;
const MONTH = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

let client: OpenFdaClient | null = null;
const openfda = (ctx: Ctx) => (client ??= new OpenFdaClient({ apiKey: ctx.cfg.openfdaKey, fixtureDir: path.join(ctx.cfg.fixturesDir, "recalls") }));

const needPharmacist = (actor: Actor) => {
  if (actor.role !== "pharmacist") throw new HttpError(403, "Only a pharmacist can run a recall.", "forbidden");
};

// ------------------------------------------------------------------ lookup + extraction

export interface RecallLotView {
  lot: string; ndc10: string; expiry: string; confidence: number; source: string; confirmed: boolean; needsConfirm: boolean; why: string;
  received: number; onShelf: number; dispensed: number; firstReceived: number | null;
}
export interface RecallView {
  id: string; step: string; status: string; classification: string; level: string; reason: string; firm: string; initiated: string; product: string;
  source: string; cached: boolean; lots: RecallLotView[]; warnings: string[]; faxLots: string[];
}

function levelOf(raw: any, reason: string): string {
  if (raw?.recall_level) return String(raw.recall_level);
  return /consumer/i.test(`${raw?.distribution_pattern ?? ""} ${reason}`) ? "Consumer level" : "";
}
const isoOf = (yyyymmdd: string) => (/^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6)}` : yyyymmdd);

/** Read a recall by FDA number (openFDA live, fixtures as fallback) or from fax text, extract its lots, store everything. */
export async function lookupRecall(ctx: Ctx, actor: Actor | null, input: { number?: string; text?: string }, opts: { autoConfirm: boolean }): Promise<RecallView> {
  if (actor) needPharmacist(actor);
  const text = input.text?.trim();
  let number = input.number?.trim().toUpperCase();
  if (!number && text) number = RECALL_NO.exec(text.toUpperCase().replace(/[OQ](?=\d{2,3}-)/g, "0"))?.[0];
  let rec: RecallRecord | undefined;
  let source = "openfda";
  if (number) {
    if (!RECALL_NO.test(number)) throw new HttpError(422, "A recall number looks like D-0417-2026.");
    const r = await openfda(ctx).fetchByNumber(number);
    rec = r.records[0];
    source = rec?.cached ? "fixture" : "openfda";
    if (!rec && !text) throw new HttpError(404, `No recall ${number} on openFDA or in the demo fixtures.`);
  }
  if (!rec && text) { rec = recordFromText(text); source = "fax"; }
  if (!rec) throw new HttpError(422, "Enter an FDA recall number or upload the fax.");

  const id = rec.recall_number;
  const existing = ctx.db.get<{ status: string }>("SELECT status FROM recalls WHERE id = ?", id);
  const raw = rec.raw as any;
  const initiated = isoOf(String(raw?.recall_initiation_date ?? rec.report_date ?? ""));
  if (!existing) {
    ctx.db.run(
      `INSERT INTO recalls (id, step, status, classification, level, reason, firm, initiated, product, code_info, product_description, raw_json, source, fax_text, created_at, created_by, cached)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, "review", "new", rec.classification, levelOf(raw, rec.reason_for_recall), rec.reason_for_recall, rec.recalling_firm, initiated, rec.product_description.split(",")[0] ?? rec.product_description,
      rec.code_info, rec.product_description, JSON.stringify(rec.raw), source, text ?? null, ctx.now(), actor?.name ?? "system", rec.cached ? 1 : 0);
    audit(ctx, actor, "recall.lookup", "recall", id, undefined, { source, number });
    emit(ctx, "recall.opened", { recallId: id, source });
  } else if (text) {
    ctx.db.run("UPDATE recalls SET fax_text = ? WHERE id = ?", text, id);
  }

  // Extraction (regex first, optional LLM second). It can only return strings found in the source text (COR-3).
  const a = await autopsy(`${rec.product_description}\n${rec.code_info}`, { llm: createLlmFromEnv() });
  const ndc = a.ndcs[0] ? ndcFromAny(a.ndcs[0].value)?.ndc11 ?? "" : "";
  for (const l of a.lots) {
    ctx.db.run("INSERT OR IGNORE INTO recall_lots (recall_id, lot, ndc11, expiry, confidence, source) VALUES (?,?,?,?,?,?)", id, l.value, ndc, l.expiry ?? "", l.confidence, l.source);
  }
  // Cross-check against the fax text: a lot on the fax that FDA's record lacks is added, unconfirmed, for the pharmacist to judge.
  let faxLots: string[] = [];
  if (text && source !== "fax") {
    const fx = await autopsy(text, { llm: null });
    faxLots = fx.lots.map((l) => l.value);
    for (const l of fx.lots) ctx.db.run("INSERT OR IGNORE INTO recall_lots (recall_id, lot, ndc11, expiry, confidence, source) VALUES (?,?,?,?,?,?)", id, l.value, ndc, l.expiry ?? "", Math.min(l.confidence, 0.9), "fax");
  }

  if (opts.autoConfirm && actor) {
    // Spec: lots under 0.95 confidence, or with no expiry, need a pharmacist's own confirmation.
    ctx.db.run("UPDATE recall_lots SET confirmed_by = ?, confirmed_at = ? WHERE recall_id = ? AND confirmed_at IS NULL AND confidence >= ? AND expiry <> ''", `${actor.name} (auto, ≥0.95)`, ctx.now(), id, CONFIRM_AT - 1e-9);
    if (ctx.db.get("SELECT 1 FROM recall_lots WHERE recall_id = ? AND confirmed_at IS NOT NULL", id)) quarantineRecalled(ctx, actor, id);
    ctx.db.run("UPDATE recalls SET status = CASE WHEN status = 'new' THEN 'reviewing' ELSE status END, step = CASE WHEN step IN ('lookup','review') THEN 'impact' ELSE step END WHERE id = ?", id);
  }
  return recallView(ctx, id, faxLots);
}

export function recallView(ctx: Ctx, id: string, faxLots: string[] = []): RecallView {
  const r = ctx.db.get<any>("SELECT * FROM recalls WHERE id = ?", id);
  if (!r) throw new HttpError(404, "Unknown recall.");
  const lots = ctx.db.all<any>("SELECT * FROM recall_lots WHERE recall_id = ? ORDER BY id", id).map((l): RecallLotView => {
    const c = lotCounts(ctx, l.lot, l.ndc11);
    const confirmed = !!l.confirmed_at;
    const needsConfirm = !confirmed;
    return {
      lot: l.lot, ndc10: l.ndc11 ? prettyNdc10(ctx, l.ndc11) : "", expiry: l.expiry, confidence: l.confidence, source: l.source, confirmed, needsConfirm,
      why: needsConfirm ? (l.confidence < CONFIRM_AT ? `Confidence ${l.confidence.toFixed(2)} is below ${CONFIRM_AT}` : !l.expiry ? "No expiry in the notice" : "Waiting for the pharmacist") : "", ...c
    };
  });
  const warnings: string[] = [];
  if (r.source === "fixture") warnings.push("openFDA did not answer for this number: showing the cached demo record.");
  return { id, step: r.step, status: r.status, classification: r.classification, level: r.level, reason: r.reason, firm: r.firm, initiated: r.initiated, product: r.product_description || r.product, source: r.source, cached: !!r.cached, lots, warnings, faxLots };
}

function prettyNdc10(ctx: Ctx, ndc11: string) {
  return ctx.db.get<{ ndc10: string }>("SELECT ndc10 FROM products WHERE ndc11 = ?", ndc11)?.ndc10 ?? ndc11Pretty(ndc11);
}

function lotsMatching(ctx: Ctx, lot: string, ndc11: string) {
  return ctx.db.all<{ id: number }>("SELECT id FROM lots WHERE upper(lot) = upper(?) AND (? = '' OR ndc11 = ?)", lot, ndc11 ?? "", ndc11 ?? "");
}

function lotCounts(ctx: Ctx, lot: string, ndc11: string) {
  const ids = lotsMatching(ctx, lot, ndc11).map((x) => x.id);
  if (!ids.length) return { received: 0, onShelf: 0, dispensed: 0, firstReceived: null as number | null };
  const m = ids.map(() => "?").join(",");
  const n = (where: string) => ctx.db.get<{ n: number }>(`SELECT count(*) AS n FROM packages WHERE lot_id IN (${m}) AND ${where}`, ...ids)!.n;
  const first = ctx.db.get<{ t: number | null }>(`SELECT min(received_at) AS t FROM packages WHERE lot_id IN (${m}) AND status <> 'pending_putaway'`, ...ids)!.t;
  return { received: n("status <> 'pending_putaway'"), onShelf: n("status IN ('on_shelf','quarantined')"), dispensed: n("status = 'dispensed'"), firstReceived: first };
}

export function confirmRecallLot(ctx: Ctx, actor: Actor, recallId: string, lot: string): RecallView {
  needPharmacist(actor);
  const res = ctx.db.run("UPDATE recall_lots SET confirmed_by = ?, confirmed_at = ? WHERE recall_id = ? AND upper(lot) = upper(?) AND confirmed_at IS NULL", actor.name, ctx.now(), recallId, lot);
  if (!res.changes) throw new HttpError(404, "That lot is not waiting for confirmation.");
  audit(ctx, actor, "recall.confirm_lot", "recall", recallId, undefined, { lot });
  quarantineRecalled(ctx, actor, recallId);
  ctx.db.run("UPDATE recalls SET status = 'reviewing', step = 'impact' WHERE id = ? AND status = 'new'", recallId);
  return recallView(ctx, recallId);
}

/** Auto-quarantine: every on-shelf package of a confirmed lot moves to Q-1. Fills waiting at the counter go back to "To fill". */
export function quarantineRecalled(ctx: Ctx, actor: Actor | null, recallId: string): number {
  let moved = 0;
  const who = actor?.name ?? "System · recall";
  for (const rl of ctx.db.all<any>("SELECT * FROM recall_lots WHERE recall_id = ? AND confirmed_at IS NOT NULL", recallId)) {
    for (const { id } of lotsMatching(ctx, rl.lot, rl.ndc11)) {
      ctx.db.run("UPDATE lots SET status = 'recalled' WHERE id = ?", id);
      // prescriptions filled but not yet picked up: pull the package back, send the Rx back to the bench
      for (const d of ctx.db.all<any>("SELECT d.id, d.rx_id, d.package_id FROM dispenses d JOIN packages k ON k.id = d.package_id WHERE k.lot_id = ? AND d.state IN ('filled','verified')", id)) {
        ctx.db.run("UPDATE dispenses SET state = 'sent_back' WHERE id = ?", d.id);
        ctx.db.run("UPDATE prescriptions SET status = 'to_fill' WHERE id = ?", d.rx_id);
        ctx.db.run("UPDATE packages SET status = 'on_shelf' WHERE id = ?", d.package_id);
      }
      const n = ctx.db.run("UPDATE packages SET status = 'quarantined', location = 'Quarantine Q-1', zone = 'quarantine' WHERE lot_id = ? AND status = 'on_shelf'", id);
      if (n.changes) {
        moved += Number(n.changes);
        lotEvent(ctx, "Quarantined", id, who, `${n.changes} units · recall ${recallId}`);
      }
    }
  }
  if (moved) { audit(ctx, actor, "recall.quarantine", "recall", recallId, undefined, { units: moved }); emit(ctx, "recall.matched", { recallId, unitsQuarantined: moved }); }
  return moved;
}

// ------------------------------------------------------------------ impact

export type Channel = "Text" | "Email" | "Call only";
export interface ImpactPatient { name: string; id: string; rx: string; lot: string; sold: string; soldAt: number; channels: Channel[]; drug: string }
export interface Impact {
  recallId: string; unitsHeld: number; location: string; patientCount: number; textCount: number; emailCount: number; callCount: number;
  messageCount: number; soldRange: string; patients: ImpactPatient[]; willCallPulled: number; unconfirmed: number;
}

export function channelsFor(p: { phone: string; email: string; sms_consent: number; email_consent: number; sms_opt_out: number }): Channel[] {
  const ch: Channel[] = [];
  if (p.phone && p.sms_consent && !p.sms_opt_out) ch.push("Text");
  if (p.email && p.email_consent) ch.push("Email");
  return ch.length ? ch : ["Call only"];
}

/** Patients found = distinct patients on the sold dispenses of the confirmed recalled lots. */
export function recallImpact(ctx: Ctx, recallId: string, opts: { includeUnconfirmed?: boolean } = {}): Impact {
  const where = opts.includeUnconfirmed ? "" : "AND confirmed_at IS NOT NULL";
  const rls = ctx.db.all<any>(`SELECT * FROM recall_lots WHERE recall_id = ? ${where}`, recallId);
  const lotIds = rls.flatMap((rl) => lotsMatching(ctx, rl.lot, rl.ndc11).map((x) => x.id));
  const rows: ImpactPatient[] = [];
  let held = 0;
  if (lotIds.length) {
    const m = lotIds.map(() => "?").join(",");
    held = ctx.db.get<{ n: number }>(`SELECT count(*) AS n FROM packages WHERE lot_id IN (${m}) AND status IN ('on_shelf','quarantined')`, ...lotIds)!.n;
    for (const d of ctx.db.all<any>(
      `SELECT d.sold_at, d.filled_at, r.rx, r.drug, l.lot, p.id AS pid, p.name, p.phone, p.email, p.sms_consent, p.email_consent, p.sms_opt_out
       FROM dispenses d JOIN packages k ON k.id = d.package_id JOIN lots l ON l.id = k.lot_id JOIN prescriptions r ON r.id = d.rx_id JOIN patients p ON p.id = r.patient_id
       WHERE k.lot_id IN (${m}) AND d.state = 'sold' ORDER BY d.sold_at, r.rx`, ...lotIds)) {
      const at = d.sold_at ?? d.filled_at;
      rows.push({ name: d.name, id: d.pid, rx: d.rx, lot: d.lot, sold: MONTH(at), soldAt: at, channels: channelsFor(d), drug: d.drug });
    }
  }
  const byPatient = new Map<string, ImpactPatient>();
  for (const r of rows) if (!byPatient.has(r.id)) byPatient.set(r.id, r);
  const uniq = [...byPatient.values()];
  const text = uniq.filter((p) => p.channels.includes("Text")).length;
  const email = uniq.filter((p) => p.channels.includes("Email")).length;
  const times = rows.map((r) => r.soldAt);
  const pulled = ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM lot_events WHERE kind = 'Released' AND note LIKE ?", `%${recallId}%`)!.n;
  return {
    recallId, unitsHeld: held, location: "Quarantine Q-1", patientCount: uniq.length, textCount: text, emailCount: email,
    callCount: uniq.filter((p) => p.channels.includes("Call only")).length, messageCount: text + email,
    soldRange: times.length ? `${MONTH(Math.min(...times))} – ${MONTH(Math.max(...times))}` : "",
    patients: rows, willCallPulled: pulled, unconfirmed: ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM recall_lots WHERE recall_id = ? AND confirmed_at IS NULL", recallId)!.n
  };
}

// ------------------------------------------------------------------ messages

export const PHARMACY_PHONE = "(555) 010-2200";
export const DEFAULT_SMS = `Elm Street Pharmacy: Hi {first_name}, a medicine you picked up on {sold_date} is part of a safety recall. Please don't use it. Call ${PHARMACY_PHONE} for a free replacement.`;
export const DEFAULT_EMAIL_SUBJECT = "Important: a medicine you received has been recalled";
export const DEFAULT_EMAIL_BODY = `Dear {first_name},

On {sold_date} you picked up {drug_name} (Rx {rx_number}) from Elm Street Pharmacy. The maker has recalled this batch because it may not be sterile.

Please do not use any remaining doses. Bring them to the pharmacy, or call us at ${PHARMACY_PHONE}. We will replace your medicine at no cost and answer any questions.

J. Rivera, PharmD`;

/** GSM-7 messages hold 160 characters in one segment (153 each when joined); anything else falls back to UCS-2 (70 / 67). */
export function smsSegments(text: string): { segments: number; chars: number; unicode: boolean } {
  const unicode = /[^\x20-\x7e\n]/.test(text);
  const single = unicode ? 70 : 160, multi = unicode ? 67 : 153;
  const chars = text.length;
  return { segments: chars <= single ? 1 : Math.ceil(chars / multi), chars, unicode };
}

export function merge(tpl: string, f: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in f ? f[k]! : m));
}

export function messageDraft(ctx: Ctx, recallId: string) {
  const imp = recallImpact(ctx, recallId);
  const sample = imp.patients.find((p) => p.channels.includes("Text")) ?? imp.patients[0];
  const fields = sample ? { first_name: sample.name.split(" ")[0]!, sold_date: sample.sold, drug_name: sample.drug, rx_number: sample.rx, pharmacy_phone: PHARMACY_PHONE } : { first_name: "Maria", sold_date: "Oct 9", drug_name: "your medicine", rx_number: "0000000", pharmacy_phone: PHARMACY_PHONE };
  return { sms: DEFAULT_SMS, emailSubject: DEFAULT_EMAIL_SUBJECT, emailBody: DEFAULT_EMAIL_BODY, previewName: sample?.name ?? "Maria Alvarez", fields, smsCount: imp.textCount, emailCount: imp.emailCount, callCount: imp.callCount };
}

export interface Templates { sms: string; emailSubject: string; emailBody: string }

export function sendNotifications(ctx: Ctx, actor: Actor, recallId: string, tpl: Templates, attested: boolean) {
  needPharmacist(actor);
  const r = ctx.db.get<any>("SELECT * FROM recalls WHERE id = ?", recallId);
  if (!r) throw new HttpError(404, "Unknown recall.");
  if (!attested) throw new HttpError(422, "The pharmacist must tick the attestation before anything is sent.", "attest");
  if (r.status === "notified" || r.status === "closed") throw new HttpError(409, "Messages for this recall were already sent.", "already_sent");
  const imp = recallImpact(ctx, recallId);
  if (imp.unconfirmed > 0) throw new HttpError(409, `${imp.unconfirmed} lot(s) still need a pharmacist's confirmation before messages can go out.`, "unconfirmed_lots");
  if (!imp.patients.length) throw new HttpError(409, "No patients are linked to these lots.", "no_patients");
  if (!/\(\d{3}\) \d{3}-\d{4}/.test(tpl.sms)) throw new HttpError(422, "The text must include the pharmacy phone number.", "template");
  const sms = /\bSTOP\b/i.test(tpl.sms) ? tpl.sms : `${tpl.sms.trim()} Reply STOP to opt out.`;
  const version = (ctx.db.get<{ v: number | null }>("SELECT max(template_version) AS v FROM notifications WHERE recall_id = ?", recallId)?.v ?? 0) + 1;

  const first = new Map<string, ImpactPatient>();
  for (const p of imp.patients) if (!first.has(p.id)) first.set(p.id, p);
  const calls: ImpactPatient[] = [];
  let sent = 0;
  for (const p of first.values()) {
    // Consent is checked now, at send time, not when the recall was opened.
    const pat = ctx.db.get<any>("SELECT * FROM patients WHERE id = ?", p.id)!;
    const ch = channelsFor(pat);
    const f = { first_name: p.name.split(" ")[0]!, sold_date: p.sold, drug_name: p.drug, rx_number: p.rx, pharmacy_phone: PHARMACY_PHONE };
    if (ch.includes("Call only")) { calls.push(p); continue; }
    const mk = (channel: "sms" | "email", body: string, subject: string | null) =>
      Number(ctx.db.run("INSERT INTO notifications (recall_id, patient_id, rx, channel, template_version, merged_text, subject, status, queued_at) VALUES (?,?,?,?,?,?,?,?,?)", recallId, p.id, p.rx, channel, version, body, subject, "queued", ctx.now()).lastInsertRowid);
    if (ch.includes("Text")) {
      const body = merge(sms, f);
      const id = mk("sms", body, null);
      ctx.notify.send({ channel: "sms", to: pat.phone, body, notificationId: id });
      sent++;
    }
    if (ch.includes("Email")) {
      const body = merge(tpl.emailBody, f), subject = merge(tpl.emailSubject, f);
      const id = mk("email", body, subject);
      ctx.notify.send({ channel: "email", to: pat.email, subject, body, notificationId: id });
      sent++;
    }
  }
  ctx.db.run("UPDATE recalls SET status = 'notified', step = 'done' WHERE id = ?", recallId);
  audit(ctx, actor, "recall.notify", "recall", recallId, undefined, { sent, callList: calls.length, templateVersion: version });
  return { sent, callList: calls.length };
}

export function recallResults(ctx: Ctx, recallId: string) {
  const r = ctx.db.get<any>("SELECT * FROM recalls WHERE id = ?", recallId);
  if (!r) throw new HttpError(404, "Unknown recall.");
  const n = (channel: string, status?: string) => ctx.db.get<{ n: number }>(`SELECT count(*) AS n FROM notifications WHERE recall_id = ? AND channel = ? ${status ? "AND status = ?" : ""}`, ...(status ? [recallId, channel, status] : [recallId, channel]))!.n;
  const imp = recallImpact(ctx, recallId);
  const call = imp.patients.filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i && p.channels.includes("Call only"))
    .map((p) => ({ name: p.name, id: p.id, rx: p.rx, phone: ctx.db.get<{ phone: string }>("SELECT phone FROM patients WHERE id = ?", p.id)?.phone ?? "" }));
  const actions = ctx.db.all<any>("SELECT kind, payload, at, by FROM recall_actions WHERE recall_id = ? ORDER BY id", recallId).map((a) => ({ kind: a.kind, payload: JSON.parse(a.payload || "{}"), at: a.at, by: a.by }));
  const sentRow = ctx.db.get<{ at: number | null; by: string | null }>("SELECT max(queued_at) AS at, NULL AS by FROM notifications WHERE recall_id = ?", recallId);
  const who = ctx.db.get<{ user_name: string }>("SELECT user_name FROM audit WHERE action = 'recall.notify' AND entity_id = ? ORDER BY id DESC LIMIT 1", recallId)?.user_name ?? "";
  return {
    recallId, status: r.status, sentAt: sentRow?.at ?? null, sentBy: who,
    sms: { total: n("sms"), delivered: n("sms", "delivered"), sent: n("sms", "sent"), failed: n("sms", "failed") },
    email: { total: n("email"), sent: n("email", "sent") + n("email", "delivered") },
    callList: call, quarantined: imp.unitsHeld, location: imp.location, actions
  };
}

export function scheduleReturn(ctx: Ctx, actor: Actor, recallId: string) {
  needPharmacist(actor);
  const units = recallImpact(ctx, recallId).unitsHeld;
  const when = new Date(ctx.now() + 86_400_000).toISOString().slice(0, 10);
  ctx.db.run("UPDATE packages SET location = 'RTV-1', zone = 'rtv' WHERE status = 'quarantined' AND lot_id IN (SELECT l.id FROM lots l JOIN recall_lots rl ON upper(rl.lot) = upper(l.lot) WHERE rl.recall_id = ? AND rl.confirmed_at IS NOT NULL)", recallId);
  ctx.db.run("INSERT INTO recall_actions (recall_id, kind, payload, at, by) VALUES (?,?,?,?,?)", recallId, "return_pickup", JSON.stringify({ units, pickup: `${when} 10:00`, to: "Reverse distributor (sandbox)" }), ctx.now(), actor.name);
  audit(ctx, actor, "recall.return_pickup", "recall", recallId, undefined, { units, when });
  return { units, pickup: `${when} 10:00` };
}

export function respondToManufacturer(ctx: Ctx, actor: Actor, recallId: string) {
  needPharmacist(actor);
  const r = ctx.db.get<any>("SELECT * FROM recalls WHERE id = ?", recallId)!;
  const imp = recallImpact(ctx, recallId);
  const body = `Recall ${recallId} response from Elm Street Pharmacy · Store 7\n\nUnits found on shelf and quarantined: ${imp.unitsHeld}\nPatients who received the product: ${imp.patientCount}\nPatients notified: ${imp.messageCount} messages, ${imp.callCount} on the phone list\n\nJ. Rivera, PharmD`;
  const id = Number(ctx.db.run("INSERT INTO outbox (channel, to_addr, subject, body, status, created_at, provider) VALUES (?,?,?,?,?,?,?)", "email", `recalls@${r.firm.toLowerCase().replace(/[^a-z]+/g, "")}.example.com`, `Response to recall ${recallId}`, body, "sent", ctx.now(), "sandbox").lastInsertRowid);
  ctx.db.run("INSERT INTO recall_actions (recall_id, kind, payload, at, by) VALUES (?,?,?,?,?)", recallId, "manufacturer_response", JSON.stringify({ outbox: id }), ctx.now(), actor.name);
  audit(ctx, actor, "recall.manufacturer_response", "recall", recallId);
  return { outboxId: id };
}

export function closeRecall(ctx: Ctx, actor: Actor, recallId: string) {
  needPharmacist(actor);
  ctx.db.run("UPDATE recalls SET status = 'closed', step = 'done' WHERE id = ?", recallId);
  audit(ctx, actor, "recall.close", "recall", recallId);
}

export function listRecalls(ctx: Ctx) {
  return ctx.db.all<any>("SELECT id, status, classification, product, firm, created_at FROM recalls ORDER BY created_at DESC").map((r) => ({ ...r, impact: recallImpact(ctx, r.id, { includeUnconfirmed: true }) }));
}

// ------------------------------------------------------------------ audit report (PDF)

export function auditReport(ctx: Ctx, recallId: string): Promise<Buffer> {
  const r = ctx.db.get<any>("SELECT * FROM recalls WHERE id = ?", recallId);
  if (!r) throw new HttpError(404, "Unknown recall.");
  const view = recallView(ctx, recallId);
  const imp = recallImpact(ctx, recallId);
  const res = recallResults(ctx, recallId);
  const doc = new PDFDocument({ size: "LETTER", margin: 48, info: { Title: `Recall audit report ${recallId}`, Producer: "Lotergeist (synthetic demo data)" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.font("Helvetica-Bold").fontSize(18).text(`Recall audit report · ${recallId}`);
  doc.font("Helvetica").fontSize(9).fillColor("#666").text("Elm Street Pharmacy · Store 7 · synthetic data, not for clinical use");
  doc.moveDown(0.8).fillColor("#000").fontSize(11);
  doc.text(`${view.classification} · ${view.level || "level not stated"} · initiated ${view.initiated}`);
  doc.text(`Product: ${view.product}`).text(`Firm: ${view.firm}`).text(`Reason: ${view.reason}`);
  doc.moveDown().font("Helvetica-Bold").text("Lots");
  doc.font("Helvetica").fontSize(10);
  for (const l of view.lots) doc.text(`${l.lot}  ·  exp ${l.expiry || "n/a"}  ·  confidence ${l.confidence.toFixed(2)} (${l.source})  ·  received ${l.received}, on shelf ${l.onShelf}, dispensed ${l.dispensed}  ·  ${l.confirmed ? "confirmed" : "NOT confirmed"}`);
  doc.moveDown().font("Helvetica-Bold").fontSize(11).text(`Quarantined: ${imp.unitsHeld} units in ${imp.location}`);
  doc.moveDown().text(`Patients (${imp.patientCount})`).font("Helvetica").fontSize(9);
  for (const p of imp.patients) doc.text(`${p.name} (${p.id}) · Rx ${p.rx} · lot ${p.lot} · sold ${p.sold} · ${p.channels.join(", ")}`);
  doc.moveDown().font("Helvetica-Bold").fontSize(11).text(`Messages: ${res.sms.total} text (${res.sms.delivered} delivered), ${res.email.total} email, ${res.callList.length} on the call list`);
  doc.font("Helvetica").fontSize(9);
  for (const n of ctx.db.all<any>("SELECT n.*, p.name FROM notifications n JOIN patients p ON p.id = n.patient_id WHERE n.recall_id = ? ORDER BY n.id", recallId)) doc.text(`${n.channel.toUpperCase()} to ${n.name} · ${n.status} · v${n.template_version}`);
  doc.moveDown().font("Helvetica-Bold").fontSize(11).text("Audit trail");
  doc.font("Helvetica").fontSize(8);
  for (const a of ctx.db.all<any>("SELECT * FROM audit WHERE entity_id = ? OR action LIKE 'recall.%' ORDER BY id DESC LIMIT 60", recallId).reverse()) doc.text(`${new Date(a.at).toISOString()}  ${a.user_name}  ${a.action}  ${a.workstation}`);
  doc.end();
  return done;
}

export { normalizeLot };
