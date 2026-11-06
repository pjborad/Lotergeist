import fs from "node:fs";
import path from "node:path";
import { autopsy } from "@bsrx/coroner";
import { exhume, replay, type DispenseRow, type RpaStep } from "@bsrx/grave-robber";
import { classRoman, type RecallRecord } from "@bsrx/summoner";
import { ndc10ToNdc11, ndcToGtin14Candidates, normalizeLot, parseNdc } from "@bsrx/gs1";
import { buildBins, checkShortage, draftOutreach } from "@bsrx/undertaker";
import type { Ctx } from "./ctx";
import { planHearseForRecalls } from "./hearse";

const now = () => Date.now();

// ---------------------------------------------------------------- Summoner + Coroner

/** SUM-1/SUM-2: store a recall, then let the Coroner read it (COR-1). */
export async function summonRecord(ctx: Ctx, rec: RecallRecord, opts: { demo?: boolean } = {}): Promise<string> {
  const id = rec.recall_number;
  const existing = ctx.db.get("SELECT id FROM recalls WHERE id = ?", id);
  if (existing) return id;
  ctx.db.run(
    `INSERT INTO recalls (id, recall_number, classification, status, product_description, code_info, reason, firm, report_date, raw_json, cached, demo, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, rec.recall_number, rec.classification, "summoned", rec.product_description, rec.code_info, rec.reason_for_recall,
    rec.recalling_firm, rec.report_date, JSON.stringify(rec.raw), rec.cached ? 1 : 0, opts.demo ? 1 : 0, now()
  );
  ctx.bus.publish("recall.summoned", id, { recallId: id, cached: !!rec.cached });
  await autopsyRecall(ctx, id);
  return id;
}

export async function autopsyRecall(ctx: Ctx, id: string) {
  const r = ctx.db.get<{ code_info: string; product_description: string }>("SELECT code_info, product_description FROM recalls WHERE id = ?", id);
  if (!r) throw new Error(`unknown recall ${id}`);
  // COR-1: read product_description as well as code_info (the real D-0526-2026 keeps its NDC in the description)
  const source = `${r.product_description}\n${r.code_info}`;
  const result = await autopsy(source, { llm: ctx.llm, promptPath: ctx.cfg.steeringPromptPath });
  ctx.db.tx(() => {
    ctx.db.run("DELETE FROM extractions WHERE recall_id = ?", id);
    for (const n of result.ndcs) ctx.db.run("INSERT INTO extractions (recall_id, kind, value, expiry, confidence, source) VALUES (?,?,?,?,?,?)", id, "ndc", n.value, null, n.confidence, n.source);
    for (const l of result.lots) ctx.db.run("INSERT INTO extractions (recall_id, kind, value, expiry, confidence, source) VALUES (?,?,?,?,?,?)", id, "lot", l.value, l.expiry ?? "", l.confidence, l.source);
    ctx.db.run(
      "UPDATE recalls SET status = 'autopsied', needs_review = ?, notes = ?, warnings_json = ?, passes_json = ?, llm = ? WHERE id = ?",
      result.needsReview ? 1 : 0, result.notes, JSON.stringify(result.warnings), JSON.stringify(result.passes), ctx.llm?.name ?? null, id
    );
  });
  ctx.bus.publish("recall.autopsied", id, { recallId: id, needsReview: result.needsReview, lots: result.lots.length });
}

// ---------------------------------------------------------------- confirm

export class ConfirmError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

/** COR-4: low-confidence lots need an explicit yes. Auto-confirm only when nothing needs review. */
export function confirmRecall(ctx: Ctx, id: string, opts: { lots?: string[]; auto?: boolean } = {}) {
  const r = ctx.db.get<{ status: string; needs_review: number }>("SELECT status, needs_review FROM recalls WHERE id = ?", id);
  if (!r) throw new ConfirmError("unknown recall", 404);
  if (!["autopsied", "ready", "error"].includes(r.status)) throw new ConfirmError(`recall is ${r.status}`);
  const lots = ctx.db.all<{ id: number; value: string; confidence: number }>("SELECT id, value, confidence FROM extractions WHERE recall_id = ? AND kind = 'lot'", id);
  if (!lots.length) throw new ConfirmError("no lots to confirm", 422);
  if (opts.auto && r.needs_review) throw new ConfirmError("needs a living witness: a pharmacist must confirm this one", 403);
  const picked = opts.lots ? new Set(opts.lots.map(normalizeLot)) : null;
  const chosen = lots.filter((l) => (picked ? picked.has(normalizeLot(l.value)) : l.confidence >= 0.8 || !r.needs_review));
  if (picked) {
    const missing = [...picked].filter((p) => !lots.some((l) => normalizeLot(l.value) === p));
    if (missing.length) throw new ConfirmError(`unknown lot(s): ${missing.join(", ")}`, 422);
  } else if (r.needs_review && chosen.length < lots.length) {
    throw new ConfirmError("some lots are below 0.8 confidence: confirm them explicitly by value", 409);
  }
  if (!chosen.length) throw new ConfirmError("nothing selected", 422);
  ctx.db.tx(() => {
    ctx.db.run("UPDATE extractions SET confirmed = 0 WHERE recall_id = ? AND kind = 'lot'", id);
    for (const l of chosen) ctx.db.run("UPDATE extractions SET confirmed = 1 WHERE id = ?", l.id);
    ctx.db.run("UPDATE extractions SET confirmed = 1 WHERE recall_id = ? AND kind = 'ndc'", id);
    ctx.db.run("UPDATE recalls SET status = 'confirmed', confirmed_at = ?, ready_at = NULL, pipeline_ms = NULL, error = NULL WHERE id = ?", now(), id);
  });
  ctx.bus.publish("recall.confirmed", id, { recallId: id, auto: !!opts.auto, lots: chosen.map((l) => l.value) });
}

// ---------------------------------------------------------------- the hunt

export function confirmedFilter(ctx: Ctx, id: string) {
  const ndcs = ctx.db.all<{ value: string }>("SELECT value FROM extractions WHERE recall_id = ? AND kind = 'ndc' AND confirmed = 1", id).map((x) => x.value);
  const lots = ctx.db.all<{ value: string }>("SELECT value FROM extractions WHERE recall_id = ? AND kind = 'lot' AND confirmed = 1", id).map((x) => x.value);
  const gtins = [...new Set(ndcs.flatMap((n) => ndcToGtin14Candidates(n)))];
  return { ndcs, lots, gtins };
}

/** The terminal speaks the 11-digit HIPAA form. */
export function terminalNdc(ndc: string): string | null {
  const p = parseNdc(ndc);
  if (!p) return null;
  return p.length === 10 ? ndc10ToNdc11(ndc) : `${p.segments[0]}-${p.segments[1]}-${p.segments[2]}`;
}

function replayPaths(ctx: Ctx, id: string) {
  return [path.join(ctx.cfg.fixturesDir, "replay", `${id}.json`), path.join(ctx.cfg.dataDir, "replay", `${id}.json`)];
}
function loadReplay(ctx: Ctx, id: string): { steps: RpaStep[]; rows: DispenseRow[] } | null {
  for (const p of replayPaths(ctx, id)) if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  return null;
}
function saveReplay(ctx: Ctx, id: string, data: { steps: RpaStep[]; rows: DispenseRow[] }) {
  const p = replayPaths(ctx, id)[1]!;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data));
}

export interface HuntOptions { stepDelayMs?: number; forceReplay?: boolean }

/** Stages: trace (Tracker) -> exhume (Grave Robber) -> reconcile -> quarantine + letters (Undertaker) -> hearse. */
export async function runHunt(ctx: Ctx, id: string, opts: HuntOptions = {}) {
  if (ctx.running.has(id)) return;
  ctx.running.add(id);
  const t0 = now();
  try {
    const f = confirmedFilter(ctx, id);
    if (!f.lots.length) throw new Error("no confirmed lots");

    // ---- 1. Tracker (TRK-1, TRK-2)
    ctx.db.run("UPDATE recalls SET status = 'tracing' WHERE id = ?", id);
    await ctx.store.deleteDispensesFor(f.gtins, f.lots);
    ctx.db.run("DELETE FROM dispenses WHERE recall_id = ?", id);
    ctx.db.run("DELETE FROM rpa_steps WHERE recall_id = ?", id);
    const trace = await ctx.store.trace({ gtins: f.gtins, lots: f.lots });
    ctx.bus.publish("trace.found", id, {
      recallId: id, serials: trace.totalSerials, orphans: trace.orphans,
      pharmacies: trace.pharmacies.map((p) => ({ gln: p.gln, name: p.name, received: p.received }))
    });

    // ---- 2. Grave Robber (RPA-1..RPA-6)
    ctx.db.run("UPDATE recalls SET status = 'exhuming' WHERE id = ?", id);
    const holding = trace.pharmacies.filter((p) => p.received > 0);
    const ndcs = f.ndcs.map(terminalNdc).filter((x): x is string => !!x);
    let seq = 0;
    const onStep = (s: RpaStep) => {
      ctx.db.run("INSERT INTO rpa_steps (recall_id, seq, json) VALUES (?,?,?)", id, ++seq, JSON.stringify(s));
      ctx.bus.publish("rpa.step", id, s);
    };
    let rows: DispenseRow[] = [];
    const wantReplay = opts.forceReplay || ctx.cfg.rpaMode === "replay";
    const recorded = loadReplay(ctx, id);
    const delay = opts.stepDelayMs ?? ctx.cfg.stepDelayMs;
    if (holding.length && ndcs.length) {
      if (wantReplay && recorded) {
        await replay(recorded.steps, onStep, delay);
        rows = recorded.rows;
      } else {
        try {
          const out = await exhume({
            rxtermUrl: ctx.cfg.rxtermUrl, ndcs, lots: f.lots, faxDir: path.join(ctx.cfg.fixturesDir, "fax"), stepDelayMs: delay, onStep,
            pharmacies: holding.map((p) => ({ gln: p.gln, name: p.name, system: p.system, code: p.code }))
          });
          rows = out.rows;
          if (!out.steps.some((s) => s.action === "error")) saveReplay(ctx, id, { steps: out.steps, rows });
        } catch (e) {
          if (!recorded) throw e;
          ctx.bus.publish("recall.error", id, { recallId: id, message: `Live bot unavailable (${(e as Error).message}). Instant replay.` });
          await replay(recorded.steps, onStep, delay);
          rows = recorded.rows;
        }
      }
    }

    // ---- 3. Reconcile: infer serials FIFO, write EPCIS dispensing events (RPA-4)
    await writeDispenses(ctx, id, rows, f.gtins);

    // ---- 4. Undertaker (UND-1..UND-4)
    const after = await ctx.store.shelfSerials({ gtins: f.gtins, lots: f.lots });
    ctx.db.tx(() => {
      ctx.db.run("DELETE FROM quarantine WHERE recall_id = ?", id);
      for (const s of after) {
        ctx.db.run("INSERT OR REPLACE INTO quarantine (recall_id, pharmacy_gln, gtin, serial, lot, shelf) VALUES (?,?,?,?,?,?)", id, s.currentOwner, s.gtin, s.serial, s.lot, s.currentShelf);
      }
    });
    const patients = new Map<string, { fillDate: string; pharmacyGln: string }>();
    for (const r of [...rows].sort((a, b) => a.fillDate.localeCompare(b.fillDate))) if (!patients.has(r.patientId)) patients.set(r.patientId, { fillDate: r.fillDate, pharmacyGln: r.pharmacyGln });
    const known = [...patients.keys()];
    ctx.db.run("DELETE FROM outreach WHERE recall_id = ?", id);
    for (const [patientId, v] of patients) {
      const d = await draftOutreach({ patientId, fillDate: v.fillDate, pharmacyGln: v.pharmacyGln }, { llm: ctx.llm, knownPatientIds: known });
      ctx.db.run("INSERT INTO outreach (recall_id, patient_id, pharmacy_gln, fill_date, draft_text, reading_grade, written_by, status) VALUES (?,?,?,?,?,?,?,'draft')", id, patientId, v.pharmacyGln, v.fillDate, d.text, d.grade, d.writtenBy);
    }
    ctx.bus.publish("undertaker.ready", id, { recallId: id, quarantine: after.length, drafts: patients.size });

    // ---- 5. Hearse (HRS-1..HRS-3)
    ctx.db.run("UPDATE recalls SET status = 'ready', ready_at = ?, pipeline_ms = ? WHERE id = ?", now(), now() - t0, id);
    const plan = await planHearseForRecalls(ctx, [id], true);
    ctx.bus.publish("hearse.planned", id, { recallId: id, stops: plan.stops.length, distanceKm: plan.distanceKm, warnings: plan.warnings.length, avoided: plan.avoided });
  } catch (e) {
    ctx.db.run("UPDATE recalls SET status = 'error', error = ? WHERE id = ?", (e as Error).message, id);
    ctx.bus.publish("recall.error", id, { recallId: id, message: (e as Error).message });
  } finally {
    ctx.running.delete(id);
  }
}

/** Serial numbers are not on the terminal or the fax: assign the oldest on-shelf serials of that lot at that pharmacy (FIFO). */
async function writeDispenses(ctx: Ctx, recallId: string, rows: DispenseRow[], gtins: string[]) {
  const groups = new Map<string, DispenseRow[]>();
  for (const r of rows) {
    const k = `${r.pharmacyGln}|${normalizeLot(r.lot)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  for (const [k, g] of groups) {
    const [gln, lotKey] = k.split("|") as [string, string];
    g.sort((a, b) => a.fillDate.localeCompare(b.fillDate) || a.rxNumber.localeCompare(b.rxNumber, undefined, { numeric: true }));
    const stock = (await ctx.store.receivedSerials({ gtins, lots: [lotKey] }, gln)).filter((s) => !s.dispensed);
    let cursor = 0;
    const events = [];
    for (const r of g) {
      const serials: typeof stock = [];
      for (let q = 0; q < Math.max(1, r.qty); q++) if (cursor < stock.length) serials.push(stock[cursor++]!);
      if (!serials.length) {
        insertDispense(ctx, recallId, r, "", false);
        ctx.bus.publish("dispense.found", recallId, { recallId, patientId: r.patientId, serial: "", lot: r.lot, rx: r.rxNumber, written: false });
        continue;
      }
      for (const s of serials) {
        events.push(ctx.store.makeDispenseEvent({
          gtin: s.gtin, serial: s.serial, lot: s.lot, expiry: s.expiry, pharmacyGln: gln, eventTime: `${r.fillDate}T12:00:00Z`,
          rxNumber: r.rxNumber, patientId: r.patientId, source: r.source, serialInferred: true
        }));
        insertDispense(ctx, recallId, r, s.serial, true);
        ctx.bus.publish("dispense.found", recallId, { recallId, patientId: r.patientId, serial: s.serial, lot: s.lot, rx: r.rxNumber, written: true });
      }
    }
    await ctx.store.appendEvents(events);
  }
}

function insertDispense(ctx: Ctx, recallId: string, r: DispenseRow, serial: string, written: boolean) {
  ctx.db.run(
    `INSERT INTO dispenses (recall_id, rx_number, patient_id, pharmacy_gln, pharmacy_name, ndc, lot, serial, qty, fill_date, source, confidence, serial_inferred, event_written)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
    recallId, r.rxNumber, r.patientId, r.pharmacyGln, r.pharmacyName, r.ndc, r.lot, serial, r.qty, r.fillDate, r.source, r.confidence, written ? 1 : 0
  );
}

export { classRoman, buildBins, checkShortage };
