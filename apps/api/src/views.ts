import { dateAt } from "@bsrx/coroner";
import { buildElementString, normalizeLot, ndc10ToGtin14, parseElementString } from "@bsrx/gs1";
import { classRoman } from "@bsrx/summoner";
import { buildBins, checkShortage } from "@bsrx/undertaker";
import type { Ctx } from "./ctx";
import { confirmedFilter } from "./pipeline";
import { pharmacyLetters } from "./hearse";
import type {
  AfterlifeView, DemoPackage, DispenseView, LotView, OutreachView, RecallDetail, RecallStatus, RecallSummary, RpaStepView,
  ScanResult, Segment, StageCard, TraceView
} from "./types";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type RecallRow = {
  id: string; recall_number: string; classification: string; status: RecallStatus; product_description: string; code_info: string;
  reason: string; firm: string; report_date: string; cached: number; demo: number; needs_review: number; notes: string;
  warnings_json: string; passes_json: string; llm: string | null; error: string | null; created_at: number; pipeline_ms: number | null;
};

const strip = (s: string) => s.replace(/\s*\(synthetic\)/i, "");
const mmdd = (iso: string) => (iso.length >= 10 ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : "—");
const mmyy = (iso: string) => (iso.length >= 7 ? `${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export function productShort(desc: string): string {
  const head = desc.split(",")[0]!.replace(/\s+(Injectable Suspension|Injection|Orally Disintegrating Tablets|Tablets?|Capsules?|Oral Solution|Prefilled Pens?).*$/i, "").trim();
  const strength = /(\d+(?:\.\d+)?\s?(?:mg|mcg|units|u)\/mL|\d+(?:\.\d+)?\s?(?:mg|mcg))/i.exec(desc)?.[1];
  const out = strength && !head.includes(strength) ? `${head} ${strength}` : head;
  return out.length > 44 ? out.slice(0, 43).replace(/\s+\S*$/, "") + "…" : out;
}

export function genericName(desc: string): string {
  return (desc.split(/[\s,]/)[0] ?? "").toLowerCase();
}

export function listRecalls(ctx: Ctx): RecallSummary[] {
  return ctx.db.all<RecallRow>("SELECT * FROM recalls ORDER BY demo DESC, id").map((r) => ({
    id: r.id, recallNumber: r.recall_number, classification: classRoman(r.classification), productShort: productShort(r.product_description), status: r.status, demo: !!r.demo
  }));
}

/** Mark spans the Coroner lifted: lots, their expiry text, and NDCs. */
export function highlight(text: string, lots: string[], ndcs: string[]): Segment[] {
  const ranges: [number, number][] = [];
  const low = text.toLowerCase();
  const find = (needle: string): number[] => {
    const out: number[] = [];
    const n = needle.toLowerCase();
    for (let i = low.indexOf(n); n && i !== -1; i = low.indexOf(n, i + 1)) out.push(i);
    return out;
  };
  for (const lot of lots) {
    for (const at of find(lot)) {
      ranges.push([at, at + lot.length]);
      const after = text.slice(at + lot.length);
      const kw = /^[\s,]*(?:exp(?:iry|iration|ires)?\.?|bud|use\s+by|best\s+by)\s*(?:date)?\s*[:\-]?\s*/i.exec(after);
      if (kw) {
        const start = at + lot.length + kw[0].length;
        const d = dateAt(text, start);
        if (d) ranges.push([start, d.end]);
      }
    }
  }
  for (const n of ndcs) for (const at of find(n)) ranges.push([at, at + n.length]);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const segs: Segment[] = [];
  let cur = 0;
  for (const [s, e] of merged) {
    if (s > cur) segs.push({ t: text.slice(cur, s), hit: false });
    segs.push({ t: text.slice(s, e), hit: true });
    cur = e;
  }
  if (cur < text.length) segs.push({ t: text.slice(cur), hit: false });
  return segs;
}

async function packagesFor(ctx: Ctx, id: string): Promise<number | null> {
  const cached = ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", `packages:${id}`);
  if (cached) return Number(cached.value);
  const f = confirmedFilter(ctx, id);
  if (!f.lots.length) return null;
  const t = await ctx.store.trace({ gtins: f.gtins, lots: f.lots });
  ctx.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)", `packages:${id}`, String(t.totalSerials));
  return t.totalSerials;
}

export async function recallDetail(ctx: Ctx, id: string): Promise<RecallDetail | null> {
  const r = ctx.db.get<RecallRow>("SELECT * FROM recalls WHERE id = ?", id);
  if (!r) return null;
  const ex = ctx.db.all<{ kind: string; value: string; expiry: string | null; confidence: number; source: string; confirmed: number }>("SELECT * FROM extractions WHERE recall_id = ? ORDER BY id", id);
  const ndcs = ex.filter((e) => e.kind === "ndc");
  const lots = ex.filter((e) => e.kind === "lot");
  const done = ["ready"].includes(r.status);
  const packages = done ? await packagesFor(ctx, id) : null;
  const patients = done ? ctx.db.get<{ n: number }>("SELECT count(DISTINCT patient_id) AS n FROM dispenses WHERE recall_id = ?", id)?.n ?? 0 : null;

  const products = ctx.world.products;
  const ndcGtins = new Set(ndcs.flatMap((n) => products.filter((p) => p.ndc10 === n.value || p.ndc11 === n.value).map((p) => p.gtin)));
  const coldChain = products.some((p) => ndcGtins.has(p.gtin) && p.refrigerated);

  const lotViews: LotView[] = [];
  for (const l of lots) {
    let serials: number | null = null;
    if (done) {
      const f = confirmedFilter(ctx, id);
      serials = (await ctx.store.serialsFor({ gtins: f.gtins, lots: [l.value] })).length;
    }
    lotViews.push({
      value: l.value, expiry: l.expiry ?? "", confidence: l.confidence, source: l.source as LotView["source"], confirmed: !!l.confirmed,
      ndc: ndcs[0]?.value ?? "", needsWitness: l.confidence < 0.8, serials
    });
  }
  return {
    id: r.id, recallNumber: r.recall_number, classification: classRoman(r.classification), status: r.status,
    product: r.product_description, firm: r.firm, reason: r.reason, reportDate: r.report_date, codeInfo: r.code_info,
    segments: highlight(r.code_info, lots.map((l) => l.value), ndcs.map((n) => n.value)),
    lots: lotViews, ndcs: ndcs.map((n) => ({ value: n.value, confidence: n.confidence, source: n.source })),
    warnings: JSON.parse(r.warnings_json || "[]"), notes: r.notes, needsReview: !!r.needs_review,
    passes: { regex: true, llm: false, reconciled: true, ...JSON.parse(r.passes_json || "{}") }, llmProvider: r.llm, cached: !!r.cached, coldChain,
    stats: { lots: lots.length, packages, patients, seconds: r.pipeline_ms ? Math.round(r.pipeline_ms / 100) / 10 : null },
    error: r.error ?? undefined
  };
}

export async function traceView(ctx: Ctx, id: string): Promise<TraceView | null> {
  const r = ctx.db.get<RecallRow>("SELECT * FROM recalls WHERE id = ?", id);
  if (!r) return null;
  const f = confirmedFilter(ctx, id);
  const traced = !!f.lots.length && r.status !== "autopsied" && r.status !== "summoned";
  const trace = traced ? await ctx.store.trace({ gtins: f.gtins, lots: f.lots }) : null;
  const rows = ctx.db.all<any>("SELECT * FROM dispenses WHERE recall_id = ? ORDER BY fill_date, rx_number", id);
  const exhumed = r.status === "ready" || rows.length > 0;
  const steps = ctx.db.all<{ json: string }>("SELECT json FROM rpa_steps WHERE recall_id = ? ORDER BY id DESC LIMIT 400", id).reverse().map((s) => JSON.parse(s.json));

  const dates = rows.map((x) => x.fill_date as string).sort();
  const held = trace ? trace.pharmacies.reduce((a, p) => a + p.onShelf, 0) : 0;
  const stage = (k: string) => trace?.stages.find((s) => s.bizStep === k);
  const com = stage("commissioning"), shp = stage("shipping"), rcv = stage("receiving");
  const nPh = trace?.pharmacies.length ?? 0;
  const [shipper, shipperWhere] = (shp?.who ?? "").split(" | ")[0]!.split(" · ");
  const stages: StageCard[] = [
    { key: "commissioning", label: "COMMISSIONING", who: strip(com?.who.split(" | ")[0] ?? "Manufacturer"), where: "Manufacturer · Line 3", source: "EPCIS", when: mmyy(com?.firstDate ?? ""), countLabel: `${com?.count ?? 0} born`, hot: false },
    { key: "shipping", label: "SHIPPING", who: shipper || "Distributor", where: `Distributor${shipperWhere ? ` · ${shipperWhere}` : ""}`, source: "EPCIS", when: mmdd(shp?.firstDate ?? ""), countLabel: `${shp?.count ?? 0} moved`, hot: false },
    { key: "receiving", label: "RECEIVING", who: `${nPh <= 10 ? (WORDS[nPh]![0]!.toUpperCase() + WORDS[nPh]!.slice(1)) : nPh} pharmac${nPh === 1 ? "y" : "ies"}`, where: `Shelves · ${nPh} site${nPh === 1 ? "" : "s"}`, source: "EPCIS", when: mmdd(rcv?.firstDate ?? ""), countLabel: `${rcv?.count ?? 0} shelved`, hot: false },
    { key: "dispensing", label: "DISPENSING", who: "Exhumed fills", where: "RxTerm 98 + fax", source: "RPA", when: exhumed && dates.length ? `${mmdd(dates[0]!)}–${mmdd(dates.at(-1)!)}` : "pending", countLabel: exhumed ? `${rows.length} out` : "—", hot: true },
    { key: "shelf", label: "STILL ON SHELF", who: "Quarantine", where: "Bins awaiting pickup", source: "LIVE", when: "now", countLabel: `${held} held`, hot: true }
  ];

  const lotLabel = f.lots.join(" + ") || "—";
  const inHands = rows.filter((x) => x.event_written).length;
  return {
    recallId: id, lotLabel, serials: trace?.totalSerials ?? 0, orphans: trace?.orphans ?? 0, inPatientHands: inHands || rows.length, held, stages,
    pharmacies: (trace?.pharmacies ?? []).map((p) => ({ gln: p.gln, name: p.name, system: p.system, received: p.received, onShelf: p.onShelf, dispensed: p.dispensed })),
    dispenses: rows.map((x): DispenseView => ({
      rx: x.rx_number, patientId: x.patient_id, lot: x.lot, serial: x.serial, serialInferred: !!x.serial_inferred, fillDate: x.fill_date,
      source: x.source, pharmacy: x.pharmacy_name, confidence: x.confidence, eventWritten: !!x.event_written
    })),
    steps: steps.map((s: any): RpaStepView => ({ seq: s.seq, pharmacyName: s.pharmacyName, system: s.system, action: s.action, message: s.message, screen: s.screen, rowsFound: s.rowsFound, confidence: s.confidence, ts: s.ts })),
    traced, exhumed
  };
}

export function outreachRows(ctx: Ctx, ids: string[]): OutreachView[] {
  if (!ids.length) return [];
  return ctx.db.all<any>(`SELECT * FROM outreach WHERE recall_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ...ids).map(toOutreach);
}
export function toOutreach(o: any): OutreachView {
  return { id: o.id, recallId: o.recall_id, patientId: o.patient_id, fillDate: o.fill_date, text: o.draft_text, grade: o.reading_grade, writtenBy: o.written_by, status: o.status, approvedBy: o.approved_by };
}

export async function afterlifeView(ctx: Ctx, ids: string[]): Promise<AfterlifeView> {
  const marks = ids.map(() => "?").join(",");
  const q = ids.length ? ctx.db.all<{ pharmacy_gln: string; gtin: string; serial: string; lot: string; shelf: string }>(`SELECT pharmacy_gln, gtin, serial, lot, shelf FROM quarantine WHERE recall_id IN (${marks})`, ...ids) : [];
  const letters = pharmacyLetters(ctx);
  const phs = [...ctx.parties.values()].filter((p) => p.kind === "pharmacy").sort((a, b) => (letters.get(a.gln)! < letters.get(b.gln)! ? -1 : 1));
  const bins = buildBins(q.map((x) => ({ pharmacyGln: x.pharmacy_gln, gtin: x.gtin, serial: x.serial, lot: x.lot, expiry: "", shelf: x.shelf })), phs.map((p) => ({ gln: p.gln, name: p.name })));
  let shortage = null;
  const first = ids[0] ? ctx.db.get<{ product_description: string }>("SELECT product_description FROM recalls WHERE id = ?", ids[0]) : undefined;
  if (first) {
    const generic = genericName(first.product_description);
    const s = await checkShortage(generic, { fixture: ctx.shortageFixture, apiKey: ctx.cfg.openfdaKey, offline: process.env.OFFLINE === "1" });
    shortage = { genericName: generic, onList: s.onList, soleSource: s.soleSource, source: s.source, substitute: s.substitute ?? null, nadacDelta: s.nadacDelta ?? null, unit: s.unit ?? null, note: s.note ?? null };
  }
  return { recallIds: ids, bins, total: q.length, outreach: outreachRows(ctx, ids), shortage };
}

// ---------------------------------------------------------------- scan

const TRAIL = {
  commissioning: (p: string, shelf: string) => `Commissioned at ${strip(p)}${shelf ? `, ${shelf}` : ""}`,
  shipping: (p: string) => `Shipped by ${strip(p).split(" · ")[0]}`,
  receiving: (p: string, shelf: string) => `Received at ${strip(p).split(" · ")[0]}${shelf ? `, shelf ${shelf}` : ""}`,
  dispensing: (p: string, _s: string, who?: string) => `Dispensed${who ? ` to Patient ${who}` : ""} at ${strip(p)}`
} as const;

export function activeRecalls(ctx: Ctx) {
  return ctx.db.all<{ id: string; recall_number: string }>("SELECT id, recall_number FROM recalls WHERE status IN ('confirmed','tracing','exhuming','ready')");
}

/** A confirmed recall whose NDC and lot match this package (the one rule behind every CURSED verdict). */
export function findActiveRecall(ctx: Ctx, gtin: string, lot: string): { id: string; recall_number: string } | null {
  for (const a of activeRecalls(ctx)) {
    const f = confirmedFilter(ctx, a.id);
    if (f.gtins.includes(gtin) && f.lots.some((l) => normalizeLot(l) === normalizeLot(lot))) return a;
  }
  return null;
}

export async function scanElement(ctx: Ctx, element: string): Promise<ScanResult> {
  const t0 = performance.now();
  const parsed = parseElementString(element);
  if (!parsed.ok) throw new HttpError(422, `Could not read that code: ${parsed.error}`);
  const { gtin, lot, serial, expiry } = parsed.value;
  if (!gtin || !lot) throw new HttpError(422, "The code needs at least a GTIN (01) and a lot (10).");

  const active = activeRecalls(ctx);
  const match = findActiveRecall(ctx, gtin, lot);

  const product = ctx.world.products.find((p) => p.gtin === gtin);
  const custody = serial ? await ctx.store.custody(gtin, serial) : [];
  const known = custody.length > 0 || !!product;
  const cursed = !!match;

  const trail = custody.map((c) => {
    const who = (c.meta as { patientId?: string }).patientId;
    // only pharmacies have shelves; the distributor's bizLocation is a dock name
    const shelf = ctx.parties.get(c.location)?.kind === "pharmacy" ? c.shelf : c.bizStep === "commissioning" ? c.shelf : "";
    return { date: mmdd(c.eventTime), text: TRAIL[c.bizStep](c.partyName, shelf, who) };
  });
  const last = custody.at(-1);
  const phName = last?.bizStep === "receiving" ? strip(last.partyName).split(" · ")[0]! : null;
  const location = last?.bizStep === "receiving" && phName ? { pharmacy: phName, shelf: last.shelf } : null;

  if (cursed && last?.bizStep === "receiving") {
    const sib = ctx.db.get<{ serial: string; patient_id: string; fill_date: string }>(
      "SELECT serial, patient_id, fill_date FROM dispenses WHERE recall_id = ? AND pharmacy_gln = ? AND upper(lot) = ? AND serial <> '' ORDER BY fill_date, id LIMIT 1", match!.id, last.location, normalizeLot(lot));
    if (sib) trail.push({ date: mmdd(sib.fill_date), text: `Sibling serial ${sib.serial} dispensed to Patient ${sib.patient_id}` });
  }

  let bin: string | null = null;
  if (cursed && last?.location) {
    const a = await afterlifeView(ctx, [match!.id]);
    bin = a.bins.find((b) => b.pharmacyGln === last.location)?.id ?? null;
  }

  const ndc = product?.ndc10 ?? "unknown";
  const shortage = product ? await checkShortage(product.name.split(/[\s,]/)[0]!.toLowerCase(), { fixture: ctx.shortageFixture, offline: true }) : null;
  const synced = ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'last_openfda_sync'");

  return {
    verdict: cursed ? "CURSED" : "CLEAN",
    known,
    recallId: match?.id ?? null,
    recallNumber: match?.recall_number ?? null,
    message: cursed
      ? `This package belongs to recall ${match!.recall_number}. Pull it now and ${bin ? `place it in quarantine bin ${bin}` : "place it in quarantine"}.`
      : known
        ? "Rest in peace. Same NDC, but this lot is in no active recall. Safe to dispense."
        : "This package is not in the crypt, and its lot matches no active recall.",
    ais: [
      { ai: "01", name: "GTIN", value: gtin, hot: false },
      ...(serial ? [{ ai: "21", name: "SERIAL", value: serial, hot: false }] : []),
      { ai: "10", name: "LOT", value: lot, hot: cursed },
      ...(expiry ? [{ ai: "17", name: "EXPIRY", value: expiry, hot: false }] : [])
    ],
    raw: buildElementString(parsed.value),
    trail, location, bin,
    checked: { recalls: active.length, shortages: shortage?.onList ? 1 : 0, ndc, syncedMinutesAgo: synced ? Math.max(0, Math.round((Date.now() - Number(synced.value)) / 60000)) : null },
    decodedMs: Math.max(1, Math.round(performance.now() - t0))
  };
}

export async function demoPackages(ctx: Ctx): Promise<DemoPackage[]> {
  const gtin = ndc10ToGtin14("70004-417-05");
  const defs = [
    { serial: "000214", lot: "PRORX050925-1", expiry: "2025-11-04", cursed: true, label: "A" },
    { serial: "000522", lot: "PRORX051125-2", expiry: "2025-12-08", cursed: false, label: "B" }
  ];
  const out: DemoPackage[] = [];
  for (const d of defs) {
    const c = await ctx.store.custody(gtin, d.serial);
    const shelf = c.at(-1)?.shelf ?? "";
    const el = { gtin, serial: d.serial, lot: d.lot, expiry: d.expiry };
    out.push({
      label: `Package ${d.label}${shelf ? ` · shelf ${shelf}` : ""}`, cursed: d.cursed, shelf,
      element: buildElementString(el), raw: buildElementString(el, { mode: "raw", order: ["01", "17", "10", "21"] })
    });
  }
  return out;
}
