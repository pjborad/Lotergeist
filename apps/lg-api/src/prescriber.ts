import { audit, emit, HttpError, type Actor, type Ctx } from "./core";
import { expectedDaysSupply, findDrug, parseSig } from "./drugs";
import { draftPrescriberMessage, reviewRx, reviewView } from "./rxwatcher";

/**
 * Pharmacist decisions on a reviewed order, and the prescriber change loop (plan 3.5 step 2, 6.1).
 *
 * The prescriber channel here is a SANDBOX of NCPDP SCRIPT RxChangeRequest / RxChangeResponse: messages are
 * stored with SCRIPT-style ids and nothing leaves this machine. In production the same two calls sit behind a
 * certified Surescripts intermediary (plan section 7).
 */

const FREQ_PHRASES = [
  /every morning and at bed ?time/i, /morning and (at )?bed ?time/i, /morning and evening/i, /(three|four|two) times (a|per) day/i,
  /(three|four) times daily/i, /twice (a|per) day/i, /twice daily/i, /\b(tid|qid|bid)\b/i
];

export interface Proposal { directions: string; daysSupply: number | null }

/** A suggested correction the pharmacist can edit: put the frequency back on the label and recount the days. */
export function proposeFix(ctx: Ctx, rxNo: string): Proposal {
  const r = ctx.db.get<any>("SELECT r.*, p.name AS pname FROM prescriptions r LEFT JOIN products p ON p.ndc11 = r.ndc11 WHERE r.rx = ?", rxNo);
  if (!r) throw new HttpError(404, "Unknown prescription.");
  const drug = findDrug(r.pname ?? r.drug);
  const sig = parseSig(r.directions);
  let directions: string = r.directions;
  if (drug && sig.dosesPerDay != null && !drug.labelDosesPerDay.includes(sig.dosesPerDay)) {
    const target = drug.labelDosesPerDay[0]!;
    const phrase = target === 1 ? `once daily${sig.atBedtime ? " at bedtime" : ""}` : target === 2 ? "twice daily" : `${target} times daily`;
    const hit = FREQ_PHRASES.find((re) => re.test(directions));
    directions = hit ? directions.replace(hit, phrase) : `${directions} ${phrase}`;
  }
  const days = drug ? expectedDaysSupply(drug, r.qty, parseSig(directions)) : null;
  return { directions, daysSupply: days };
}

export function decide(ctx: Ctx, actor: Actor, rxNo: string, body: { action: "approve" | "reject" | "change"; reason?: string; message?: string; proposal?: Proposal }) {
  if (actor.role !== "pharmacist") throw new HttpError(403, `A ${actor.role} cannot do that.`, "forbidden");
  const rx = ctx.db.get<any>("SELECT * FROM prescriptions WHERE rx = ?", rxNo);
  if (!rx) throw new HttpError(404, "Unknown prescription.");
  if (rx.status !== "to_fill") throw new HttpError(409, "This order is already being filled.", "already_scanned");
  if (!["pending", "clear", "none", "on_hold", "rejected"].includes(rx.review)) throw new HttpError(409, "This order was already decided.", "decided");
  const view = reviewView(ctx, rxNo);
  const needsReview = view.findings.some((f) => (f.severity === "needs_review" || f.severity === "block") && f.source === "rule");
  const blocked = view.findings.some((f) => f.severity === "block");

  if (body.action === "approve") {
    if (blocked) throw new HttpError(409, "A blocking finding cannot be approved as written. Reject the order or ask the prescriber to change it.", "blocked");
    if (needsReview && (body.reason ?? "").trim().length < 5) throw new HttpError(422, "Say why you are approving an order with open findings.", "reason_required");
    ctx.db.run("UPDATE prescriptions SET review = 'approved', review_note = ? WHERE id = ?", body.reason ?? null, rx.id);
    decideRun(ctx, rxNo, "approved", actor);
    audit(ctx, actor, "rx.approve", "prescription", rxNo, undefined, { open: view.flags }, body.reason);
    emit(ctx, "rx.approved", { rx: rxNo });
    return { review: "approved" };
  }
  if (body.action === "reject") {
    if ((body.reason ?? "").trim().length < 5) throw new HttpError(422, "Say why you are rejecting this order.", "reason_required");
    ctx.db.run("UPDATE prescriptions SET review = 'rejected', review_note = ? WHERE id = ?", body.reason, rx.id);
    decideRun(ctx, rxNo, "rejected", actor);
    audit(ctx, actor, "rx.reject", "prescription", rxNo, undefined, undefined, body.reason);
    emit(ctx, "rx.rejected", { rx: rxNo });
    return { review: "rejected" };
  }

  // change request
  const message = (body.message ?? draftPrescriberMessage(ctx, rxNo)).trim();
  if (message.length < 20) throw new HttpError(422, "Write a message to the prescriber.", "message_required");
  const proposal = body.proposal ?? proposeFix(ctx, rxNo);
  const scriptId = `SCRIPT-${rxNo}-${Date.now().toString(36).toUpperCase()}`;
  const id = ctx.db.tx(() => {
    const mid = Number(ctx.db.run("INSERT INTO prescriber_messages (rx, direction, type, script_id, prescriber, body, status, response_json, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      rxNo, "out", "RxChangeRequest", scriptId, rx.prescriber, message, "sent", JSON.stringify({ proposal }), actor.name, ctx.now()).lastInsertRowid);
    ctx.db.run("UPDATE prescriptions SET review = 'on_hold', review_note = ? WHERE id = ?", `Change requested ${scriptId}`, rx.id);
    return mid;
  });
  decideRun(ctx, rxNo, "change_requested", actor);
  audit(ctx, actor, "rx.change_request", "prescription", rxNo, undefined, { scriptId, proposal });
  emit(ctx, "rx.change.requested", { rx: rxNo, scriptId });
  return { review: "on_hold", message: messageView(ctx, id) };
}

function decideRun(ctx: Ctx, rxNo: string, decision: string, actor: Actor) {
  ctx.db.run("UPDATE agent_runs SET decision = ?, decided_by = ?, decided_at = ? WHERE id = (SELECT id FROM agent_runs WHERE agent = 'rx-watcher' AND subject = ? ORDER BY id DESC LIMIT 1)", decision, actor.name, ctx.now(), rxNo);
}

export function messageView(ctx: Ctx, id: number) {
  const m = ctx.db.get<any>("SELECT * FROM prescriber_messages WHERE id = ?", id);
  if (!m) throw new HttpError(404, "Unknown message.");
  const extra = m.response_json ? JSON.parse(m.response_json) : {};
  return { id: m.id, rx: m.rx, type: m.type, scriptId: m.script_id, prescriber: m.prescriber, body: m.body, status: m.status as string, createdAt: m.created_at, respondedAt: m.responded_at, sandbox: true, proposal: extra.proposal as Proposal | undefined, response: extra.response };
}

export const listMessages = (ctx: Ctx, rx?: string) =>
  ctx.db.all<{ id: number }>(`SELECT id FROM prescriber_messages ${rx ? "WHERE rx = ?" : ""} ORDER BY id DESC LIMIT 50`, ...(rx ? [rx] : [])).map((r) => messageView(ctx, r.id));

/**
 * RxChangeResponse. Approved: a NEW version of the order (R1, R2...) replaces the original; the original is kept
 * unchanged for the record (versions are immutable). Denied: the original comes back for a pharmacist decision.
 * `by` is the pharmacist recording the sandbox reply, or the integration that delivered it.
 */
export async function respond(ctx: Ctx, by: string, actor: Actor | null, messageId: number, body: { response: "approved" | "denied"; directions?: string; daysSupply?: number; note?: string }) {
  const m = ctx.db.get<any>("SELECT * FROM prescriber_messages WHERE id = ?", messageId);
  if (!m || m.type !== "RxChangeRequest") throw new HttpError(404, "Unknown change request.");
  if (m.status !== "sent") throw new HttpError(409, "This request was already answered.", "answered");
  const rx = ctx.db.get<any>("SELECT * FROM prescriptions WHERE rx = ?", m.rx)!;
  const proposal: Proposal = JSON.parse(m.response_json ?? "{}").proposal ?? proposeFix(ctx, m.rx);
  let newRx: string | null = null;

  if (body.response === "approved") {
    const directions = (body.directions ?? proposal.directions).trim();
    const days = body.daysSupply ?? proposal.daysSupply;
    if (directions.length < 5) throw new HttpError(422, "The corrected order needs directions.", "directions");
    const version = (rx.version ?? 0) + 1;
    const base = String(rx.rx).replace(/-R\d+$/, "");
    newRx = `${base}-R${version}`;
    ctx.db.tx(() => {
      ctx.db.run("INSERT INTO prescriptions (rx, patient_id, ndc11, drug, qty, directions, prescriber, refills, status, due, days_supply, version, parent_rx, review) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        newRx, rx.patient_id, rx.ndc11, rx.drug, rx.qty, directions, rx.prescriber, rx.refills, "to_fill", rx.due, days, version, rx.rx, "none");
      ctx.db.run("UPDATE prescriptions SET status = 'replaced', review = 'replaced', review_note = ? WHERE id = ?", `Replaced by ${newRx}`, rx.id);
    });
  } else {
    ctx.db.run("UPDATE prescriptions SET review = 'pending', review_note = ? WHERE id = ?", `Prescriber denied the change: ${body.note ?? "no reason given"}`, rx.id);
  }
  ctx.db.run("UPDATE prescriber_messages SET status = ?, responded_at = ?, response_json = ? WHERE id = ?", body.response, ctx.now(),
    JSON.stringify({ proposal, response: { by, response: body.response, newRx, note: body.note ?? null } }), messageId);
  audit(ctx, actor, "rx.change_response", "prescription", m.rx, undefined, { response: body.response, newRx, by });
  emit(ctx, "rx.change.responded", { rx: m.rx, response: body.response, newRx });
  const review = newRx ? await reviewRx(ctx, actor, newRx) : reviewView(ctx, m.rx);
  return { response: body.response, newRx, review, message: messageView(ctx, messageId) };
}
