import crypto from "node:crypto";
import { audit, HttpError, verifyAuditChain, type Actor, type Ctx } from "./core";

/**
 * Partner systems and AI agents (plan sections 8 and 10.4). Each partner or agent is its own account with its
 * own client secret, least-privilege scopes, optional IP allowlist and rate limit. Access tokens come from the
 * OAuth 2.0 client-credentials grant and expire after one hour. Every call is written to api_log.
 */

export const SCOPES = {
  "availability.check": "Check if a product is in stock (no lot or patient detail)",
  "inventory.read": "Stock by product, with lot and expiry for FHIR Medication",
  "recall.read": "Whether this store holds recalled lots",
  "rx.change": "Read and answer prescriber change requests",
  "patient.read": "Patient medication history. Needs a signed BAA and admin approval"
} as const;
export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];
export const DEFAULT_MCP_TOOLS = ["check_availability", "get_recall_status", "list_recalled_lots"] as const;

export type Kind = "REST" | "MCP" | "FHIR";
export interface Partner { id: string; partner: string; kind: Kind; status: "active" | "revoked"; scopes: Scope[]; keyPrefix: string; ipAllowlist: string[]; baa: boolean; approvedBy: string | null; purpose: string; createdAt: number; lastUsed: number | null; ratePerMin: number; note: string }

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const toPartner = (r: any): Partner => ({
  id: r.id, partner: r.partner, kind: r.kind, status: r.status, scopes: JSON.parse(r.scopes || "[]"), keyPrefix: r.key_prefix, ipAllowlist: JSON.parse(r.ip_allowlist || "[]"),
  baa: !!r.baa, approvedBy: r.approved_by, purpose: r.purpose ?? "", createdAt: r.created_at, lastUsed: r.last_used, ratePerMin: r.rate_per_min, note: r.note ?? ""
});

const needAdmin = (a: Actor) => { if (a.role !== "admin") throw new HttpError(403, "Only an admin can change integrations or security settings.", "forbidden"); };

function newSecret() {
  const secret = `lgs_${crypto.randomBytes(24).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 10), hash: sha(secret) };
}

/** Rules that hold whatever the admin clicks: patient data needs a BAA and an admin's approval (plan 10.4). */
function checkScopes(scopes: Scope[], baa: boolean) {
  for (const s of scopes) if (!ALL_SCOPES.includes(s)) throw new HttpError(422, `Unknown scope ${s}.`, "scope");
  if (scopes.includes("patient.read") && !baa) throw new HttpError(422, "patient.read needs a signed BAA on file first.", "baa_required");
}

export function listPartners(ctx: Ctx) {
  return ctx.db.all<any>("SELECT * FROM integrations ORDER BY created_at").map((r) => {
    const p = toPartner(r);
    const day = ctx.db.get<{ n: number; denied: number }>("SELECT count(*) AS n, sum(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS denied FROM api_log WHERE integration_id = ? AND at > ?", p.id, ctx.now() - 86_400_000)!;
    return { ...p, calls24h: day.n, denied24h: day.denied ?? 0, webhooks: ctx.db.all("SELECT id, url, events, active FROM webhooks WHERE integration_id = ?", p.id).map((w: any) => ({ ...w, events: JSON.parse(w.events), active: !!w.active })) };
  });
}

export function createPartner(ctx: Ctx, actor: Actor, b: { partner: string; kind: Kind; scopes: Scope[]; ipAllowlist?: string[]; baa?: boolean; purpose?: string; ratePerMin?: number }) {
  needAdmin(actor);
  checkScopes(b.scopes, !!b.baa);
  if (b.scopes.includes("patient.read") && (b.purpose ?? "").trim().length < 10) throw new HttpError(422, "Write the documented purpose for patient access.", "purpose");
  const id = `int-${b.partner.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24)}-${crypto.randomBytes(2).toString("hex")}`;
  const k = newSecret();
  ctx.db.run("INSERT INTO integrations (id, partner, kind, status, scopes, key_prefix, key_hash, ip_allowlist, baa, approved_by, purpose, created_at, rate_per_min) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, b.partner, b.kind, "active", JSON.stringify(b.scopes), k.prefix, k.hash, JSON.stringify(b.ipAllowlist ?? []), b.baa ? 1 : 0, b.scopes.includes("patient.read") ? actor.name : null, b.purpose ?? "", ctx.now(), b.ratePerMin ?? 120);
  audit(ctx, actor, "integration.create", "integration", id, undefined, { partner: b.partner, kind: b.kind, scopes: b.scopes });
  return { partner: toPartner(ctx.db.get("SELECT * FROM integrations WHERE id = ?", id)), clientId: id, clientSecret: k.secret };
}

export function updatePartner(ctx: Ctx, actor: Actor, id: string, b: { scopes?: Scope[]; ipAllowlist?: string[]; baa?: boolean; purpose?: string; status?: "active" | "revoked"; ratePerMin?: number }) {
  needAdmin(actor);
  const cur = ctx.db.get<any>("SELECT * FROM integrations WHERE id = ?", id);
  if (!cur) throw new HttpError(404, "Unknown integration.");
  const before = toPartner(cur);
  const scopes = b.scopes ?? before.scopes, baa = b.baa ?? before.baa;
  checkScopes(scopes, baa);
  const purpose = b.purpose ?? before.purpose;
  if (scopes.includes("patient.read") && !before.scopes.includes("patient.read") && purpose.trim().length < 10) throw new HttpError(422, "Write the documented purpose for patient access.", "purpose");
  const approvedBy = scopes.includes("patient.read") ? (before.scopes.includes("patient.read") ? before.approvedBy : actor.name) : null;
  ctx.db.run("UPDATE integrations SET scopes = ?, ip_allowlist = ?, baa = ?, purpose = ?, status = ?, rate_per_min = ?, approved_by = ? WHERE id = ?",
    JSON.stringify(scopes), JSON.stringify(b.ipAllowlist ?? before.ipAllowlist), baa ? 1 : 0, purpose, b.status ?? before.status, b.ratePerMin ?? before.ratePerMin, approvedBy, id);
  // Narrowing scopes or revoking takes effect now: drop live tokens.
  ctx.db.run("DELETE FROM oauth_tokens WHERE integration_id = ?", id);
  const after = toPartner(ctx.db.get("SELECT * FROM integrations WHERE id = ?", id));
  audit(ctx, actor, b.status === "revoked" ? "integration.revoke" : "integration.update", "integration", id, { scopes: before.scopes, status: before.status }, { scopes: after.scopes, status: after.status });
  return after;
}

export function rotateSecret(ctx: Ctx, actor: Actor, id: string) {
  needAdmin(actor);
  if (!ctx.db.get("SELECT 1 FROM integrations WHERE id = ?", id)) throw new HttpError(404, "Unknown integration.");
  const k = newSecret();
  ctx.db.run("UPDATE integrations SET key_prefix = ?, key_hash = ? WHERE id = ?", k.prefix, k.hash, id);
  ctx.db.run("DELETE FROM oauth_tokens WHERE integration_id = ?", id);
  audit(ctx, actor, "integration.rotate", "integration", id);
  return { clientId: id, clientSecret: k.secret };
}

// ------------------------------------------------------------------ OAuth 2.0 client credentials

export function issueToken(ctx: Ctx, clientId: string, clientSecret: string, requested?: string) {
  const r = ctx.db.get<any>("SELECT * FROM integrations WHERE id = ?", clientId);
  const bad = new HttpError(401, "invalid_client", "invalid_client");
  if (!r || r.status !== "active") throw bad;
  const a = Buffer.from(sha(clientSecret)), b = Buffer.from(r.key_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw bad;
  const granted: Scope[] = JSON.parse(r.scopes);
  const want = requested ? (requested.split(/\s+/).filter(Boolean) as Scope[]) : granted;
  const scopes = want.filter((s) => granted.includes(s));
  if (requested && scopes.length < want.length) throw new HttpError(400, "invalid_scope", "invalid_scope");
  const token = `lga_${crypto.randomBytes(32).toString("base64url")}`;
  const ttl = 3600;
  ctx.db.run("DELETE FROM oauth_tokens WHERE expires < ?", ctx.now());
  ctx.db.run("INSERT INTO oauth_tokens (token_hash, integration_id, scopes, expires, created) VALUES (?,?,?,?,?)", sha(token), clientId, JSON.stringify(scopes), ctx.now() + ttl * 1000, ctx.now());
  return { access_token: token, token_type: "Bearer", expires_in: ttl, scope: scopes.join(" ") };
}

export interface Caller { partner: Partner; scopes: Scope[] }

const windows = new Map<string, number[]>();

/** Resolve a bearer token, then apply IP allowlist and per-partner rate limit. */
export function authenticate(ctx: Ctx, authz: string | undefined, ip: string): Caller {
  const m = /^Bearer\s+(\S+)$/i.exec(authz ?? "");
  if (!m) throw new HttpError(401, "Missing bearer token. Get one from POST /oauth/token.", "unauthenticated");
  const t = ctx.db.get<any>("SELECT * FROM oauth_tokens WHERE token_hash = ?", sha(m[1]!));
  if (!t || t.expires < ctx.now()) throw new HttpError(401, "Token expired or unknown.", "invalid_token");
  const r = ctx.db.get<any>("SELECT * FROM integrations WHERE id = ?", t.integration_id);
  if (!r || r.status !== "active") throw new HttpError(401, "This integration is revoked.", "invalid_token");
  const partner = toPartner(r);
  if (partner.ipAllowlist.length && !partner.ipAllowlist.includes(ip)) throw new HttpError(403, `IP ${ip} is not on this integration's allowlist.`, "ip_denied");
  const now = Date.now();
  const w = (windows.get(partner.id) ?? []).filter((x) => now - x < 60_000);
  if (w.length >= partner.ratePerMin) throw new HttpError(429, "Rate limit reached. Slow down.", "rate_limited");
  w.push(now); windows.set(partner.id, w);
  ctx.db.run("UPDATE integrations SET last_used = ? WHERE id = ?", ctx.now(), partner.id);
  // Live check: scopes are the token's, intersected with what the partner holds right now.
  const scopes = (JSON.parse(t.scopes) as Scope[]).filter((s) => partner.scopes.includes(s));
  return { partner, scopes };
}

export function requireScope(c: Caller, scope: Scope) {
  if (!c.scopes.includes(scope)) throw new HttpError(403, `This integration does not have the ${scope} scope.`, "insufficient_scope");
  if (scope === "patient.read" && (!c.partner.baa || !c.partner.approvedBy)) throw new HttpError(403, "Patient data needs a signed BAA and admin approval.", "baa_required");
}

export function logCall(ctx: Ctx, e: { integrationId: string | null; surface: "REST" | "MCP" | "FHIR" | "OAUTH"; method: string; path: string; tool?: string; status: number; latencyMs: number; args?: unknown; denied?: string }) {
  ctx.db.run("INSERT INTO api_log (at, integration_id, surface, method, path, tool, status, latency_ms, args_hash, denied) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ctx.now(), e.integrationId, e.surface, e.method, e.path.split("?")[0], e.tool ?? null, e.status, e.latencyMs, e.args === undefined ? null : sha(JSON.stringify(e.args)).slice(0, 16), e.denied ?? null);
}

export function apiActivity(ctx: Ctx, limit = 60) {
  return ctx.db.all<any>("SELECT a.*, i.partner FROM api_log a LEFT JOIN integrations i ON i.id = a.integration_id ORDER BY a.id DESC LIMIT ?", limit)
    .map((r) => ({ id: r.id, at: r.at, partner: r.partner ?? "unknown client", surface: r.surface, method: r.method, path: r.path, tool: r.tool, status: r.status, latencyMs: r.latency_ms, denied: r.denied }));
}

export function securityPosture(ctx: Ctx) {
  const chain = verifyAuditChain(ctx);
  const partners = listPartners(ctx);
  const day = ctx.now() - 86_400_000;
  const denials = ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM api_log WHERE at > ? AND status IN (401,403,429)", day)!.n;
  const offHours = ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM api_log WHERE at > ? AND CAST(strftime('%H', at / 1000, 'unixepoch') AS INTEGER) BETWEEN 7 AND 10", day)!.n; // 2-5 AM Eastern
  return {
    auditChain: chain,
    tokenTtlMinutes: 60,
    partnersWithPatientRead: partners.filter((p) => p.scopes.includes("patient.read")).map((p) => p.partner),
    partnersWithoutAllowlist: partners.filter((p) => p.status === "active" && !p.ipAllowlist.length).map((p) => p.partner),
    denials24h: denials,
    offHoursCalls24h: offHours,
    checks: [
      { label: "Audit log hash chain intact", ok: chain.ok, detail: chain.ok ? `${chain.rows} entries verified` : `Broken at entry ${chain.brokenAt}` },
      { label: "Access tokens expire in 1 hour", ok: true, detail: "OAuth 2.0 client credentials" },
      { label: "Patient data only with BAA + admin approval", ok: partners.every((p) => !p.scopes.includes("patient.read") || (p.baa && p.approvedBy)), detail: "Enforced on every call" },
      { label: "Webhooks signed with HMAC-SHA256", ok: true, detail: "X-Lotergeist-Signature header" },
      { label: "Every active partner has an IP allowlist", ok: partners.filter((p) => p.status === "active").every((p) => p.ipAllowlist.length > 0), detail: partners.filter((p) => p.status === "active" && !p.ipAllowlist.length).map((p) => p.partner).join(", ") || "All set" },
      { label: "No unusual denials in 24 hours", ok: denials < 20, detail: `${denials} denied call${denials === 1 ? "" : "s"}` }
    ]
  };
}

/** Synthetic partners for the demo. Their secrets are random and never printed; an admin rotates to get one. */
export function seedPartners(ctx: Ctx) {
  if (ctx.db.get("SELECT 1 FROM integrations")) return;
  const add = (id: string, partner: string, kind: Kind, scopes: Scope[], ip: string[], note: string, baa = false, approvedBy: string | null = null, purpose = "") => {
    const k = newSecret();
    ctx.db.run("INSERT INTO integrations (id, partner, kind, status, scopes, key_prefix, key_hash, ip_allowlist, baa, approved_by, purpose, created_at, rate_per_min, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, partner, kind, "active", JSON.stringify(scopes), k.prefix, k.hash, JSON.stringify(ip), baa ? 1 : 0, approvedBy, purpose, ctx.now() - 30 * 86_400_000, 120, note);
  };
  add("int-mercy-clinic", "Mercy Clinic EHR (synthetic)", "FHIR", ["availability.check", "inventory.read", "recall.read"], ["10.20.0.15"], "Hospital clinic checks stock before discharge prescriptions");
  add("int-rx-concierge", "Rx Concierge agent (synthetic)", "MCP", ["availability.check", "recall.read"], [], "Patient-facing AI agent: availability and recall status only");
  add("int-nwosu-practice", "Dr. Nwosu practice system (synthetic)", "REST", ["rx.change"], ["10.20.4.2"], "Answers prescriber change requests");
}
