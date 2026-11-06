import { gtin14ToNdc10Digits, isValidGtin, ndcHyphenations, parseElementString, yymmddToIso } from "@bsrx/gs1";
import type { Config } from "./config";
import type { Db } from "./db";
import { gtinOf, ndc11Digits, normalizeExpiry, ndcFromAny, type Role, type Storage } from "./domain";

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

export interface Actor { id: string; name: string; role: Role; storeId: string; workstation: string }

export interface Ctx {
  cfg: Config;
  db: Db;
  notify: import("./notify").Notifier;
  now: () => number;
}

export const todayIso = (ctx: Ctx) => ctx.cfg.today ?? new Date(ctx.now()).toISOString().slice(0, 10);

export function audit(ctx: Ctx, actor: Actor | null, action: string, entity: string, entityId: string | number, before?: unknown, after?: unknown) {
  ctx.db.run(
    "INSERT INTO audit (at, user_id, user_name, store_id, workstation, action, entity, entity_id, before_json, after_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ctx.now(), actor?.id ?? null, actor?.name ?? "system", actor?.storeId ?? "store-7", actor?.workstation ?? "server", action, entity, String(entityId),
    before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after)
  );
}

export function lotEvent(ctx: Ctx, kind: string, lotId: number, who: string, note = "", packageId: number | null = null, at = ctx.now()) {
  ctx.db.run("INSERT INTO lot_events (at, kind, lot_id, package_id, user_name, note) VALUES (?,?,?,?,?,?)", at, kind, lotId, packageId, who, note);
}

// ------------------------------------------------------------------ products

export interface Product { ndc11: string; ndc10: string; gtin: string; name: string; strength: string; form: string; pack_size: string; storage: Storage; maker: string; source: string; reorder_point: number }

export const getProductByNdc11 = (ctx: Ctx, ndc11: string) => ctx.db.get<Product>("SELECT * FROM products WHERE ndc11 = ?", ndc11);
export const getProductByGtin = (ctx: Ctx, gtin: string) => ctx.db.get<Product>("SELECT * FROM products WHERE gtin = ?", gtin);

const COLD = /insulin|semaglutide|liraglutide|dulaglutide|tirzepatide|vaccine|etanercept|adalimumab|epoetin|filgrastim|enoxaparin|glucagon/i;

/** Learn a product we have never stocked from openFDA /drug/ndc (SOUL-6 style), trying all three NDC layouts. */
export async function learnProduct(ctx: Ctx, digits10: string): Promise<Product | null> {
  if (process.env.OFFLINE === "1") return null;
  for (const ndc of ndcHyphenations(digits10)) {
    try {
      const u = new URL("https://api.fda.gov/drug/ndc.json");
      u.searchParams.set("search", `packaging.package_ndc:"${ndc}"`);
      u.searchParams.set("limit", "1");
      if (ctx.cfg.openfdaKey) u.searchParams.set("api_key", ctx.cfg.openfdaKey);
      const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const r = ((await res.json()) as { results?: any[] }).results?.[0];
      if (!r) continue;
      const pkg = (r.packaging ?? []).find((p: any) => p.package_ndc === ndc);
      const strength = r.active_ingredients?.[0]?.strength ?? "";
      const name = `${String(r.generic_name ?? r.brand_name ?? "Unknown").replace(/\b\w/g, (c: string) => c.toUpperCase()).replace(/ And /g, " and ")} ${strength}${pkg?.description ? ` · ${String(pkg.description).split("in 1")[0]!.trim()}` : ""}`.trim();
      const storage: Storage = r.dea_schedule === "CII" ? "c2" : COLD.test(`${r.generic_name} ${r.brand_name}`) ? "cold" : "room";
      const product: Product = {
        ndc11: ndc11Digits(ndc), ndc10: ndc, gtin: gtinOf(ndc), name, strength, form: String(r.dosage_form ?? "").toLowerCase(), pack_size: pkg?.description ?? "",
        storage, maker: r.labeler_name ?? "", source: "openfda", reorder_point: 4
      };
      ctx.db.run("INSERT OR IGNORE INTO products (ndc11, ndc10, gtin, name, strength, form, pack_size, storage, maker, source, reorder_point) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        product.ndc11, product.ndc10, product.gtin, product.name, product.strength, product.form, product.pack_size, product.storage, product.maker, product.source, product.reorder_point);
      return product;
    } catch { /* try the next layout */ }
  }
  return null;
}

// ------------------------------------------------------------------ scan input

export type ScanSource = "datamatrix" | "ocr" | "typed";

export interface ResolvedScan {
  gtin: string;
  ndc11: string;
  ndc10: string;
  lot: string;
  expiry: string;
  /** empty when the label had no serial (OCR path) */
  serial: string;
  source: ScanSource;
  raw: string;
}

export const GARBLED = "That barcode is garbled. Scan again.";

export interface ScanInput {
  raw?: string;
  /** fields read by OCR or typed by hand: {ndc, lot, expiry, serial} */
  fields?: { ndc?: string; lot?: string; expiry?: string; serial?: string };
  source?: ScanSource;
}

/**
 * Turn a scan into {gtin, ndc, lot, expiry, serial}. A GS1 string is validated (check digit) and the NDC is taken
 * from the GTIN; OCR/typed fields come in as an NDC. Unknown products are learned from openFDA.
 */
export async function resolveScan(ctx: Ctx, input: ScanInput): Promise<{ scan: ResolvedScan; product: Product }> {
  if (input.raw) {
    const p = parseElementString(input.raw);
    if (!p.ok || !p.value.gtin || !p.value.lot) throw new HttpError(422, GARBLED, "garbled");
    const { gtin, lot, serial = "", expiry } = p.value;
    if (!isValidGtin(gtin)) throw new HttpError(422, GARBLED, "garbled");
    let product = getProductByGtin(ctx, gtin);
    if (!product) {
      const d10 = gtin14ToNdc10Digits(gtin);
      if (d10) product = (await learnProduct(ctx, d10)) ?? undefined;
    }
    if (!product) throw new HttpError(404, "Unknown product: its NDC is not in our catalog or in openFDA.", "unknown_product");
    return { scan: { gtin, ndc11: product.ndc11, ndc10: product.ndc10, lot, expiry: normalizeExpiry(expiry), serial, source: input.source ?? "datamatrix", raw: input.raw }, product };
  }
  const f = input.fields ?? {};
  const n = f.ndc ? ndcFromAny(f.ndc) : null;
  if (!n || !f.lot?.trim()) throw new HttpError(422, "Need at least an NDC and a lot number.", "garbled");
  let product = getProductByNdc11(ctx, n.ndc11);
  if (!product && n.ndc10) product = (await learnProduct(ctx, n.ndc10.replace(/-/g, ""))) ?? undefined;
  if (!product) throw new HttpError(404, "Unknown product: its NDC is not in our catalog or in openFDA.", "unknown_product");
  const expiry = f.expiry?.trim() ? normalizeExpiry(f.expiry.trim()) || (yymmddToIso(f.expiry.trim()) ?? "") : "";
  return {
    scan: { gtin: product.gtin, ndc11: product.ndc11, ndc10: product.ndc10, lot: f.lot.trim(), expiry, serial: f.serial?.trim() ?? "", source: input.source ?? "ocr", raw: JSON.stringify(f) },
    product
  };
}

// ------------------------------------------------------------------ lots, packages and recalls

export function ensureLot(ctx: Ctx, ndc11: string, lot: string, expiry: string): number {
  const found = ctx.db.get<{ id: number }>("SELECT id FROM lots WHERE ndc11 = ? AND upper(lot) = upper(?)", ndc11, lot);
  if (found) return found.id;
  return Number(ctx.db.run("INSERT INTO lots (ndc11, lot, expiry, status) VALUES (?,?,?, 'active')", ndc11, lot, expiry).lastInsertRowid);
}

/** The one rule behind every "recalled" flag: a confirmed lot of an open recall with this NDC. */
export function activeRecallFor(ctx: Ctx, ndc11: string, lot: string): { recall_id: string } | undefined {
  return ctx.db.get<{ recall_id: string }>(
    `SELECT rl.recall_id FROM recall_lots rl JOIN recalls r ON r.id = rl.recall_id
     WHERE rl.confirmed_at IS NOT NULL AND upper(rl.lot) = upper(?) AND (rl.ndc11 = ? OR rl.ndc11 = '' OR rl.ndc11 IS NULL)`, lot, ndc11);
}

export interface Check { id: string; label: string; state: "pass" | "fail" | "warn"; detail?: string }

export function expiryCheck(ctx: Ctx, expiry: string): Check {
  if (!expiry) return { id: "expiry", label: "Expiry date not readable", state: "warn", detail: "No expiry on the label. Check it by hand." };
  const t = todayIso(ctx);
  if (expiry < t) return { id: "expiry", label: `Expired ${expiry}`, state: "fail" };
  const months = monthsFrom(t, expiry);
  if (months < ctx.cfg.minExpiryMonths) return { id: "expiry", label: `Expires in ${months} month${months === 1 ? "" : "s"}, the store minimum is ${ctx.cfg.minExpiryMonths}`, state: "fail" };
  return { id: "expiry", label: `Expiry more than ${months} months out`, state: "pass" };
}

function monthsFrom(a: string, b: string): number {
  const x = new Date(a + "T00:00:00Z"), y = new Date(b + "T00:00:00Z");
  let m = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth());
  if (y.getUTCDate() < x.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

export function recallCheck(ctx: Ctx, ndc11: string, lot: string): Check {
  const r = activeRecallFor(ctx, ndc11, lot);
  return r ? { id: "recall", label: `Lot ${lot} is in recall ${r.recall_id}`, state: "fail" } : { id: "recall", label: "Lot not on any active recall", state: "pass" };
}

export const inititals = (name: string) => name.split(/[\s.,]+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
