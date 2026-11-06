import { activeRecallFor, audit, expiryCheck, HttpError, lotEvent, resolveScan, todayIso, type Actor, type Check, type Ctx, type ScanInput } from "./core";

export type RxStatus = "to_fill" | "filled" | "to_verify" | "ready" | "sold";
const STEP: Record<RxStatus, number> = { to_fill: 0, filled: 1, to_verify: 2, ready: 3, sold: 4 };
const STATUS_LABEL: Record<RxStatus, string> = { to_fill: "To fill", filled: "Filled", to_verify: "To verify", ready: "Ready", sold: "Sold" };

export interface QueueItem { rx: string; patient: string; patientId: string; drug: string; due: string; status: RxStatus; statusLabel: string }

export function fillQueue(ctx: Ctx): QueueItem[] {
  return ctx.db.all<any>(
    `SELECT r.rx, r.drug, r.due, r.status, p.name, p.id AS pid FROM prescriptions r JOIN patients p ON p.id = r.patient_id
     WHERE r.status <> 'sold' OR r.due >= ? ORDER BY CASE r.status WHEN 'to_fill' THEN 0 WHEN 'filled' THEN 1 WHEN 'to_verify' THEN 2 WHEN 'ready' THEN 3 ELSE 4 END, r.rx`, todayIso(ctx)
  ).filter((r) => r.status !== "sold" || r.due === todayIso(ctx)).map((r) => ({ rx: r.rx, patient: r.name, patientId: r.pid, drug: r.drug, due: r.due, status: r.status, statusLabel: STATUS_LABEL[r.status as RxStatus] }));
}

export function rxDetail(ctx: Ctx, actor: Actor, rx: string) {
  const r = ctx.db.get<any>("SELECT r.*, p.name AS pname, p.dob, p.phone, p.email, p.preferred, p.sms_consent, p.email_consent, p.allergies, pr.name AS product FROM prescriptions r JOIN patients p ON p.id = r.patient_id LEFT JOIN products pr ON pr.ndc11 = r.ndc11 WHERE r.rx = ?", rx);
  if (!r) throw new HttpError(404, "Unknown prescription.");
  const full = actor.role !== "cashier"; // cashiers see enough to hand over the medicine, not the whole profile
  const d = ctx.db.get<any>(
    `SELECT d.*, k.serial, k.expiry, k.location, l.lot FROM dispenses d LEFT JOIN packages k ON k.id = d.package_id LEFT JOIN lots l ON l.id = k.lot_id
     WHERE d.rx_id = ? AND d.state <> 'sent_back' ORDER BY d.id DESC LIMIT 1`, r.id);
  return {
    rx: r.rx, step: STEP[r.status as RxStatus], status: r.status as RxStatus, statusLabel: STATUS_LABEL[r.status as RxStatus],
    patient: { id: r.patient_id, name: r.pname, dob: full ? r.dob : null, phone: r.phone ? r.phone : null, email: full ? r.email || null : null, preferred: r.preferred, smsConsent: !!r.sms_consent, allergies: full ? r.allergies : "" },
    prescription: { drug: r.drug, ndc11: r.ndc11, directions: r.directions, prescriber: r.prescriber, refills: r.refills, qty: r.qty },
    dispense: d ? { id: d.id, state: d.state, lot: d.lot ?? "", serial: d.serial ?? "", expiry: d.expiry ?? "", location: d.location ?? "", labelPrinted: !!d.label_printed, filledBy: d.filled_by, verifiedBy: d.verified_by, soldAt: d.sold_at, register: d.register, contact: d.contact_json ? JSON.parse(d.contact_json) : {} } : null
  };
}

const need = (actor: Actor, ...roles: Actor["role"][]) => {
  if (!roles.includes(actor.role)) throw new HttpError(403, `A ${actor.role} cannot do that.`, "forbidden");
};

export interface FillScanOutcome { dispenseId: number; checks: Check[]; lot: string; serial: string; expiry: string; ndc: string; inferredSerial: boolean }

/** Step 1, Scan: the NDC must match the prescription, the lot must be clean and in date, and the package must really be on our shelf. */
export async function scanFill(ctx: Ctx, actor: Actor, rx: string, input: ScanInput): Promise<FillScanOutcome> {
  need(actor, "technician", "pharmacist");
  const r = ctx.db.get<any>("SELECT * FROM prescriptions WHERE rx = ?", rx);
  if (!r) throw new HttpError(404, "Unknown prescription.");
  if (r.status !== "to_fill") throw new HttpError(409, "This prescription already has a package scanned.", "already_scanned");
  const { scan, product } = await resolveScan(ctx, input);

  if (product.ndc11 !== r.ndc11) {
    throw new HttpError(409, `Wrong drug. This package is ${product.ndc10} (${product.name}); the prescription needs ${ctx.db.get<{ ndc10: string }>("SELECT ndc10 FROM products WHERE ndc11 = ?", r.ndc11)?.ndc10 ?? r.ndc11}.`, "wrong_ndc");
  }
  const recall = activeRecallFor(ctx, product.ndc11, scan.lot);
  if (recall) throw new HttpError(409, `Recalled lot. ${scan.lot} is in recall ${recall.recall_id}. Do not dispense.`, "recalled");
  const exp = expiryCheck(ctx, scan.expiry);
  if (scan.expiry && scan.expiry < todayIso(ctx)) throw new HttpError(409, `Expired ${scan.expiry}. Do not dispense.`, "expired");

  let pkg: any;
  let inferred = false;
  if (scan.serial) {
    pkg = ctx.db.get<any>("SELECT k.*, l.lot FROM packages k JOIN lots l ON l.id = k.lot_id WHERE k.gtin = ? AND k.serial = ?", scan.gtin, scan.serial);
    if (!pkg) throw new HttpError(409, `Serial ${scan.serial} was never received here. Check it in at Receiving first.`, "not_in_ledger");
  } else {
    pkg = ctx.db.get<any>("SELECT k.*, l.lot FROM packages k JOIN lots l ON l.id = k.lot_id WHERE l.ndc11 = ? AND upper(l.lot) = upper(?) AND k.status = 'on_shelf' ORDER BY k.id LIMIT 1", product.ndc11, scan.lot);
    if (!pkg) throw new HttpError(409, `No package of lot ${scan.lot} is on the shelf.`, "not_in_ledger");
    inferred = true;
  }
  if (pkg.status !== "on_shelf") {
    throw new HttpError(409, pkg.status === "dispensed" ? `Serial ${pkg.serial} was already dispensed.` : pkg.status === "quarantined" ? `Serial ${pkg.serial} is in quarantine.` : `Serial ${pkg.serial} is ${pkg.status.replace("_", " ")}.`, "not_on_shelf");
  }

  const checks: Check[] = [
    { id: "ndc", label: `Right drug, right strength. NDC ${product.ndc10} matches.`, state: "pass" },
    { id: "recall", label: "Recall check: clear", state: "pass" },
    exp
  ];
  const dispenseId = Number(ctx.db.tx(() => {
    ctx.db.run("UPDATE packages SET status = 'dispensed' WHERE id = ?", pkg.id);
    const id = Number(ctx.db.run("INSERT INTO dispenses (rx_id, package_id, state, filled_by, filled_at, register, contact_json) VALUES (?,?,?,?,?,?,?)", r.id, pkg.id, "filled", actor.name, ctx.now(), "POS 2", "{}").lastInsertRowid);
    ctx.db.run("UPDATE prescriptions SET status = 'filled' WHERE id = ?", r.id);
    lotEvent(ctx, "Filled", pkg.lot_id, actor.name, `Rx ${rx}`, pkg.id);
    return id;
  }));
  audit(ctx, actor, "fill.scan", "dispense", dispenseId, undefined, { rx, serial: pkg.serial, lot: pkg.lot, source: scan.source });
  return { dispenseId, checks, lot: pkg.lot, serial: pkg.serial, expiry: pkg.expiry ?? scan.expiry, ndc: product.ndc10, inferredSerial: inferred };
}

export function printLabel(ctx: Ctx, actor: Actor, dispenseId: number) {
  need(actor, "technician", "pharmacist");
  const d = ctx.db.get<any>("SELECT d.*, r.rx FROM dispenses d JOIN prescriptions r ON r.id = d.rx_id WHERE d.id = ?", dispenseId);
  if (!d || d.state !== "filled") throw new HttpError(409, "Nothing to label here.");
  ctx.db.tx(() => {
    ctx.db.run("UPDATE dispenses SET label_printed = 1 WHERE id = ?", dispenseId);
    ctx.db.run("UPDATE prescriptions SET status = 'to_verify' WHERE id = ?", d.rx_id);
  });
  audit(ctx, actor, "fill.label", "dispense", dispenseId);
  return { ok: true };
}

export function verifyDispense(ctx: Ctx, actor: Actor, dispenseId: number, checklist: boolean[]) {
  need(actor, "pharmacist");
  const d = ctx.db.get<any>("SELECT * FROM dispenses WHERE id = ?", dispenseId);
  if (!d || ctx.db.get<any>("SELECT status FROM prescriptions WHERE id = ?", d.rx_id)?.status !== "to_verify") throw new HttpError(409, "This fill is not waiting for verification.");
  if (checklist.length < 4 || !checklist.every(Boolean)) throw new HttpError(422, "Tick every item on the pharmacist checklist, or send the fill back.", "checklist");
  ctx.db.tx(() => {
    ctx.db.run("UPDATE dispenses SET state = 'verified', verified_by = ?, verified_at = ? WHERE id = ?", actor.name, ctx.now(), dispenseId);
    ctx.db.run("UPDATE prescriptions SET status = 'ready' WHERE id = ?", d.rx_id);
  });
  audit(ctx, actor, "fill.verify", "dispense", dispenseId, undefined, { checklist });
  return { ok: true };
}

/** Send back: the package returns to the shelf and the prescription goes back to "To fill". */
export function sendBack(ctx: Ctx, actor: Actor, dispenseId: number, reason: string) {
  need(actor, "pharmacist");
  const d = ctx.db.get<any>("SELECT d.*, k.lot_id FROM dispenses d LEFT JOIN packages k ON k.id = d.package_id WHERE d.id = ?", dispenseId);
  if (!d || d.state === "sold" || d.state === "sent_back") throw new HttpError(409, "This fill cannot be sent back.");
  if (reason.trim().length < 3) throw new HttpError(422, "Say why you are sending it back.");
  ctx.db.tx(() => {
    ctx.db.run("UPDATE dispenses SET state = 'sent_back' WHERE id = ?", dispenseId);
    if (d.package_id) ctx.db.run("UPDATE packages SET status = 'on_shelf' WHERE id = ?", d.package_id);
    ctx.db.run("UPDATE prescriptions SET status = 'to_fill' WHERE id = ?", d.rx_id);
    if (d.lot_id) lotEvent(ctx, "Released", d.lot_id, actor.name, `Sent back: ${reason}`, d.package_id);
  });
  audit(ctx, actor, "fill.sendback", "dispense", dispenseId, undefined, { reason });
  return { ok: true };
}

/** Step 4, Pickup: ID, counseling, signature. Writes the sale record the recall workflow later joins on. */
export function sell(ctx: Ctx, actor: Actor, dispenseId: number, body: { idChecked: boolean; counseled: boolean; signature: boolean }) {
  need(actor, "cashier", "pharmacist");
  const d = ctx.db.get<any>("SELECT d.*, r.rx, r.patient_id, r.drug, p.name, p.phone, p.email, p.sms_consent, p.email_consent, k.serial, k.expiry, l.lot, l.id AS lot_id FROM dispenses d JOIN prescriptions r ON r.id = d.rx_id JOIN patients p ON p.id = r.patient_id LEFT JOIN packages k ON k.id = d.package_id LEFT JOIN lots l ON l.id = k.lot_id WHERE d.id = ?", dispenseId);
  if (!d || d.state !== "verified") throw new HttpError(409, "A pharmacist must verify this fill before it can be sold.");
  if (!body.idChecked || !body.counseled || !body.signature) throw new HttpError(422, "Photo ID, counseling offer and signature are all required.", "pickup_checklist");
  const contact = { sms: d.sms_consent && d.phone ? d.phone : null, email: d.email_consent && d.email ? d.email : null, phone: d.phone || null };
  const at = ctx.now();
  ctx.db.tx(() => {
    ctx.db.run("UPDATE dispenses SET state = 'sold', sold_at = ?, register = ?, id_checked = 1, counseled = 1, signature = 1, contact_json = ? WHERE id = ?", at, "POS 2", JSON.stringify(contact), dispenseId);
    ctx.db.run("UPDATE prescriptions SET status = 'sold', due = ? WHERE id = ?", todayIso(ctx), d.rx_id);
    if (d.lot_id) lotEvent(ctx, "Sold", d.lot_id, actor.name, `Rx ${d.rx}`, d.package_id, at);
  });
  audit(ctx, actor, "fill.sell", "dispense", dispenseId, undefined, { rx: d.rx, lot: d.lot, serial: d.serial });
  return { soldAt: at, register: "POS 2", rx: d.rx, drug: d.drug, patient: d.name, lot: d.lot ?? "", serial: d.serial ?? "", expiry: d.expiry ?? "", contact };
}
