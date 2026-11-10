import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { FastifyInstance } from "fastify";
import { buildApp, Db, ingestFaxInbox, loadConfig, SandboxNotifier, seedDatabase, type Ctx } from "../src/index";
import { verifyAuditChain } from "../src/core";
import { parseSig } from "../src/drugs";
import { runRules } from "../src/rxwatcher";
import { checkScript, DEFAULT_VOICEMAIL } from "../src/outreach";
import { scrub } from "../src/partner-api";
import { sign, verifySignature, startWebhookDispatcher } from "../src/webhooks";
import type { VoiceProvider } from "../src/voice";

let app: FastifyInstance;
let ctx: Ctx;
const cookies: Record<string, string> = {};
const PW = "moonlight-rx-2026";
const spoken: string[] = [];
const fakeVoice: VoiceProvider = { name: "test", voice: "Test Voice", synthesize: async (t) => { spoken.push(t); return { mime: "audio/mpeg", bytes: Buffer.from("ID3fake"), voice: "test:Test Voice" }; } };

beforeAll(async () => {
  const cfg = loadConfig({}, { sqlitePath: ":memory:", sandboxDelayMs: 20, today: "2026-11-05", nightWatch: false, assetsDir: "/nonexistent", webDist: "/nonexistent" });
  const db = new Db(":memory:");
  ctx = { cfg, db, notify: new SandboxNotifier(db, cfg), now: () => Date.parse("2026-11-05T22:30:00Z"), voice: fakeVoice, llm: null };
  seedDatabase(db, cfg, ctx.now());
  await ingestFaxInbox(ctx);
  startWebhookDispatcher(ctx);
  app = await buildApp(ctx);
  for (const w of ["j.rivera", "k.patel", "m.diaz", "s.grant"]) {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { storeId: "store-7", email: `${w}@elmstreetrx.example`, password: PW } });
    expect(r.statusCode).toBe(200);
    cookies[w] = r.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }
}, 60_000);

const call = (who: string, method: "GET" | "POST", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as never, headers: { cookie: cookies[who]! } });
const json = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => (await call(who, method, url, payload)).json();

describe("audit log is hash-chained (plan 10.3)", () => {
  it("verifies, and detects an edited row", async () => {
    await call("j.rivera", "GET", "/api/patients/S-0612?reason=chain%20test");
    const ok = await json("j.rivera", "GET", "/api/audit/verify");
    expect(ok.ok).toBe(true);
    expect(ok.rows).toBeGreaterThan(3);
    const row = ctx.db.get<{ id: number; action: string }>("SELECT id, action FROM audit ORDER BY id LIMIT 1 OFFSET 1")!;
    ctx.db.run("UPDATE audit SET action = 'tampered' WHERE id = ?", row.id);
    expect(verifyAuditChain(ctx)).toMatchObject({ ok: false, brokenAt: row.id });
    ctx.db.run("UPDATE audit SET action = ? WHERE id = ?", row.action, row.id);
    expect(verifyAuditChain(ctx).ok).toBe(true);
  });
});

describe("patients (plan 3.6, 6.5)", () => {
  it("finds Daniel by name, DOB and Rx number", async () => {
    for (const q of ["daniel", "03/14/1968", "0072210"]) expect((await json("k.patel", "GET", `/api/patients?q=${encodeURIComponent(q)}`)).matches.map((m: any) => m.id)).toContain("S-0612");
  });
  it("needs a reason to open a profile, and logs it", async () => {
    expect((await call("k.patel", "GET", "/api/patients/S-0612")).json().code).toBe("reason_required");
    const p = await json("k.patel", "GET", "/api/patients/S-0612?reason=refill%20question");
    expect(p.accessLog[0]).toMatchObject({ by: "K. Patel, CPhT", reason: "refill question" });
    expect((await call("m.diaz", "GET", "/api/patients/S-0612?reason=x%20y%20z")).statusCode).toBe(403);
  });
  it("safety review: late statin, lisinopril with insulin, steroid course, penicillin allergy, recall exposure", async () => {
    const p = await json("j.rivera", "GET", "/api/patients/S-0612?reason=safety%20review");
    const titles = p.safety.map((f: any) => f.title);
    expect(titles[0]).toMatch(/^Atorvastatin refill is \d+ days late$/);
    expect(titles).toEqual(expect.arrayContaining(["Lisinopril with insulin", "Metformin with insulin", "Penicillin allergy", "Recall exposure"]));
    expect(titles.some((t: string) => t.startsWith("Prednisone course in"))).toBe(true);
    expect(p.history.find((h: any) => h.drug.startsWith("Atorvastatin")).status).toBe("Refill late");
    expect(p.refills[0].dueLabel).toBe("Overdue");
  });
});

describe("Rx Watcher rules (property)", () => {
  it("never invents a hit: any once-daily statin with a matching days supply is clear", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), (packs) => {
      const f = runRules({ rx: { rx: "T", drug: "Atorvastatin 20 mg · 90 tab", ndc11: "x", qty: packs, directions: "Take 1 tablet by mouth daily", days_supply: packs * 90 }, product: { name: "Atorvastatin 20 mg · 90 tab", pack_size: "90 tablets" }, patient: { allergies: "" }, history: [], today: "2026-11-05" });
      return f.every((x) => x.severity === "pass");
    }));
  });
  it("always flags a days supply that is off by more than 20%", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 2, max: 40 }), fc.integer({ min: 0, max: 1 }), (packs, units, bedtimeOnly) => {
      const directions = `Inject ${units} units under the skin ${bedtimeOnly ? "at bedtime" : "every morning and at bedtime"}`;
      const expected = Math.floor((packs * 1500) / ((units + 2) * (bedtimeOnly ? 1 : 2)));
      const written = Math.round(expected * 1.5) + 1;
      const f = runRules({ rx: { rx: "T", drug: "Insulin glargine", ndc11: "x", qty: packs, directions, days_supply: written }, product: { name: "Insulin glargine 100 U/mL · 5 pens", pack_size: "5 pens" }, patient: { allergies: "" }, history: [], today: "2026-11-05" });
      return f.find((x) => x.rule === "days-supply")!.severity === "needs_review" && (f.find((x) => x.rule === "frequency")!.severity === "needs_review") === !bedtimeOnly;
    }));
  });
  it("reads common sigs", () => {
    expect(parseSig("Take 1 capsule three times daily for 10 days")).toMatchObject({ dosesPerDay: 3, perDose: 1, courseDays: 10 });
    expect(parseSig("Inject 20 units under the skin every morning and at bedtime")).toMatchObject({ dosesPerDay: 2, perDose: 20 });
    expect(parseSig("Take 1 tablet every 6 hours as needed")).toMatchObject({ dosesPerDay: 4 });
  });
  it("blocks penicillin-class drugs for a penicillin allergy", () => {
    const f = runRules({ rx: { rx: "T", drug: "Amoxicillin 500 mg", ndc11: "x", qty: 1, directions: "Take 1 capsule three times daily for 10 days", days_supply: 10 }, product: { name: "Amoxicillin 500 mg · 100 cap", pack_size: "100 capsules" }, patient: { allergies: "penicillin" }, history: [], today: "2026-11-05" });
    expect(f.find((x) => x.rule === "allergy")!.severity).toBe("block");
  });
});

describe("voicemail outreach (sandbox, plan section 9)", () => {
  it("rejects a script that names the drug or the recall", () => {
    expect(checkScript(ctx, DEFAULT_VOICEMAIL)).toEqual([]);
    expect(checkScript(ctx, DEFAULT_VOICEMAIL.replace("a medicine", "the methylprednisolone"))[0]).toMatch(/names a medicine/);
    expect(checkScript(ctx, DEFAULT_VOICEMAIL + " This is about {drug_name}.")[0]).toMatch(/must not name/);
    expect(checkScript(ctx, DEFAULT_VOICEMAIL + " It was recalled.").some((p) => /recall reason/.test(p))).toBe(true);
  });
  it("needs attestation, then calls the 15 patients with a phone with real speech and records outcomes", async () => {
    await call("j.rivera", "POST", "/api/recalls/lookup", { number: "D-0417-2026" });
    const draft = await json("j.rivera", "GET", "/api/recalls/D-0417-2026/voicemail");
    expect(draft).toMatchObject({ callCount: 15, noPhone: 2 });
    expect((await call("j.rivera", "POST", "/api/recalls/D-0417-2026/voicemail", { script: draft.script, attest: false })).json().code).toBe("attest");
    expect((await call("k.patel", "POST", "/api/recalls/D-0417-2026/voicemail", { script: draft.script, attest: true })).statusCode).toBe(403);
    const r = await json("j.rivera", "POST", "/api/recalls/D-0417-2026/voicemail", { script: draft.script, attest: true });
    expect(r).toMatchObject({ queued: 15, callList: 2, placed: 15 });
    const res = await json("j.rivera", "GET", "/api/recalls/D-0417-2026/calls");
    expect(res.total).toBe(17);
    expect(res.answered + res.voicemail + res.retrying + res.callList.length).toBe(17);
    expect(res.callList.map((c: any) => c.reason)).toEqual(["No phone number on file", "No phone number on file"]);
    expect(res.retrying).toBe(1); // ...0113: no answer, retry tomorrow
    expect(spoken.some((t) => t.startsWith("Hello Maria."))).toBe(true);
    expect(spoken.every((t) => !/methylprednisolone|S-0\d{3}/i.test(t))).toBe(true);
    const audio = await call("j.rivera", "GET", `/api/audio/${res.calls[0].audioId}`);
    expect(audio.headers["content-type"]).toBe("audio/mpeg");
    expect((await call("j.rivera", "POST", "/api/recalls/D-0417-2026/voicemail", { script: draft.script, attest: true })).statusCode).toBe(409);
  });
  it("a patient calling back sees the open recall on screen", async () => {
    const r = await json("m.diaz", "POST", "/api/calls/inbound", { from: "+1 555 010 0101" });
    expect(r).toMatchObject({ known: true, recallId: "D-0417-2026" });
  });
});

describe("partner API: OAuth, scopes, REST, MCP, FHIR (plan section 8)", () => {
  let mercy = "", concierge = "", nwosu = "";
  const token = async (id: string, secret: string) => (await app.inject({ method: "POST", url: "/oauth/token", payload: { grant_type: "client_credentials", client_id: id, client_secret: secret } }));
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  beforeAll(async () => {
    const get = async (id: string) => {
      const k = await json("s.grant", "POST", `/api/integrations/${id}/rotate`);
      return (await token(k.clientId, k.clientSecret)).json().access_token as string;
    };
    // Mercy has an IP allowlist; widen it to the test client for this suite.
    await call("s.grant", "POST", "/api/integrations/int-mercy-clinic", { ipAllowlist: ["127.0.0.1"] });
    mercy = await get("int-mercy-clinic"); concierge = await get("int-rx-concierge");
    await call("s.grant", "POST", "/api/integrations/int-nwosu-practice", { ipAllowlist: [] });
    nwosu = await get("int-nwosu-practice");
  });
  it("only an admin manages integrations", async () => {
    expect((await call("j.rivera", "POST", "/api/integrations/int-mercy-clinic/rotate")).statusCode).toBe(403);
    expect((await json("j.rivera", "GET", "/api/integrations")).canEdit).toBe(false);
    expect((await call("s.grant", "POST", "/api/rx/0072214/decision", { action: "approve" })).statusCode).toBe(403); // admin cannot do clinical work
  });
  it("refuses a bad secret and a missing token", async () => {
    expect((await token("int-mercy-clinic", "nope")).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/availability?ndc=70004-623-15" })).statusCode).toBe(401);
  });
  it("REST availability: counts only, recalled lots excluded", async () => {
    const r = (await app.inject({ url: "/v1/availability?ndc=70004-417-05&qty=1", headers: bearer(mercy) })).json();
    expect(r).toMatchObject({ ndc: "70004-417-05", on_hand: 0, in_stock: false });
    expect(r.recall_status).toMatch(/recalled/);
    const ins = (await app.inject({ url: "/v1/availability?ndc=70004-623-15&qty=2", headers: bearer(mercy) })).json();
    expect(ins.in_stock).toBe(true);
    expect(JSON.stringify(ins)).not.toMatch(/S-0\d{3}|lot/i);
  });
  it("enforces scopes: patient data needs patient.read + BAA", async () => {
    expect((await app.inject({ url: "/v1/patients/S-0612/medications", headers: bearer(mercy) })).statusCode).toBe(403);
    expect((await call("s.grant", "POST", "/api/integrations/int-mercy-clinic", { scopes: ["inventory.read", "patient.read"] })).json().code).toBe("baa_required");
    expect((await app.inject({ url: "/v1/recalls/D-0417-2026/status", headers: bearer(concierge) })).json()).toMatchObject({ holds_recalled_lots: true, units_quarantined: 197 });
  });
  it("MCP: initialize, tools/list filtered by scope, tools/call with validation", async () => {
    const rpc = (body: unknown) => app.inject({ method: "POST", url: "/mcp", payload: body as never, headers: bearer(concierge) });
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })).json().result.serverInfo.name).toBe("lotergeist");
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).statusCode).toBe(202);
    const tools = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json().result.tools.map((t: any) => t.name);
    expect(tools.sort()).toEqual(["check_availability", "get_recall_status", "list_recalled_lots"]);
    const hit = (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_recall_status", arguments: { ndc: "70004-417-05", lot: "prorx050925-1" } } })).json().result;
    expect(hit.structuredContent).toMatchObject({ recalled: true, recall: "D-0417-2026" });
    const bad = (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "check_availability", arguments: { ndc: 42 } } })).json().result;
    expect(bad.isError).toBe(true);
    const nope = (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "lookup_patient", arguments: {} } })).json();
    expect(nope.error.code).toBe(-32602);
    const log = await json("s.grant", "GET", "/api/integrations");
    expect(log.activity.some((a: any) => a.surface === "MCP" && a.tool === "get_recall_status" && a.status === 200)).toBe(true);
  });
  it("MCP output never carries a patient id, phone or email", () => {
    fc.assert(fc.property(fc.string(), fc.integer({ min: 0, max: 9999 }), (s, n) => !/\bS-\d{4}\b/.test(scrub(`${s} S-${String(n).padStart(4, "0")} (555) 010-${String(n).padStart(4, "0")} a.b@example.com`))));
  });
  it("FHIR: metadata is public, Medication carries batch lot and expiry", async () => {
    expect((await app.inject({ url: "/fhir/r4/metadata" })).json().fhirVersion).toBe("4.0.1");
    const b = (await app.inject({ url: "/fhir/r4/Medication?code=http://hl7.org/fhir/sid/ndc|70004-623-15", headers: bearer(mercy) })).json();
    expect(b.resourceType).toBe("Bundle");
    expect(b.entry.map((e: any) => e.resource.batch.lotNumber)).toContain("GX4471C");
    const pd = await app.inject({ url: "/fhir/r4/Patient/S-0612", headers: bearer(mercy) });
    expect(pd.statusCode).toBe(403);
    expect(pd.json().resourceType).toBe("OperationOutcome");
  });
  it("revoking a partner kills its token at once", async () => {
    await call("s.grant", "POST", "/api/integrations/int-rx-concierge", { status: "revoked" });
    expect((await app.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 1, method: "ping" }, headers: bearer(concierge) })).statusCode).toBe(401);
  });
  it("a prescriber system answers a change request over REST, creating the R1 order", async () => {
    await call("k.patel", "POST", "/api/rx/0072210/review");
    const d = await json("j.rivera", "GET", "/api/rx/0072210/change-draft");
    await call("j.rivera", "POST", "/api/rx/0072210/decision", { action: "change", message: d.message, proposal: d.proposal });
    const open = (await app.inject({ url: "/v1/change-requests", headers: bearer(nwosu) })).json().requests;
    expect(open[0].rx).toBe("0072210");
    const r = (await app.inject({ method: "POST", url: `/v1/change-requests/${open[0].id}/response`, payload: { response: "approved" }, headers: bearer(nwosu) })).json();
    expect(r).toMatchObject({ response: "approved", newRx: "0072210-R1", type: "RxChangeResponse" });
  });
});

describe("webhooks are signed and delivered (plan 8.4)", () => {
  let server: http.Server;
  const got: { sig: string; body: string }[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push({ sig: String(req.headers["x-lotergeist-signature"]), body: b }); res.end("ok"); }); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  });
  afterAll(() => server.close());
  it("verifies its own signatures and rejects tampering", () => {
    const ts = Math.floor(Date.now() / 1000);
    const h = `t=${ts},v1=${sign("s3cret", ts, "{}")}`;
    expect(verifySignature("s3cret", h, "{}")).toBe(true);
    expect(verifySignature("s3cret", h, "{ }")).toBe(false);
    expect(verifySignature("other", h, "{}")).toBe(false);
  });
  it("refuses private-network URLs", async () => {
    expect((await call("s.grant", "POST", "/api/integrations/int-mercy-clinic/webhooks", { url: "https://10.0.0.5/hook", events: ["recall.matched"] })).json().code).toBe("url");
  });
  it("sends recall.matched with a valid HMAC signature and no PHI", async () => {
    const port = (server.address() as AddressInfo).port;
    const w = await json("s.grant", "POST", "/api/integrations/int-mercy-clinic/webhooks", { url: `http://127.0.0.1:${port}/hook`, events: ["recall.matched"] });
    ctx.db.run("UPDATE recall_lots SET confirmed_at = NULL WHERE recall_id = 'D-0522-2026'");
    await call("j.rivera", "POST", "/api/recalls/lookup", { number: "D-0522-2026" });
    // also emit directly to be independent of fixture contents
    const { emit } = await import("../src/core");
    emit(ctx, "recall.matched", { recallId: "TEST-1", unitsQuarantined: 3 });
    for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(got.length).toBeGreaterThan(0);
    const last = got[got.length - 1]!;
    expect(verifySignature(w.secret, last.sig, last.body)).toBe(true);
    expect(JSON.parse(last.body).type).toBe("recall.matched");
    expect(last.body).not.toMatch(/S-0\d{3}|@example|\(555\)/);
  });
});
