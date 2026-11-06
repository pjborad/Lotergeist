import type { Config } from "./config";
import type { Db } from "./db";

export interface OutgoingMessage { channel: "sms" | "email"; to: string; subject?: string; body: string; notificationId: number }

export interface Notifier {
  readonly name: string;
  send(msg: OutgoingMessage): void;
}

/**
 * Sandbox SMS and email providers (spec: "sandbox provider, numbers in the 555-01xx range, example.com addresses").
 * Nothing leaves this machine: every message is written to the `outbox` table and its status moves like a real
 * provider's would. Sandbox rules, in the style of Twilio's test numbers:
 *   - numbers ending in 99 fail (invalid), numbers ending in 13 stay queued (carrier delay), all others deliver
 *   - email is accepted on send and never bounces
 */
export class SandboxNotifier implements Notifier {
  readonly name = "sandbox";
  constructor(private db: Db, private cfg: Config) {}

  send(m: OutgoingMessage) {
    const now = Date.now();
    const id = Number(this.db.run("INSERT INTO outbox (channel, to_addr, subject, body, status, created_at, notification_id, provider) VALUES (?,?,?,?,?,?,?,?)",
      m.channel, m.to, m.subject ?? null, m.body, "queued", now, m.notificationId, this.name).lastInsertRowid);
    const set = (status: string, error: string | null = null, delivered = false) => {
      this.db.run("UPDATE outbox SET status = ?, delivered_at = ? WHERE id = ?", status, delivered ? Date.now() : null, id);
      this.db.run("UPDATE notifications SET status = ?, error = ?, sent_at = COALESCE(sent_at, ?), delivered_at = ? WHERE id = ?", status, error, Date.now(), delivered ? Date.now() : null, m.notificationId);
    };
    if (m.channel === "email") { set("sent"); return; }
    const digits = m.to.replace(/\D/g, "");
    if (digits.endsWith("99")) { set("failed", "Sandbox: number rejected"); return; }
    set("sent");
    if (digits.endsWith("13")) return; // stays "sent" (pending delivery receipt)
    const t = setTimeout(() => { try { set("delivered", null, true); } catch { /* db closed */ } }, this.cfg.sandboxDelayMs);
    t.unref?.();
  }
}
