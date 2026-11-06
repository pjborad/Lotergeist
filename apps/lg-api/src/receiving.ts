import { verifyPassword, ndc11Pretty, suggestLocation, type Suggestion } from "./domain";
import {
  audit, ensureLot, expiryCheck, getProductByNdc11, HttpError, lotEvent, recallCheck, resolveScan, type Actor, type Check, type Ctx, type Product, type ResolvedScan, type ScanInput
} from "./core";

export interface DeliveryLineView { lineNo: number; name: string; sub: string; qty: string; state: "done" | "now" | "todo" }
export interface DeliveryView {
  id: string; wholesaler: string; status: string; expected: number; checkedIn: number; arrived: string; note: string; tiDoc: string;
  lines: DeliveryLineView[];
}

export interface ReceiveOutcome {
  packageId: number;
  product: { name: string; maker: string; ndc10: string; storage: string };
  fields: { k: string; ai: string; v: string }[];
  checks: Check[];
  suggestion: Suggestion;
  canConfirm: boolean;
  needsWitness: boolean;
  source: string;
  noSerial: boolean;
  delivery: DeliveryView;
}

export function listDeliveries(ctx: Ctx): DeliveryView[] {
  return ctx.db.all<{ id: string }>("SELECT id FROM deliveries ORDER BY id").map((d) => deliveryView(ctx, d.id)!);
}

export function deliveryView(ctx: Ctx, id: string, currentNdc?: string): DeliveryView | null {
  const d = ctx.db.get<any>("SELECT * FROM deliveries WHERE id = ?", id);
  if (!d) return null;
  const checkedIn = ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM packages WHERE delivery_id = ? AND status <> 'pending_putaway'", id)!.n;
  const lines = ctx.db.all<any>("SELECT * FROM delivery_lines WHERE delivery_id = ? ORDER BY line_no", id).map((l): DeliveryLineView => {
    const done = l.received_qty >= l.expected_qty;
    const last = ctx.db.get<{ lot: string; expiry: string; location: string }>(
      "SELECT l.lot, k.expiry, k.location FROM packages k JOIN lots l ON l.id = k.lot_id WHERE k.delivery_id = ? AND l.ndc11 = ? AND k.status <> 'pending_putaway' ORDER BY k.id DESC LIMIT 1", id, l.ndc11);
    const now = !done && currentNdc === l.ndc11;
    return {
      lineNo: l.line_no, name: l.name,
      sub: done && last ? `Lot ${last.lot} · ${last.location}` : now ? "Scanning now" : l.received_qty > 0 && last ? `Lot ${last.lot} · ${last.location}` : "Waiting for scan",
      qty: `${l.received_qty} / ${l.expected_qty}`, state: done ? "done" : now ? "now" : "todo"
    };
  });
  return { id: d.id, wholesaler: d.wholesaler, status: d.status, expected: d.expected, checkedIn, arrived: d.arrived, note: d.note, tiDoc: d.ti_doc, lines };
}

function pendingForLine(ctx: Ctx, deliveryId: string, ndc11: string, exceptId: number) {
  return ctx.db.get<{ n: number }>(
    "SELECT count(*) AS n FROM packages k JOIN lots l ON l.id = k.lot_id WHERE k.delivery_id = ? AND l.ndc11 = ? AND k.status = 'pending_putaway' AND k.id <> ?", deliveryId, ndc11, exceptId)!.n;
}

/** The checks that run on every package at the dock (spec screen 3). Re-run at confirm so the server, not the screen, decides. */
export function receiveChecks(ctx: Ctx, deliveryId: string, scan: ResolvedScan, product: Product, packageId: number): Check[] {
  const d = ctx.db.get<any>("SELECT * FROM deliveries WHERE id = ?", deliveryId)!;
  const checks: Check[] = [];

  const line = ctx.db.get<any>("SELECT * FROM delivery_lines WHERE delivery_id = ? AND ndc11 = ? ORDER BY line_no LIMIT 1", deliveryId, product.ndc11);
  if (!line) checks.push({ id: "invoice", label: `${product.name.split(" · ")[0]} is not on invoice ${deliveryId}`, state: "fail" });
  else if (line.received_qty + pendingForLine(ctx, deliveryId, product.ndc11, packageId) >= line.expected_qty) checks.push({ id: "invoice", label: `Invoice line ${line.line_no} is already complete`, state: "fail" });
  else checks.push({ id: "invoice", label: `Matches invoice line ${line.line_no}`, state: "pass" });

  if (!scan.serial) checks.push({ id: "tits", label: "No serial on the label: transaction information cannot be matched", state: "warn", detail: "Check the supplier paperwork by hand." });
  else {
    const ti = ctx.db.get<{ lot: string }>("SELECT lot FROM ti_records WHERE delivery_id = ? AND gtin = ? AND serial = ?", deliveryId, scan.gtin, scan.serial);
    if (!ti) checks.push({ id: "tits", label: "Serial is not in the supplier's transaction information", state: "fail", detail: "Suspect product: do not shelve." });
    else if (ti.lot.toUpperCase() !== scan.lot.toUpperCase()) checks.push({ id: "tits", label: `Lot differs from the supplier's record (${ti.lot})`, state: "fail" });
    else checks.push({ id: "tits", label: "Transaction information verified", state: "pass" });
  }

  checks.push(expiryCheck(ctx, scan.expiry));
  checks.push(recallCheck(ctx, product.ndc11, scan.lot));

  if (product.storage === "cold") {
    const t = d.shipper_temp_c as number | null;
    checks.push(t != null && t >= 2 && t <= 8
      ? { id: "temp", label: `Shipper temperature log ${t.toFixed(1)} °C`, state: "pass" }
      : { id: "temp", label: `Shipper temperature log ${t ?? "missing"} °C is outside 2–8 °C`, state: "fail" });
  }
  if (product.storage === "c2") {
    checks.push(line ? { id: "csos", label: "Matches CSOS order 7731", state: "pass" } : { id: "csos", label: "No CSOS order for this item", state: "fail" });
  }
  return checks;
}

export async function scanReceive(ctx: Ctx, actor: Actor, deliveryId: string, input: ScanInput): Promise<ReceiveOutcome> {
  const delivery = ctx.db.get<any>("SELECT * FROM deliveries WHERE id = ?", deliveryId);
  if (!delivery) throw new HttpError(404, "Unknown delivery.");
  const { scan, product } = await resolveScan(ctx, input);

  let pkg = scan.serial ? ctx.db.get<any>("SELECT * FROM packages WHERE gtin = ? AND serial = ?", scan.gtin, scan.serial) : undefined;
  if (pkg && pkg.status !== "pending_putaway") throw new HttpError(409, `Serial ${scan.serial} is already in the ledger (${pkg.status.replace("_", " ")}).`, "duplicate");

  let noSerial = false;
  let serial = scan.serial;
  if (!pkg) {
    const lotId = ensureLot(ctx, product.ndc11, scan.lot, scan.expiry);
    if (!serial) {
      serial = `NOSN-${lotId}-${ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM packages WHERE lot_id = ? AND manual = 1", lotId)!.n + 1}`;
      noSerial = true;
    }
    const id = Number(ctx.db.run(
      "INSERT INTO packages (serial, lot_id, gtin, expiry, location, zone, status, delivery_id, received_at, received_by, manual, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      serial, lotId, scan.gtin, scan.expiry, null, null, "pending_putaway", deliveryId, ctx.now(), actor.name, noSerial ? 1 : 0, noSerial ? "no serial on label (read by OCR)" : null).lastInsertRowid);
    pkg = ctx.db.get<any>("SELECT * FROM packages WHERE id = ?", id);
    audit(ctx, actor, "receive.scan", "package", id, undefined, { gtin: scan.gtin, lot: scan.lot, serial, source: scan.source });
  } else noSerial = !!pkg.manual;

  const suggestion = suggestLocation({ ndc11: product.ndc11, name: product.name, storage: product.storage });
  const checks = receiveChecks(ctx, deliveryId, { ...scan, serial: noSerial ? "" : serial }, product, pkg.id);
  const bad = checks.some((c) => c.state === "fail");
  return {
    packageId: pkg.id,
    product: { name: product.name, maker: product.maker, ndc10: product.ndc10, storage: product.storage },
    fields: [
      { k: "GTIN", ai: "01", v: scan.gtin }, { k: "Lot", ai: "10", v: scan.lot }, { k: "Expiry", ai: "17", v: scan.expiry || "not read" },
      { k: "Serial", ai: "21", v: noSerial ? "none on label" : serial }
    ],
    checks, suggestion, canConfirm: !bad, needsWitness: product.storage === "c2", source: scan.source, noSerial,
    delivery: deliveryView(ctx, deliveryId, product.ndc11)!
  };
}

export function confirmPutaway(ctx: Ctx, actor: Actor, packageId: number, witness?: { email: string; password: string }): DeliveryView {
  const pkg = ctx.db.get<any>("SELECT k.*, l.lot, l.ndc11 FROM packages k JOIN lots l ON l.id = k.lot_id WHERE k.id = ?", packageId);
  if (!pkg) throw new HttpError(404, "Unknown package.");
  if (pkg.status !== "pending_putaway") throw new HttpError(409, "That package is already put away.");
  const product = getProductByNdc11(ctx, pkg.ndc11)!;
  const scan: ResolvedScan = { gtin: pkg.gtin, ndc11: pkg.ndc11, ndc10: product.ndc10, lot: pkg.lot, expiry: pkg.expiry, serial: pkg.manual ? "" : pkg.serial, source: "datamatrix", raw: "" };
  const checks = receiveChecks(ctx, pkg.delivery_id, scan, product, pkg.id);
  const failed = checks.find((c) => c.state === "fail");
  if (failed) throw new HttpError(409, `Cannot put away: ${failed.label}. Report a problem instead.`, "checks_failed");

  let witnessName = "";
  if (product.storage === "c2") {
    if (!witness?.email || !witness.password) throw new HttpError(422, "A Schedule II receipt needs a second staff member as witness.", "witness_required");
    const w = ctx.db.get<any>("SELECT * FROM users WHERE lower(email) = lower(?)", witness.email);
    if (!w || !verifyPassword(witness.password, w.pw_hash)) throw new HttpError(403, "Witness sign-in failed.", "witness_invalid");
    if (w.id === actor.id) throw new HttpError(403, "You cannot witness your own receipt.", "witness_self");
    witnessName = w.name;
  }

  const sug = suggestLocation({ ndc11: product.ndc11, name: product.name, storage: product.storage });
  ctx.db.tx(() => {
    ctx.db.run("UPDATE packages SET status = 'on_shelf', location = ?, zone = ?, received_at = ?, received_by = ? WHERE id = ?", sug.location, sug.zone, ctx.now(), actor.name, pkg.id);
    ctx.db.run("UPDATE delivery_lines SET received_qty = received_qty + 1 WHERE id = (SELECT id FROM delivery_lines WHERE delivery_id = ? AND ndc11 = ? AND received_qty < expected_qty ORDER BY line_no LIMIT 1)", pkg.delivery_id, product.ndc11);
    lotEvent(ctx, "Received", pkg.lot_id, actor.name, `1 unit · delivery ${pkg.delivery_id}${witnessName ? ` · witness ${witnessName}` : ""}`, pkg.id);
    lotEvent(ctx, "Shelved", pkg.lot_id, actor.name, sug.location, pkg.id);
    const open = ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM delivery_lines WHERE delivery_id = ? AND received_qty < expected_qty", pkg.delivery_id)!.n;
    if (open === 0) ctx.db.run("UPDATE deliveries SET status = 'closed' WHERE id = ?", pkg.delivery_id);
  });
  audit(ctx, actor, "receive.putaway", "package", pkg.id, { status: "pending_putaway" }, { status: "on_shelf", location: sug.location, witness: witnessName || undefined });
  return deliveryView(ctx, pkg.delivery_id, product.ndc11)!;
}

export const PROBLEM_KINDS = ["short", "damaged", "wrong_item", "suspect"] as const;

/** "Report a problem": log it, quarantine the package, count the line as explained. */
export function reportProblem(ctx: Ctx, actor: Actor, packageId: number, kind: (typeof PROBLEM_KINDS)[number], note = ""): DeliveryView {
  const pkg = ctx.db.get<any>("SELECT k.*, l.ndc11 FROM packages k JOIN lots l ON l.id = k.lot_id WHERE k.id = ?", packageId);
  if (!pkg) throw new HttpError(404, "Unknown package.");
  if (pkg.status !== "pending_putaway") throw new HttpError(409, "That package is already put away.");
  ctx.db.tx(() => {
    ctx.db.run("UPDATE packages SET status = 'quarantined', location = 'Quarantine Q-1', zone = 'quarantine' WHERE id = ?", pkg.id);
    ctx.db.run("INSERT INTO problems (delivery_id, package_id, kind, note, at, by) VALUES (?,?,?,?,?,?)", pkg.delivery_id, pkg.id, kind, note, ctx.now(), actor.name);
    ctx.db.run("UPDATE delivery_lines SET received_qty = received_qty + 1 WHERE id = (SELECT id FROM delivery_lines WHERE delivery_id = ? AND ndc11 = ? AND received_qty < expected_qty ORDER BY line_no LIMIT 1)", pkg.delivery_id, pkg.ndc11);
    lotEvent(ctx, "Quarantined", pkg.lot_id, actor.name, `Receiving problem: ${kind.replace("_", " ")}${note ? ` · ${note}` : ""}`, pkg.id);
  });
  audit(ctx, actor, "receive.problem", "package", pkg.id, undefined, { kind, note });
  return deliveryView(ctx, pkg.delivery_id, pkg.ndc11)!;
}

export const prettyNdc = ndc11Pretty;
