import crypto from "node:crypto";
import { audit, emit, HttpError, type Actor, type Ctx } from "./core";
import { merge, PHARMACY_PHONE, recallImpact } from "./recall";

/**
 * Outreach agent (plan 6.4 and section 9): pharmacist voicemail by default.
 *
 * SANDBOX. Nothing is dialled. The repo safety rules forbid a send path, so "placing a call" means: render the
 * approved script to speech with the configured voice, store the audio, and record an outcome the way a voice
 * provider would report it. Sandbox outcomes follow the last digits of the synthetic 555-01xx number:
 *   ...99 number not in service -> pharmacist call list
 *   ...13 no answer, no mailbox -> retry next day, then pharmacist call list
 *   odd   answered live, message played, "press 1" -> warm transfer to the pharmacist
 *   even  voicemail left
 */

export const DEFAULT_VOICEMAIL = `Hello {first_name}. This is {pharmacist}, the pharmacist at Elm Street Pharmacy. I'm calling about a medicine you picked up from us on {sold_date}. It's important, but it is not an emergency. Please call us back at {pharmacy_phone} so we can talk it over and take care of it for you at no cost. Again, that number is {pharmacy_phone}. If you'd like to talk with a pharmacist now, press 1. Thank you.`;

export const CALL_WINDOW = { start: 9, end: 20 };

/** "(555) 010-2200" -> "5 5 5, 0 1 0, 2 2 0 0" so text-to-speech reads it digit by digit with natural pauses. */
export const spokenPhone = (p: string) => {
  const d = p.replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return p;
  const sp = (s: string) => s.split("").join(" ");
  return `${sp(d.slice(0, 3))}, ${sp(d.slice(3, 6))}, ${sp(d.slice(6))}`;
};

/** Privacy rules for the script: never the drug, the condition, the Rx number or another patient. */
export function checkScript(ctx: Ctx, script: string): string[] {
  const problems: string[] = [];
  if (script.trim().length < 60) problems.push("The message is too short to be clear.");
  if (script.length > 1200) problems.push("Keep the message under 1,200 characters (about a minute).");
  if (!/\{pharmacy_phone\}|\(\d{3}\) \d{3}-\d{4}/.test(script)) problems.push("Say the pharmacy phone number so the patient can call back.");
  if (/\{(drug_name|rx_number)\}/.test(script)) problems.push("A voicemail must not name the medicine or the prescription number. Someone else may hear it.");
  const names = ctx.db.all<{ name: string }>("SELECT name FROM products").map((p) => p.name.split(/[\s·]/)[0]!.toLowerCase()).filter((n) => n.length > 4);
  const hit = names.find((n) => script.toLowerCase().includes(n));
  if (hit) problems.push(`The message names a medicine ("${hit}"). Leave it out; the patient will hear the details on the call back.`);
  if (/\bS-\d{4}\b/.test(script)) problems.push("Remove the patient ID from the message.");
  if (/recall|sterile|contaminat|diabet|insulin|cancer|hiv|pregnan/i.test(script)) problems.push("Do not mention the recall reason or a condition in a voicemail.");
  return problems;
}

const firstName = (n: string) => n.split(" ")[0]!;

function fieldsFor(ctx: Ctx, p: { name: string; sold: string }, pharmacist: string) {
  return { first_name: firstName(p.name), sold_date: p.sold, pharmacy_phone: spokenPhone(PHARMACY_PHONE), pharmacist: pharmacist.replace(/, PharmD$/, "").replace(/^J\. /, "Jordan ") };
}

async function speak(ctx: Ctx, text: string): Promise<{ audioId: string | null; voice: string; provider: string }> {
  const v = ctx.voice;
  if (!v) return { audioId: null, voice: "device voice", provider: "browser" };
  const id = crypto.createHash("sha256").update(`${v.name}|${v.voice}|${text}`).digest("hex").slice(0, 24);
  if (ctx.db.get("SELECT 1 FROM audio WHERE id = ?", id)) return { audioId: id, voice: v.voice, provider: v.name };
  try {
    const s = await v.synthesize(text);
    if (!s) return { audioId: null, voice: v.voice, provider: v.name };
    ctx.db.run("INSERT OR IGNORE INTO audio (id, mime, bytes, voice, text, at) VALUES (?,?,?,?,?,?)", id, s.mime, s.bytes, s.voice, text, ctx.now());
    return { audioId: id, voice: s.voice, provider: v.name };
  } catch (e) {
    // Fail safe: no audio means the web app reads the script with the device voice; the call log says so.
    return { audioId: null, voice: `unavailable (${(e as Error).message})`, provider: "browser" };
  }
}

export async function previewVoicemail(ctx: Ctx, actor: Actor, recallId: string, script: string) {
  if (actor.role !== "pharmacist") throw new HttpError(403, `A ${actor.role} cannot do that.`, "forbidden");
  const imp = recallImpact(ctx, recallId);
  const sample = imp.patients[0] ?? { name: "Maria Alvarez", sold: "Oct 9" };
  const text = merge(script, fieldsFor(ctx, sample, actor.name));
  const sp = await speak(ctx, text);
  return { text, problems: checkScript(ctx, script), sample: sample.name, ...sp };
}

export function voicemailDraft(ctx: Ctx, recallId: string, actor: Actor) {
  const imp = recallImpact(ctx, recallId);
  const reachable = new Set<string>();
  let noPhone = 0, dnc = 0;
  for (const p of imp.patients) {
    if (reachable.has(p.id)) continue;
    const pt = ctx.db.get<any>("SELECT phone, dnc, voice_consent FROM patients WHERE id = ?", p.id)!;
    if (!pt.phone) noPhone++; else if (pt.dnc || !pt.voice_consent) dnc++; else reachable.add(p.id);
  }
  const sample = imp.patients[0];
  return {
    script: DEFAULT_VOICEMAIL, callCount: reachable.size, noPhone, dnc, window: `${CALL_WINDOW.start} AM – ${CALL_WINDOW.end - 12} PM patient's local time`,
    sampleText: sample ? merge(DEFAULT_VOICEMAIL, fieldsFor(ctx, sample, actor.name)) : "", voice: ctx.voice ? { provider: ctx.voice.name, voice: ctx.voice.voice } : { provider: "browser", voice: "device voice" }
  };
}

/** Pharmacist attests and starts the calls. Every reachable patient gets attempt 1; the agent then places them. */
export async function startVoicemail(ctx: Ctx, actor: Actor, recallId: string, script: string, attested: boolean) {
  if (actor.role !== "pharmacist") throw new HttpError(403, `A ${actor.role} cannot do that.`, "forbidden");
  if (!attested) throw new HttpError(422, "The pharmacist must tick the attestation before any call is placed.", "attest");
  if (!ctx.db.get("SELECT 1 FROM recalls WHERE id = ?", recallId)) throw new HttpError(404, "Unknown recall.");
  const problems = checkScript(ctx, script);
  if (problems.length) throw new HttpError(422, problems[0]!, "script");
  if (ctx.db.get("SELECT 1 FROM outreach_calls WHERE recall_id = ?", recallId)) throw new HttpError(409, "Calls for this recall were already started.", "already_sent");
  const imp = recallImpact(ctx, recallId);
  if (imp.unconfirmed > 0) throw new HttpError(409, `${imp.unconfirmed} lot(s) still need a pharmacist's confirmation before calls can start.`, "unconfirmed_lots");
  if (!imp.patients.length) throw new HttpError(409, "No patients are linked to these lots.", "no_patients");

  const seen = new Set<string>();
  let queued = 0, callList = 0;
  ctx.db.tx(() => {
    for (const p of imp.patients) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const pt = ctx.db.get<any>("SELECT phone, dnc, voice_consent FROM patients WHERE id = ?", p.id)!;
      const text = merge(script, fieldsFor(ctx, p, actor.name));
      const outcome = !pt.phone ? "call_list" : pt.dnc || !pt.voice_consent ? "call_list" : "queued";
      const note = !pt.phone ? "No phone number on file" : pt.dnc || !pt.voice_consent ? "Do-not-call or no consent for automated calls" : null;
      ctx.db.run("INSERT INTO outreach_calls (recall_id, patient_id, attempt, outcome, script, placed_at, window_ok, note) VALUES (?,?,?,?,?,?,?,?)", recallId, p.id, 1, outcome, text, null, null, note);
      if (outcome === "queued") queued++; else callList++;
    }
  });
  audit(ctx, actor, "recall.voicemail.start", "recall", recallId, undefined, { queued, callList, attested: true });
  ctx.db.run("UPDATE recalls SET status = CASE WHEN status = 'closed' THEN status ELSE 'notified' END, step = 'done' WHERE id = ?", recallId);
  const placed = await runOutreachAgent(ctx, recallId);
  return { queued, callList, placed };
}

const localHour = (now: number, tz: number) => (new Date(now).getUTCHours() + tz + 24) % 24;

/** One agent pass: place every due attempt that is inside the patient's calling window. */
export async function runOutreachAgent(ctx: Ctx, recallId?: string): Promise<number> {
  const due = ctx.db.all<any>(
    `SELECT c.*, p.phone, p.tz_offset FROM outreach_calls c JOIN patients p ON p.id = c.patient_id
     WHERE c.outcome IN ('queued','retry_due') ${recallId ? "AND c.recall_id = ?" : ""} ORDER BY c.id`, ...(recallId ? [recallId] : []));
  let placed = 0;
  for (const c of due) {
    if (c.outcome === "retry_due" && c.placed_at && ctx.now() < c.placed_at) continue; // placed_at holds the retry time
    const h = localHour(ctx.now(), c.tz_offset ?? -5);
    if (h < CALL_WINDOW.start || h >= CALL_WINDOW.end) {
      ctx.db.run("UPDATE outreach_calls SET window_ok = 0, note = ? WHERE id = ?", `Waiting for the calling window (it is ${h}:00 for the patient)`, c.id);
      continue;
    }
    const sp = await speak(ctx, c.script);
    const digits = String(c.phone).replace(/\D/g, "");
    const last = Number(digits.slice(-1));
    let outcome: string, note: string, transfer = 0;
    if (digits.endsWith("99")) { outcome = "call_list"; note = "Number not in service. Moved to the pharmacist call list."; }
    else if (digits.endsWith("13")) {
      if (c.attempt >= 2) { outcome = "call_list"; note = "No answer and no voicemail twice. Moved to the pharmacist call list."; }
      else { outcome = "no_answer"; note = "No answer, no voicemail box. Retry tomorrow."; }
    } else if (last % 2 === 1) { outcome = "answered"; note = "Answered. Message played, patient pressed 1: warm transfer to the pharmacist."; transfer = 1; }
    else { outcome = "voicemail"; note = "Voicemail left."; }
    ctx.db.run("UPDATE outreach_calls SET outcome = ?, note = ?, placed_at = ?, window_ok = 1, audio_id = ?, voice = ?, transfer = ? WHERE id = ?", outcome, note, ctx.now(), sp.audioId, `${sp.provider}:${sp.voice}`, transfer, c.id);
    if (outcome === "no_answer") {
      ctx.db.run("INSERT INTO outreach_calls (recall_id, patient_id, attempt, outcome, script, placed_at, note) VALUES (?,?,?,?,?,?,?)", c.recall_id, c.patient_id, c.attempt + 1, "retry_due", c.script, ctx.now() + 86_400_000, "Second attempt scheduled for tomorrow");
    }
    placed++;
  }
  if (placed) emit(ctx, "outreach.progress", { recallId: recallId ?? null, placed });
  const left = recallId ? ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM outreach_calls WHERE recall_id = ? AND outcome IN ('queued','retry_due')", recallId)!.n : 1;
  if (recallId && placed && left === 0) emit(ctx, "outreach.completed", { recallId });
  return placed;
}

export function outreachResults(ctx: Ctx, recallId: string) {
  const rows = ctx.db.all<any>(
    `SELECT c.*, p.name, p.phone FROM outreach_calls c JOIN patients p ON p.id = c.patient_id WHERE c.recall_id = ? ORDER BY c.patient_id, c.attempt`, recallId);
  const latest = new Map<string, any>();
  for (const r of rows) latest.set(r.patient_id, r);
  const L = [...latest.values()];
  const count = (o: string) => L.filter((r) => r.outcome === o).length;
  return {
    recallId, started: rows.length > 0, total: L.length,
    answered: count("answered"), voicemail: count("voicemail"), retrying: count("retry_due") + count("no_answer"), queued: count("queued"),
    callList: L.filter((r) => r.outcome === "call_list").map((r) => ({ id: r.patient_id, name: r.name, phone: r.phone, reason: r.note })),
    callbacks: rows.filter((r) => r.callback_at).map((r) => ({ id: r.patient_id, name: r.name, at: r.callback_at })),
    calls: rows.map((r) => ({ id: r.id, patientId: r.patient_id, name: r.name, phone: r.phone, attempt: r.attempt, outcome: r.outcome, note: r.note, placedAt: r.placed_at, audioId: r.audio_id, voice: r.voice, transfer: !!r.transfer, script: r.script })),
    sandbox: true
  };
}

/** A patient calls the pharmacy back: caller-ID lookup puts the open recall on screen (plan section 9). */
export function inboundCall(ctx: Ctx, from: string) {
  const digits = from.replace(/\D/g, "").slice(-10);
  if (digits.length < 7) throw new HttpError(422, "Caller ID is missing.");
  const p = ctx.db.get<{ id: string; name: string }>("SELECT id, name FROM patients WHERE replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ','') LIKE ?", `%${digits}`);
  if (!p) return { known: false };
  const c = ctx.db.get<{ id: number; recall_id: string }>("SELECT c.id, c.recall_id FROM outreach_calls c JOIN recalls r ON r.id = c.recall_id WHERE c.patient_id = ? AND r.status <> 'closed' ORDER BY c.id DESC LIMIT 1", p.id);
  if (c) ctx.db.run("UPDATE outreach_calls SET callback_at = ? WHERE id = ?", ctx.now(), c.id);
  audit(ctx, null, "call.inbound", "patient", p.id, undefined, { recall: c?.recall_id ?? null });
  return { known: true, patient: p, recallId: c?.recall_id ?? null };
}
