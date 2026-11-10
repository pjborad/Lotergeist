import { HttpError, type Actor, type Ctx } from "./core";
import { newToken, verifyPassword, type Role } from "./domain";

const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;

export interface SessionUser { id: string; firstName: string; name: string; role: Role; initials: string; title: string; tint: string; storeId: string; email: string }

const toUser = (u: any): SessionUser => ({ id: u.id, firstName: u.first_name ?? u.name, name: u.name, role: u.role, initials: u.initials, title: u.title, tint: u.tint, storeId: u.store_id, email: u.email });

export function login(ctx: Ctx, body: { storeId: string; email: string; password: string; trusted: boolean; workstation: string }) {
  const u = ctx.db.get<any>("SELECT * FROM users WHERE lower(email) = lower(?)", body.email.trim());
  const now = ctx.now();
  // The same wording for "no such user" and "wrong password": do not reveal which staff emails exist.
  const wrong = new HttpError(401, "Email or password is incorrect.", "bad_credentials");
  if (!u || u.store_id !== body.storeId) throw wrong;
  if (u.locked_until > now) {
    const mins = Math.ceil((u.locked_until - now) / 60_000);
    throw new HttpError(423, `Too many wrong passwords. This account is locked for ${mins} more minute${mins === 1 ? "" : "s"}.`, "locked");
  }
  if (!verifyPassword(body.password, u.pw_hash)) {
    const failed = u.failed + 1;
    if (failed >= LOCK_AFTER) {
      ctx.db.run("UPDATE users SET failed = 0, locked_until = ? WHERE id = ?", now + LOCK_MS, u.id);
      throw new HttpError(423, "Too many wrong passwords. This account is locked for 15 minutes.", "locked");
    }
    ctx.db.run("UPDATE users SET failed = ? WHERE id = ?", failed, u.id);
    throw new HttpError(401, `Email or password is incorrect. ${LOCK_AFTER - failed} attempt${LOCK_AFTER - failed === 1 ? "" : "s"} left.`, "bad_credentials");
  }
  ctx.db.run("UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?", u.id);
  const token = newToken();
  const ttl = body.trusted ? 12 * 3_600_000 : 2 * 3_600_000; // "trust this workstation for 12 hours"
  ctx.db.run("INSERT INTO sessions (token, user_id, created, expires, trusted, workstation) VALUES (?,?,?,?,?,?)", token, u.id, now, now + ttl, body.trusted ? 1 : 0, body.workstation);
  return { token, ttl, user: toUser(u) };
}

export function actorFromToken(ctx: Ctx, token: string | undefined): { actor: Actor; user: SessionUser } | null {
  if (!token) return null;
  const s = ctx.db.get<any>("SELECT * FROM sessions WHERE token = ?", token);
  if (!s || s.expires < ctx.now()) {
    if (s) ctx.db.run("DELETE FROM sessions WHERE token = ?", token);
    return null;
  }
  const u = ctx.db.get<any>("SELECT * FROM users WHERE id = ?", s.user_id);
  if (!u) return null;
  return { actor: { id: u.id, name: u.name, role: u.role, storeId: u.store_id, workstation: s.workstation }, user: toUser(u) };
}

export const logout = (ctx: Ctx, token: string) => { ctx.db.run("DELETE FROM sessions WHERE token = ?", token); };
