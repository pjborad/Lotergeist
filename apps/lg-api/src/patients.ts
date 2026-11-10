import { audit, HttpError, todayIso, type Actor, type Ctx } from "./core";
import { daysBetween, DAY } from "./domain";
import { findDrug, INTERACTIONS, parseSig, type Drug } from "./drugs";

/**
 * Patients screen (plan 3.6) and the Refill & safety assistant (plan 6.5). Advisory only. Every profile view
 * is written to the audit log with the reason the user gave.
 */

export function searchPatients(ctx: Ctx, q: string) {
  const t = q.trim();
  if (t.length < 2) return { matches: [] };
  const digits = t.replace(/\D/g, "");
  const dobIso = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const rows = ctx.db.all<any>(
    `SELECT DISTINCT p.id, p.name, p.dob FROM patients p LEFT JOIN prescriptions r ON r.patient_id = p.id
     WHERE lower(p.name) LIKE lower(?) OR p.id = upper(?) OR p.dob = ? OR (? <> '' AND length(?) >= 4 AND replace(replace(replace(replace(p.phone,'(',''),')',''),'-',''),' ','') LIKE ?) OR (? <> '' AND r.rx LIKE ?)
     ORDER BY p.name LIMIT 12`,
    `%${t}%`, t, dobIso ? `${dobIso[3]}-${dobIso[1]!.padStart(2, "0")}-${dobIso[2]!.padStart(2, "0")}` : t, digits, digits, `%${digits}%`, digits, `${digits}%`);
  return { matches: rows.map((r) => ({ id: r.id, name: r.name, dob: r.dob })) };
}

interface MedRow { date: string; drug: string; sig: string; prescriber: string; lot: string; status: string; daysSupply: number | null; autoRefill: boolean; refillsLeft: number; source: "history" | "fill" }

function medRows(ctx: Ctx, patientId: string): MedRow[] {
  const hist = ctx.db.all<any>("SELECT * FROM med_history WHERE patient_id = ?", patientId).map((h): MedRow => ({
    date: h.filled_on, drug: h.drug, sig: h.sig, prescriber: h.prescriber, lot: h.lot ?? "", status: h.status, daysSupply: h.days_supply, autoRefill: !!h.auto_refill, refillsLeft: h.refills_left, source: "history"
  }));
  const fills = ctx.db.all<any>(
    `SELECT r.rx, r.drug, r.directions, r.prescriber, r.days_supply, r.refills, r.parent_rx, d.sold_at, d.filled_at, l.lot FROM dispenses d JOIN prescriptions r ON r.id = d.rx_id
     LEFT JOIN packages k ON k.id = d.package_id LEFT JOIN lots l ON l.id = k.lot_id WHERE r.patient_id = ? AND d.state = 'sold'`, patientId).map((f): MedRow => ({
    date: new Date(f.sold_at ?? f.filled_at).toISOString().slice(0, 10), drug: f.drug, sig: `${f.directions}${f.parent_rx ? " (changed by prescriber)" : ""}`, prescriber: f.prescriber, lot: f.lot ?? "",
    status: "Active", daysSupply: f.days_supply ?? null, autoRefill: false, refillsLeft: f.refills ?? 0, source: "fill"
  }));
  // Open orders are current medicines too ("past vs current"), shown without a lot until they are filled.
  const orders = ctx.db.all<any>("SELECT rx, drug, directions, prescriber, days_supply, refills FROM prescriptions WHERE patient_id = ? AND status NOT IN ('sold','replaced') AND review <> 'rejected'", patientId).map((o): MedRow => ({
    date: todayIso(ctx), drug: o.drug, sig: o.directions, prescriber: o.prescriber, lot: "", status: "Active", daysSupply: null, autoRefill: false, refillsLeft: o.refills ?? 0, source: "fill"
  }));
  // A new fill of the same drug replaces the older active entry.
  const all = [...orders, ...hist, ...fills].sort((a, b) => b.date.localeCompare(a.date) || (a.lot ? 1 : -1));
  const seenActive = new Set<string>();
  for (const m of all) {
    const id = findDrug(m.drug)?.id ?? m.drug;
    if (m.status !== "Active") continue;
    if (seenActive.has(id)) m.status = "Replaced"; else seenActive.add(id);
  }
  return all;
}

export interface SafetyFinding { title: string; body: string; kind: "Act" | "Monitor" | "Pass"; level: "warn" | "info" | "ok" }

export function safetyReview(ctx: Ctx, patientId: string): SafetyFinding[] {
  const today = todayIso(ctx);
  const p = ctx.db.get<any>("SELECT * FROM patients WHERE id = ?", patientId)!;
  const meds = medRows(ctx, patientId);
  const active = meds.filter((m) => m.status === "Active").map((m) => ({ m, d: findDrug(m.drug) })).filter((x): x is { m: MedRow; d: Drug } => !!x.d);
  const out: SafetyFinding[] = [];

  for (const a of active) {
    if (!a.m.daysSupply) continue;
    const late = daysBetween(a.m.date, today) - a.m.daysSupply;
    if (late > 14) out.push({ title: `${cap(a.d.generic)} refill is ${late} days late`, body: `Last ${a.m.daysSupply}-day fill ${fmt(a.m.date)}. Ask about missed doses or side effects; offer refill sync.`, kind: "Act", level: "warn" });
  }
  const seen = new Set<string>();
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const x = active[i]!.d, y = active[j]!.d;
    const r = INTERACTIONS.find((r) => (r.a === x.cls && r.b === y.cls) || (r.a === y.cls && r.b === x.cls));
    if (r && !seen.has(r.title)) { seen.add(r.title); out.push({ title: r.title, body: r.body, kind: r.severity === "needs_review" ? "Act" : "Monitor", level: r.severity === "needs_review" ? "warn" : "info" }); }
  }
  // Recent steroid course with an active insulin
  const steroid = meds.find((m) => findDrug(m.drug)?.cls === "corticosteroid" && daysBetween(m.date, today) < 120);
  if (steroid && active.some((a) => a.d.cls === "basal-insulin")) {
    const days = parseSig(steroid.sig).courseDays;
    out.push({ title: `${cap(findDrug(steroid.drug)!.generic)} course in ${new Date(steroid.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}`, body: `A ${days ?? "short"}-day steroid course (from ${fmt(steroid.date)}) can raise blood sugar. ${steroid.status === "Completed" ? "Finished, so no effect now; worth noting if prescribed again with insulin." : "Check sugars while on it."}`, kind: "Monitor", level: "info" });
  }
  if (active.some((a) => a.d.cls === "biguanide") && active.some((a) => a.d.cls === "basal-insulin")) out.push({ title: "Metformin with insulin", body: "Expected combination for type 2 diabetes. No change needed.", kind: "Pass", level: "ok" });

  const allergies = String(p.allergies || "").toLowerCase().split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  for (const al of allergies) {
    const conflict = active.find((a) => a.d.allergyClass && al.includes(a.d.allergyClass));
    const pastOther = meds.find((m) => findDrug(m.drug)?.cls === "fluoroquinolone");
    out.push(conflict
      ? { title: `${cap(al)} allergy conflict`, body: `${cap(conflict.d.generic)} is on the active list and is in the ${al} class. Contact the prescriber.`, kind: "Act", level: "warn" }
      : { title: `${cap(al)} allergy`, body: `No ${al}-class medicines on the active list.${pastOther ? ` ${cap(findDrug(pastOther.drug)!.generic)} in ${new Date(pastOther.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} was not a ${al}.` : ""}`, kind: "Pass", level: "ok" });
  }

  // Recall exposure: lots dispensed in the last 2 years vs confirmed lots of open recalls
  const lots = [...new Set(meds.filter((m) => m.lot && daysBetween(m.date, today) < 730).map((m) => m.lot))];
  const hits = lots.filter((l) => ctx.db.get("SELECT 1 FROM recall_lots rl JOIN recalls r ON r.id = rl.recall_id WHERE upper(rl.lot) = upper(?) AND rl.confirmed_at IS NOT NULL AND r.status <> 'closed'", l));
  out.push(hits.length
    ? { title: "Recall exposure", body: `Lot${hits.length > 1 ? "s" : ""} ${hits.join(", ")} dispensed to this patient ${hits.length > 1 ? "are" : "is"} on an active recall.`, kind: "Act", level: "warn" }
    : { title: "Recall exposure", body: `None of the ${lots.length} lots dispensed in the last 2 years are on an active recall.`, kind: "Pass", level: "ok" });
  const rank = { warn: 0, info: 1, ok: 2 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export function refills(ctx: Ctx, patientId: string) {
  const today = todayIso(ctx);
  return medRows(ctx, patientId).filter((m) => m.status === "Active" && m.daysSupply).map((m) => {
    const due = new Date(Date.parse(m.date + "T00:00:00Z") + m.daysSupply! * DAY).toISOString().slice(0, 10);
    const overdue = due < today;
    return {
      due, dueLabel: overdue ? "Overdue" : fmt(due, false), drug: m.drug.split(" · ")[0]!, overdue,
      note: overdue ? `Was due ${fmt(due, false)} · auto-refill ${m.autoRefill ? "on" : "off"}` : `${m.daysSupply}-day supply from ${fmt(m.date, false)}${m.autoRefill ? " · auto-refill on" : ""}`,
      left: `${m.refillsLeft} refill${m.refillsLeft === 1 ? "" : "s"} left`
    };
  }).sort((a, b) => a.due.localeCompare(b.due));
}

/** Suggest one pickup date that lines refills up: the earliest upcoming due date within 14 days. */
export function refillSync(ctx: Ctx, actor: Actor, patientId: string) {
  const list = refills(ctx, patientId);
  const upcoming = list.filter((r) => !r.overdue);
  if (list.length < 2) return { syncDate: null, items: [], note: "Not enough active medicines to sync." };
  const anchor = upcoming[0]?.due ?? todayIso(ctx);
  const items = list.filter((r) => r.overdue || daysBetween(anchor, r.due) <= 14).map((r) => r.drug);
  audit(ctx, actor, "patient.refill_sync.suggest", "patient", patientId, undefined, { anchor, items });
  return { syncDate: anchor, items, note: `Fill ${items.join(", ")} together on ${fmt(anchor, false)}. A pharmacist confirms with the patient first.` };
}

export function patientProfile(ctx: Ctx, actor: Actor, id: string, reason: string) {
  const p = ctx.db.get<any>("SELECT * FROM patients WHERE id = ?", id);
  if (!p) throw new HttpError(404, "Unknown patient.");
  if (reason.trim().length < 3) throw new HttpError(422, "Give a reason for opening this profile (it is logged).", "reason_required");
  audit(ctx, actor, "patient.view", "patient", id, undefined, undefined, reason.trim().slice(0, 200));
  const meds = medRows(ctx, id);
  const viewed = ctx.db.all<any>("SELECT at, user_name, reason FROM audit WHERE action = 'patient.view' AND entity_id = ? ORDER BY id DESC LIMIT 5", id);
  return {
    patient: {
      id: p.id, name: p.name, dob: p.dob, phone: p.phone || null, email: p.email || null, preferred: p.preferred, allergies: p.allergies ? String(p.allergies).split(/[,;]/).map((s: string) => s.trim()).filter(Boolean) : [],
      conditions: p.conditions ? String(p.conditions).split(/,\s*/) : [], consents: { sms: !!p.sms_consent && !p.sms_opt_out, email: !!p.email_consent, voice: !!p.voice_consent && !p.dnc }
    },
    safety: safetyReview(ctx, id),
    history: meds.map((m) => ({ date: m.date, drug: m.drug, sig: m.sig, prescriber: m.prescriber, lot: m.lot, status: m.status === "Active" && m.daysSupply && daysBetween(m.date, todayIso(ctx)) - m.daysSupply > 14 ? "Refill late" : m.status })),
    refills: refills(ctx, id),
    openOrders: ctx.db.all<any>("SELECT rx, drug, status, review FROM prescriptions WHERE patient_id = ? AND status NOT IN ('sold','replaced')", id),
    accessLog: viewed.map((v) => ({ at: v.at, by: v.user_name, reason: v.reason }))
  };
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
function fmt(iso: string, year = true) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: year ? "numeric" : undefined, timeZone: "UTC" });
}
