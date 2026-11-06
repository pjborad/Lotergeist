import {
  gtin14ToNdc10Digits, isValidGtin, ndcHyphenations, ndcKeys, ndc10ToNdc11, parseElementString
} from "@bsrx/gs1";
import { buildNote, writeBack, type RpaStep } from "@bsrx/grave-robber";
import type { Ctx } from "./ctx";
import type { FillFlag, FillItem, FillScanResult, FillVerdict, WritebackStatus } from "./types";
import { findActiveRecall, HttpError } from "./views";

export const GARBLED = "The spirit is garbled. Scan again.";
const FILLS = "fills";

const todayIso = (ctx: Ctx) => ctx.cfg.today ?? new Date().toISOString().slice(0, 10);

type ScanRow = {
  id: number; rx_number: string; pharmacy_gln: string; raw_gs1: string; gtin: string; ndc: string; lot: string; expiry: string; serial: string;
  scanned_at: number; device: string; verdict: FillVerdict; flags_json: string; recall_id: string | null; drug: string; drug_source: string;
  labeler: string | null; saved_ms: number; writeback_status: WritebackStatus; writeback_note: string | null; writeback_error: string | null;
};

// ------------------------------------------------------------------ queue

export function listFills(ctx: Ctx): FillItem[] {
  return ctx.world.queue.map((q) => {
    const scans = ctx.db.all<{ verdict: FillVerdict }>("SELECT verdict FROM fill_scans WHERE rx_number = ? ORDER BY id DESC", q.rx);
    return {
      rx: q.rx, patientId: q.patientId, drug: q.drug, ndc: q.ndc11, qty: q.qty, pharmacy: ctx.parties.get(q.pharmacyGln)?.name ?? "",
      status: scans.some((s) => s.verdict === "CAPTURED") ? "filled" : "waiting", lastVerdict: scans[0]?.verdict ?? null
    };
  });
}

export function nextFill(ctx: Ctx): FillItem | null {
  return listFills(ctx).find((f) => f.status === "waiting") ?? null;
}

// ------------------------------------------------------------------ drug lookup (SOUL-6)

interface Drug { name: string; source: "openfda" | "catalog" | "unknown"; labeler: string | null }
const drugCache = new Map<string, Drug>();

/** Real drugs are named live from openFDA /drug/ndc, trying all three hyphenations. Synthetic ones come from the catalog. */
export async function lookupDrug(ctx: Ctx, digits10: string, gtin: string): Promise<Drug> {
  const hit = drugCache.get(digits10);
  if (hit) return hit;
  const product = ctx.world.products.find((p) => p.gtin === gtin);
  const catalog: Drug | null = product ? { name: product.name, source: "catalog", labeler: null } : null;
  if (catalog && !product!.real) return catalog;
  if (process.env.OFFLINE !== "1") {
    for (const ndc of ndcHyphenations(digits10)) {
      try {
        const u = new URL("https://api.fda.gov/drug/ndc.json");
        u.searchParams.set("search", `packaging.package_ndc:"${ndc}"`);
        u.searchParams.set("limit", "1");
        if (ctx.cfg.openfdaKey) u.searchParams.set("api_key", ctx.cfg.openfdaKey);
        await ctx.openfdaLimiter.acquire();
        const res = await fetch(u, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) continue;
        const r = ((await res.json()) as { results?: any[] }).results?.[0];
        if (!r) continue;
        const strength = r.active_ingredients?.[0]?.strength ? ` ${r.active_ingredients[0].strength}` : "";
        const form = r.dosage_form ? `, ${String(r.dosage_form).toLowerCase()}` : "";
        const drug: Drug = { name: `${r.generic_name ?? r.brand_name}${strength}${form}`, source: "openfda", labeler: r.labeler_name ?? null };
        drugCache.set(digits10, drug);
        return drug;
      } catch { /* network trouble: fall through to the catalog */ }
    }
  }
  return catalog ?? { name: `Unknown product (NDC ${ndcHyphenations(digits10)[0]})`, source: "unknown", labeler: null };
}

// ------------------------------------------------------------------ scan (SOUL-4 .. SOUL-10)

const SEVERITY: FillVerdict[] = ["CURSED", "WRONG_VESSEL", "DEPARTED", "CAPTURED"];

export async function scanFill(ctx: Ctx, rx: string, input: { raw: string; device?: "webcam" | "usb" | "typed" }): Promise<FillScanResult> {
  const t0 = performance.now();
  const item = ctx.world.queue.find((q) => q.rx === rx);
  if (!item) throw new HttpError(404, `No prescription ${rx} in the fill queue.`);

  const parsed = parseElementString(input.raw);
  if (!parsed.ok || !parsed.value.gtin || !parsed.value.lot) throw new HttpError(422, GARBLED);
  const { gtin, lot, serial = "", expiry = "" } = parsed.value;
  if (!isValidGtin(gtin)) throw new HttpError(422, GARBLED); // SOUL-5

  const digits10 = gtin14ToNdc10Digits(gtin);
  const flags: FillFlag[] = [];

  // SOUL-8: the one rule behind every CURSED: a confirmed recall with this NDC and this lot
  const recall = findActiveRecall(ctx, gtin, lot);
  if (recall) flags.push({ verdict: "CURSED", message: `Lot ${lot} is in recall ${recall.recall_number}. Do not dispense.` });

  // SOUL-7: wrong vessel
  // 10 NDC digits do not say where the hyphens go: pick the layout that matches the prescription, else the catalog's, else 5-4-1 guess order
  const wanted = new Set(ndcKeys(item.ndc11));
  const layouts = digits10 ? ndcHyphenations(digits10) : [];
  const matching = layouts.find((n) => ndcKeys(n).some((k) => wanted.has(k)));
  const known = ctx.world.products.find((p) => p.gtin === gtin)?.ndc10;
  const bestNdc10 = matching ?? known ?? layouts[1] ?? layouts[0] ?? "";
  if (!matching) {
    flags.push({ verdict: "WRONG_VESSEL", message: digits10 ? `Wrong vessel: this package is NDC ${bestNdc10}, the prescription needs ${item.ndc11}.` : "Wrong vessel: this barcode is not a US drug NDC." });
  }

  // SOUL-9: expired
  if (expiry && expiry < todayIso(ctx)) flags.push({ verdict: "DEPARTED", message: `This soul has already departed. Expired ${expiry}.` });

  const verdict = SEVERITY.find((v) => flags.some((f) => f.verdict === v)) ?? "CAPTURED";
  const ndcShown = bestNdc10 ? ndc10ToNdc11(bestNdc10) : "";
  const catalogName = ctx.world.products.find((p) => p.gtin === gtin)?.name ?? "";

  // SOUL-10: save first (all local), name the drug second (may touch the network)
  const device = input.device ?? "webcam";
  const now = Date.now();
  const writeback: WritebackStatus = verdict === "CAPTURED" ? "pending" : "none";
  const id = Number(ctx.db.run(
    `INSERT INTO fill_scans (rx_number, pharmacy_gln, raw_gs1, gtin, ndc, lot, expiry, serial, scanned_at, device, verdict, flags_json, recall_id, drug, drug_source, saved_ms, writeback_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    rx, item.pharmacyGln, input.raw, gtin, ndcShown, lot, expiry, serial, now, device, verdict, JSON.stringify(flags), recall?.id ?? null,
    catalogName, catalogName ? "catalog" : "unknown", Math.round(performance.now() - t0), writeback).lastInsertRowid);
  const savedMs = Math.round(performance.now() - t0);

  const drug = digits10 ? await lookupDrug(ctx, digits10, gtin) : { name: "Not a drug barcode", source: "unknown" as const, labeler: null };
  ctx.db.run("UPDATE fill_scans SET drug = ?, drug_source = ?, labeler = ?, saved_ms = ? WHERE id = ?", drug.name, drug.source, drug.labeler, savedMs, id);

  const result = toResult(ctx, ctx.db.get<ScanRow>("SELECT * FROM fill_scans WHERE id = ?", id)!);
  ctx.bus.publish("fill.scanned", FILLS, result);
  if (recall) ctx.bus.publish("fill.scanned", recall.id, result); // the recall's own stream sees the flag too
  if (verdict === "CAPTURED") void runWriteback(ctx, id);
  return result;
}

function toResult(ctx: Ctx, r: ScanRow): FillScanResult {
  const item = ctx.world.queue.find((q) => q.rx === r.rx_number);
  const flags: FillFlag[] = JSON.parse(r.flags_json || "[]");
  const recallNumber = r.recall_id ? ctx.db.get<{ recall_number: string }>("SELECT recall_number FROM recalls WHERE id = ?", r.recall_id)?.recall_number ?? null : null;
  const message = {
    CAPTURED: "Captured. Fill allowed.",
    CURSED: `Cursed. Lot ${r.lot} is in recall ${recallNumber ?? ""}. Fill blocked.`,
    WRONG_VESSEL: flags.find((f) => f.verdict === "WRONG_VESSEL")?.message ?? "Wrong vessel.",
    DEPARTED: flags.find((f) => f.verdict === "DEPARTED")?.message ?? "This soul has already departed."
  }[r.verdict];
  return {
    id: r.id, rx: r.rx_number, verdict: r.verdict, fillAllowed: r.verdict === "CAPTURED", message, flags,
    drug: r.drug, drugSource: r.drug_source as FillScanResult["drugSource"], labeler: r.labeler, ndc: r.ndc, gtin: r.gtin, lot: r.lot,
    expiry: r.expiry, serial: r.serial, device: r.device as FillScanResult["device"], recallId: r.recall_id, recallNumber,
    expected: { drug: item?.drug ?? "", ndc: item?.ndc11 ?? "" }, scannedAt: r.scanned_at, savedMs: r.saved_ms,
    writeback: r.writeback_status, note: r.writeback_note
  };
}

export function listScans(ctx: Ctx, limit = 12): FillScanResult[] {
  return ctx.db.all<ScanRow>("SELECT * FROM fill_scans ORDER BY id DESC LIMIT ?", limit).map((r) => toResult(ctx, r));
}
export function getScan(ctx: Ctx, id: number): FillScanResult | null {
  const r = ctx.db.get<ScanRow>("SELECT * FROM fill_scans WHERE id = ?", id);
  return r ? toResult(ctx, r) : null;
}

// ------------------------------------------------------------------ write-back (RPA-7 .. RPA-9)

const inFlight = new Set<number>();

/** Types the lot into the RxTerm 98 prescription, re-reads it, and records verified or failed. Never throws. */
export async function runWriteback(ctx: Ctx, scanId: number): Promise<FillScanResult | null> {
  const row = ctx.db.get<ScanRow>("SELECT * FROM fill_scans WHERE id = ?", scanId);
  if (!row || row.verdict !== "CAPTURED" || inFlight.has(scanId)) return row ? toResult(ctx, row) : null;
  inFlight.add(scanId);
  const note = buildNote({ lot: row.lot, expiry: row.expiry, serial: row.serial });
  ctx.db.run("UPDATE fill_scans SET writeback_status = 'running', writeback_note = ?, writeback_error = NULL WHERE id = ?", note, scanId);
  ctx.bus.publish("fill.writeback", FILLS, { scanId, rx: row.rx_number, status: "running", note });

  const party = ctx.parties.get(row.pharmacy_gln);
  let status: WritebackStatus = "failed";
  let readBack = "";
  let error: string | null = null;
  let attempts = 0;
  try {
    if (!party || party.system !== "rxterm" || !party.code) throw new Error("This pharmacy has no RxTerm 98 login.");
    const [res] = await writeBack({
      rxtermUrl: ctx.cfg.rxtermUrl, pharmacy: { gln: party.gln, name: party.name, system: "rxterm", code: party.code },
      items: [{ rx: row.rx_number, note }], stepDelayMs: ctx.cfg.stepDelayMs,
      onStep: (s: RpaStep) => { ctx.bus.publish("fill.step", FILLS, { scanId, rx: row.rx_number, action: s.action, message: s.message, screen: s.screen }); }
    });
    attempts = res!.attempts;
    readBack = res!.readBack;
    status = res!.verified ? "verified" : "failed";
    error = res!.verified ? null : res!.error ?? (readBack ? `Re-read note differs: "${readBack}"` : "Write-back failed.");
  } catch (e) {
    error = (e as Error).message.split("\n")[0] ?? "Write-back failed.";
  } finally {
    inFlight.delete(scanId);
  }
  ctx.db.run("UPDATE fill_scans SET writeback_status = ?, writeback_readback = ?, writeback_error = ?, writeback_attempts = ? WHERE id = ?", status, readBack, error, attempts, scanId);
  ctx.bus.publish("fill.writeback", FILLS, { scanId, rx: row.rx_number, status, note, readBack, error });
  return getScan(ctx, scanId);
}

/** RPA-9: a failed write-back keeps the scan and is retried on the next run. */
export async function retryFailedWritebacks(ctx: Ctx) {
  for (const r of ctx.db.all<{ id: number }>("SELECT id FROM fill_scans WHERE verdict = 'CAPTURED' AND writeback_status IN ('failed','pending')")) await runWriteback(ctx, r.id);
}
