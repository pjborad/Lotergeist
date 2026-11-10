import crypto from "node:crypto";
import { audit, HttpError, type Actor, type Ctx } from "./core";

/**
 * Outbound webhooks (plan 8.4). Each delivery is signed with HMAC-SHA256 over `${timestamp}.${body}` and sent as
 *   X-Lotergeist-Signature: t=<unix seconds>,v1=<hex>
 * Failed deliveries retry with backoff (1 min, 5 min, 30 min, 2 h) and every attempt is logged.
 * Payloads carry ids and counts only: no patient names, phones or emails.
 */

export const WEBHOOK_EVENTS = ["recall.matched", "rx.change.responded", "delivery.checked_in", "outreach.completed"] as const;
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000];

export function sign(secret: string, ts: number, body: string) {
  return crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

export function verifySignature(secret: string, header: string | undefined, body: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const m = /t=(\d+),v1=([a-f0-9]{64})/.exec(header ?? "");
  if (!m) return false;
  const ts = Number(m[1]);
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const want = Buffer.from(sign(secret, ts, body)), got = Buffer.from(m[2]!);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** Only https, or plain http to this machine. Blocks webhooks aimed at internal network addresses (SSRF). */
export function checkUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(422, "That is not a valid URL.", "url"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new HttpError(422, "Webhooks must use https (http is allowed only for localhost).", "url");
  if (!local && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(u.hostname)) throw new HttpError(422, "Webhooks cannot target private network addresses.", "url");
  return u.toString();
}

export function addWebhook(ctx: Ctx, actor: Actor, integrationId: string, url: string, events: string[]) {
  if (actor.role !== "admin") throw new HttpError(403, "Only an admin can change integrations or security settings.", "forbidden");
  if (!ctx.db.get("SELECT 1 FROM integrations WHERE id = ?", integrationId)) throw new HttpError(404, "Unknown integration.");
  const bad = events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (bad.length || !events.length) throw new HttpError(422, `Pick events from: ${WEBHOOK_EVENTS.join(", ")}.`, "events");
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  const id = Number(ctx.db.run("INSERT INTO webhooks (integration_id, url, secret, events, active) VALUES (?,?,?,?,1)", integrationId, checkUrl(url), secret, JSON.stringify(events)).lastInsertRowid);
  // The built-in test sink is addressed by webhook id, which is only known now.
  if (/\/hooks\/sink\/next$/.test(url)) ctx.db.run("UPDATE webhooks SET url = ? WHERE id = ?", url.replace(/next$/, String(id)), id);
  audit(ctx, actor, "webhook.create", "integration", integrationId, undefined, { webhookId: id, url, events });
  return { id, secret };
}

async function attempt(ctx: Ctx, deliveryId: number) {
  const d = ctx.db.get<any>("SELECT wd.*, w.url, w.secret, e.type, e.payload, e.at AS event_at FROM webhook_deliveries wd JOIN webhooks w ON w.id = wd.webhook_id JOIN events e ON e.id = wd.event_id WHERE wd.id = ?", deliveryId);
  if (!d) return;
  const body = JSON.stringify({ id: `evt_${d.event_id}`, type: d.type, created: Math.floor(d.event_at / 1000), data: JSON.parse(d.payload) });
  const ts = Math.floor(Date.now() / 1000);
  const sig = `t=${ts},v1=${sign(d.secret, ts, body)}`;
  try {
    const res = await fetch(d.url, { method: "POST", headers: { "content-type": "application/json", "x-lotergeist-signature": sig, "x-lotergeist-event": d.type }, body, signal: AbortSignal.timeout(8000), redirect: "manual" });
    if (res.status >= 200 && res.status < 300) {
      ctx.db.run("UPDATE webhook_deliveries SET status = 'delivered', http_status = ?, signature = ?, at = ?, next_at = NULL, error = NULL WHERE id = ?", res.status, sig.slice(0, 24), ctx.now(), deliveryId);
      return;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    const n = d.attempt;
    const next = BACKOFF_MS[n - 1];
    ctx.db.run("UPDATE webhook_deliveries SET status = ?, attempt = ?, at = ?, next_at = ?, error = ? WHERE id = ?", next ? "retrying" : "failed", n + 1, ctx.now(), next ? ctx.now() + next : null, String((e as Error).message).slice(0, 200), deliveryId);
  }
}

export function startWebhookDispatcher(ctx: Ctx) {
  ctx.onEvent = (e) => {
    const hooks = ctx.db.all<any>("SELECT w.* FROM webhooks w JOIN integrations i ON i.id = w.integration_id WHERE w.active = 1 AND i.status = 'active'");
    for (const h of hooks) {
      if (!JSON.parse(h.events).includes(e.type)) continue;
      const id = Number(ctx.db.run("INSERT INTO webhook_deliveries (webhook_id, event_id, attempt, status, at) VALUES (?,?,1,'pending',?)", h.id, e.id, ctx.now()).lastInsertRowid);
      void attempt(ctx, id);
    }
  };
  const t = setInterval(() => {
    for (const d of ctx.db.all<{ id: number }>("SELECT id FROM webhook_deliveries WHERE status = 'retrying' AND next_at <= ?", ctx.now())) void attempt(ctx, d.id);
  }, 30_000);
  t.unref?.();
}

export function deliveries(ctx: Ctx, limit = 40) {
  return ctx.db.all<any>(`SELECT wd.id, wd.status, wd.http_status, wd.attempt, wd.at, wd.next_at, wd.error, w.url, e.type, i.partner
    FROM webhook_deliveries wd JOIN webhooks w ON w.id = wd.webhook_id JOIN events e ON e.id = wd.event_id JOIN integrations i ON i.id = w.integration_id ORDER BY wd.id DESC LIMIT ?`, limit);
}
