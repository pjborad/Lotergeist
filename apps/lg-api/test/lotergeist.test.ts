import { beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { FastifyInstance } from "fastify";
import { buildGs1 } from "./helpers";
import { buildApp, Db, ingestFaxInbox, loadConfig, SandboxNotifier, seedDatabase, type Ctx } from "../src/index";
import { ledgerViolations } from "../src/inventory";
import { parseLabelText } from "../src/ocr-text";

let app: FastifyInstance;
let ctx: Ctx;
const cookies: Record<string, string> = {};

async function boot() {
  const cfg = loadConfig({}, { sqlitePath: ":memory:", sandboxDelayMs: 20, today: "2026-11-05", nightWatch: false, assetsDir: "/nonexistent", webDist: "/nonexistent" });
  const db = new Db(":memory:");
  const c: Ctx = { cfg, db, notify: new SandboxNotifier(db, cfg), now: () => Date.parse("2026-11-05T22:30:00Z") };
  seedDatabase(db, cfg, c.now());
  await ingestFaxInbox(c);
  return { c, a: await buildApp(c) };
}

const PW = "moonlight-rx-2026";
async function signIn(who: "j.rivera" | "k.patel" | "m.diaz") {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { storeId: "store-7", email: `${who}@elmstreetrx.example`, password: PW, trusted: true } });
  expect(r.statusCode).toBe(200);
  cookies[who] = r.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}
const call = (who: keyof typeof cookies, method: "GET" | "POST", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as never, headers: { cookie: cookies[who]! } });
const json = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => (await call(who, method, url, payload)).json();

beforeAll(async () => {
  const b = await boot();
  ctx = b.c; app = b.a;
  for (const w of ["j.rivera", "k.patel", "m.diaz"] as const) await signIn(w);
}, 60_000);

describe("sign in and roles", () => {
  it("rejects the API without a session", async () => {
    expect((await app.inject({ url: "/api/today" })).statusCode).toBe(401);
  });
  it("locks the account for 15 minutes after 5 wrong passwords", async () => {
    for (let i = 0; i < 4; i++) expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { storeId: "store-7", email: "m.diaz@elmstreetrx.example", password: "nope" } })).statusCode).toBe(401);
    const fifth = await app.inject({ method: "POST", url: "/api/auth/login", payload: { storeId: "store-7", email: "m.diaz@elmstreetrx.example", password: "nope" } });
    expect(fifth.statusCode).toBe(423);
    const right = await app.inject({ method: "POST", url: "/api/auth/login", payload: { storeId: "store-7", email: "m.diaz@elmstreetrx.example", password: PW } });
    expect(right.statusCode).toBe(423);
    ctx.db.run("UPDATE users SET locked_until = 0 WHERE id = 'u-diaz'"); // time passes
    await signIn("m.diaz");
  });
  it("a technician cannot start a recall; a cashier cannot scan at the bench", async () => {
    expect((await call("k.patel", "POST", "/api/recalls/lookup", { number: "D-0417-2026" })).statusCode).toBe(403);
    expect((await call("m.diaz", "POST", "/api/rx/0072210/scan", { raw: "x" })).statusCode).toBe(403);
  });
});

describe("the ledger starts as the mockups describe", () => {
  it("has the recalled lots at 112 and 85 on hand, 197 together", async () => {
    const lots = (await json("j.rivera", "GET", "/api/lots?q=PRORX")).rows;
    expect(lots.map((l: any) => [l.lot, l.received, l.dispensed, l.onHand])).toEqual([["PRORX050925-1", 122, 10, 112], ["PRORX050925-3", 92, 7, 85]]);
  });
  it("shows the recall banner on Today with 2 lots, 197 units and 17 patients", async () => {
    const t = await json("j.rivera", "GET", "/api/today");
    expect(t.banner).toMatchObject({ id: "D-0417-2026", lotsReceived: 2, units: 197, patients: 17 });
    expect(t.expiring.map((e: any) => e.n)).toEqual([6, 9, 8, 4, 3]);
    expect(t.badges).toMatchObject({ receiving: 2, recalls: 1 });
  });
  it("the ledger reconciles", () => {
    expect(ledgerViolations(ctx)).toEqual([]);
  });
});

describe("receiving: scan, check, put away", () => {
  let pkgId = 0;
  it("a good package passes four checks and is told where to go", async () => {
    const raw = buildGs1("70004-226-01", "AMX0926B", "2028-09-30", "10443850");
    const r = await json("k.patel", "POST", "/api/deliveries/ASH-1105-07/scan", { raw });
    expect(r.checks.map((c: any) => [c.id, c.state])).toEqual([["invoice", "pass"], ["tits", "pass"], ["expiry", "pass"], ["recall", "pass"]]);
    expect(r.suggestion.location).toMatch(/^Aisle 2 · Bay [ABC] · Shelf \d · Bin \d+$/);
    expect(r.canConfirm).toBe(true);
    pkgId = r.packageId;
  });
  it("confirming adds it to inventory and moves the progress bar", async () => {
    const before = (await json("k.patel", "GET", "/api/deliveries/ASH-1105-07")).checkedIn;
    const d = await json("k.patel", "POST", `/api/packages/${pkgId}/putaway`, {});
    expect(d.checkedIn).toBe(before + 1);
    const lot = (await json("k.patel", "GET", "/api/lots?q=AMX0926B")).rows[0];
    expect(lot.onHand).toBe(14);
  });
  it("a serial that was already received is refused", async () => {
    const raw = buildGs1("70004-226-01", "AMX0926B", "2028-09-30", "10443850");
    expect((await call("k.patel", "POST", "/api/deliveries/ASH-1105-07/scan", { raw })).statusCode).toBe(409);
  });
  it("a serial missing from the supplier's transaction information fails the TI/TS check and can only be reported", async () => {
    const raw = buildGs1("70004-310-10", "OX25L072", "2028-03-31", "99999999");
    const r = await json("k.patel", "POST", "/api/deliveries/ASH-1105-07/scan", { raw });
    expect(r.checks.find((c: any) => c.id === "tits").state).toBe("fail");
    expect(r.canConfirm).toBe(false);
    expect((await call("k.patel", "POST", `/api/packages/${r.packageId}/putaway`, {})).statusCode).toBe(409);
    const d = await json("k.patel", "POST", `/api/packages/${r.packageId}/problem`, { kind: "suspect", note: "serial not in TI" });
    expect(d.lines.find((l: any) => l.name.startsWith("Oxycodone")).qty).toBe("1 / 1");
    expect(ctx.db.get<any>("SELECT status, location FROM packages WHERE id = ?", r.packageId)).toMatchObject({ status: "quarantined", location: "Quarantine Q-1" });
  });
  it("an expired package fails the expiry check", async () => {
    const raw = buildGs1("70004-623-15", "GX4471C", "2026-12-31", "0000932");
    const r = await json("k.patel", "POST", "/api/deliveries/ASH-1105-07/scan", { raw });
    expect(r.checks.find((c: any) => c.id === "expiry")).toMatchObject({ state: "fail" });
    await json("k.patel", "POST", `/api/packages/${r.packageId}/problem`, { kind: "damaged" });
  });
  it("a garbled barcode (bad check digit) is rejected", async () => {
    const raw = buildGs1("70004-623-15", "GX4471C", "2027-08-31", "0000932").replace("00370004623155", "00370004623156");
    const r = await call("k.patel", "POST", "/api/deliveries/ASH-1105-07/scan", { raw });
    expect(r.statusCode).toBe(422);
  });
  it("Schedule II needs a witness who is not you, and refuses the wrong password", async () => {
    // ASH-1105-07's oxycodone line is already explained above, so use the pre-seeded serial on a fresh database.
    const b = await boot();
    const sign = async (w: string) => (await b.a.inject({ method: "POST", url: "/api/auth/login", payload: { storeId: "store-7", email: `${w}@elmstreetrx.example`, password: PW } })).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const tech = await sign("k.patel");
    const post = (url: string, payload: unknown) => b.a.inject({ method: "POST", url, payload: payload as never, headers: { cookie: tech } });
    const scan = (await post("/api/deliveries/ASH-1105-07/scan", { raw: buildGs1("70004-310-10", "OX25L072", "2028-03-31", "55020417") })).json();
    expect(scan.needsWitness).toBe(true);
    expect(scan.suggestion.location).toMatch(/^C-II Safe/);
    expect((await post(`/api/packages/${scan.packageId}/putaway`, {})).statusCode).toBe(422);
    expect((await post(`/api/packages/${scan.packageId}/putaway`, { witness: { email: "k.patel@elmstreetrx.example", password: PW } })).statusCode).toBe(403);
    expect((await post(`/api/packages/${scan.packageId}/putaway`, { witness: { email: "j.rivera@elmstreetrx.example", password: "wrong" } })).statusCode).toBe(403);
    const ok = await post(`/api/packages/${scan.packageId}/putaway`, { witness: { email: "j.rivera@elmstreetrx.example", password: PW } });
    expect(ok.statusCode).toBe(200);
    const lot = (await b.a.inject({ url: "/api/lots?q=OX25L072", headers: { cookie: tech } })).json().rows[0];
    expect(lot.onHand).toBe(14); // 13 to 14, as in the mockup
  });
  it("OCR-style fields with no serial are accepted with a warning and get an internal id", async () => {
    const r = await json("k.patel", "POST", "/api/deliveries/ASH-1105-08/scan", { fields: { ndc: "70004-145-90", lot: "AM1107B", expiry: "2028-06-30" }, source: "ocr" });
    expect(r.noSerial).toBe(true);
    expect(r.checks.find((c: any) => c.id === "tits").state).toBe("warn");
    expect(r.canConfirm).toBe(true);
  });
});

describe("fill and pickup: lot and serial land on the prescription", () => {
  let dispenseId = 0;
  it("blocks the wrong drug", async () => {
    const raw = buildGs1("70004-803-90", "AT24K118", "2027-12-31", "24118001");
    const r = await call("k.patel", "POST", "/api/rx/0072210/scan", { raw });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("wrong_ndc");
  });
  it("blocks a serial that was never received", async () => {
    const r = await call("k.patel", "POST", "/api/rx/0072210/scan", { raw: buildGs1("70004-623-15", "GX4471C", "2027-08-31", "0004444") });
    expect(r.json().code).toBe("not_in_ledger");
  });
  it("scans the insulin pen, saving lot and serial on the fill", async () => {
    const r = await json("k.patel", "POST", "/api/rx/0072210/scan", { raw: buildGs1("70004-623-15", "GX4471C", "2027-08-31", "0000907") });
    expect(r).toMatchObject({ lot: "GX4471C", serial: "0000907", ndc: "70004-623-15" });
    dispenseId = r.dispenseId;
    expect((await json("k.patel", "GET", "/api/rx/0072210")).step).toBe(1);
  });
  it("won't scan the same package twice", async () => {
    const r = await call("k.patel", "POST", "/api/rx/0072214/scan", { raw: buildGs1("70004-623-15", "GX4471C", "2027-08-31", "0000907") });
    expect(r.statusCode).toBe(409);
  });
  it("walks Label, Verify (pharmacist only), Pickup (cashier)", async () => {
    expect((await call("k.patel", "POST", `/api/dispenses/${dispenseId}/label`)).statusCode).toBe(200);
    expect((await call("k.patel", "POST", `/api/dispenses/${dispenseId}/verify`, { checklist: [true, true, true, true] })).statusCode).toBe(403);
    expect((await call("j.rivera", "POST", `/api/dispenses/${dispenseId}/verify`, { checklist: [true, true, true, false] })).statusCode).toBe(422);
    expect((await call("j.rivera", "POST", `/api/dispenses/${dispenseId}/verify`, { checklist: [true, true, true, true] })).statusCode).toBe(200);
    expect((await call("m.diaz", "POST", `/api/dispenses/${dispenseId}/sell`, { idChecked: true, counseled: false, signature: true })).statusCode).toBe(422);
    const sale = await json("m.diaz", "POST", `/api/dispenses/${dispenseId}/sell`, { idChecked: true, counseled: true, signature: true });
    expect(sale).toMatchObject({ rx: "0072210", lot: "GX4471C", serial: "0000907", patient: "Daniel Brooks" });
    expect(sale.contact.sms).toBe("(555) 010-0142");
  });
  it("a cashier does not see the patient's allergies or date of birth", async () => {
    const r = await json("m.diaz", "GET", "/api/rx/0072214");
    expect(r.patient.dob).toBeNull();
    expect(r.patient.allergies).toBe("");
  });
  it("the ledger still reconciles", () => expect(ledgerViolations(ctx)).toEqual([]));
});

describe("the recall: fax to patient outreach", () => {
  it("looks the recall up and reads both lots from the notice", async () => {
    const r = await json("j.rivera", "POST", "/api/recalls/lookup", { number: "D-0417-2026" });
    expect(r.recall.lots.map((l: any) => l.lot)).toEqual(["PRORX050925-1", "PRORX050925-3"]);
    expect(r.recall.lots.every((l: any) => l.confirmed && l.confidence >= 0.95)).toBe(true);
  });
  it("quarantines 197 units and finds 17 patients: 13 by text, 11 by email, 2 by phone", async () => {
    const { impact } = await json("j.rivera", "GET", "/api/recalls/D-0417-2026");
    expect(impact).toMatchObject({ unitsHeld: 197, location: "Quarantine Q-1", patientCount: 17, textCount: 13, emailCount: 11, callCount: 2, messageCount: 24 });
    expect(impact.patients.slice(0, 2).map((p: any) => [p.name, p.rx])).toEqual([["Maria Alvarez", "0071834"], ["James Okafor", "0071851"]]);
    const lots = (await json("j.rivera", "GET", "/api/lots?filter=recall")).rows;
    expect(lots.map((l: any) => [l.lot, l.onHand, l.location, l.status])).toEqual([["PRORX050925-1", 112, "Quarantine Q-1", "recall"], ["PRORX050925-3", 85, "Quarantine Q-1", "recall"]]);
  });
  it("blocks the recalled lot at the bench and at the dock", async () => {
    ctx.db.run("INSERT INTO prescriptions (rx, patient_id, ndc11, drug, qty, directions, prescriber, refills, status, due) VALUES ('0072230','S-0448','70004041705','Methylprednisolone acetate 40 mg/mL',1,'As directed','Dr. A. Nwosu',0,'to_fill','today')");
    const bench = await call("k.patel", "POST", "/api/rx/0072230/scan", { raw: buildGs1("70004-417-05", "PRORX050925-1", "2027-09-30", "100050") });
    expect([bench.statusCode, bench.json().code]).toEqual([409, "recalled"]);
    const dock = await call("k.patel", "POST", "/api/deliveries/ASH-1105-07/scan", { raw: buildGs1("70004-417-05", "PRORX050925-3", "2027-09-30", "300500") });
    expect(dock.statusCode === 409 || (await dock.json()).checks?.find((c: any) => c.id === "recall")?.state === "fail").toBe(true);
  });
  it("needs the pharmacist's attestation, then sends exactly 24 messages", async () => {
    const draft = await json("j.rivera", "GET", "/api/recalls/D-0417-2026/messages");
    expect(draft.smsPreview).toContain("Hi Maria");
    expect(draft.smsInfo.segments).toBe(1);
    const body = { sms: draft.sms, emailSubject: draft.emailSubject, emailBody: draft.emailBody };
    expect((await call("j.rivera", "POST", "/api/recalls/D-0417-2026/notifications", { ...body, attest: false })).statusCode).toBe(422);
    expect((await call("k.patel", "POST", "/api/recalls/D-0417-2026/notifications", { ...body, attest: true })).statusCode).toBe(403);
    expect((await call("j.rivera", "POST", "/api/recalls/D-0417-2026/notifications", { ...body, sms: "No phone number here", attest: true })).statusCode).toBe(422);
    const sent = await json("j.rivera", "POST", "/api/recalls/D-0417-2026/notifications", { ...body, attest: true });
    expect(sent).toEqual({ sent: 24, callList: 2 });
    expect((await call("j.rivera", "POST", "/api/recalls/D-0417-2026/notifications", { ...body, attest: true })).statusCode).toBe(409);
  });
  it("tracks delivery per channel: 12 of 13 texts delivered, 1 pending, 11 emails, a call list of 2", async () => {
    await new Promise((r) => setTimeout(r, 150));
    const res = await json("j.rivera", "GET", "/api/recalls/D-0417-2026/results");
    expect(res.sms).toMatchObject({ total: 13, delivered: 12, sent: 1, failed: 0 });
    expect(res.email).toMatchObject({ total: 11, sent: 11 });
    expect(res.callList.map((c: any) => c.name).sort()).toEqual(["Robert Haas", "Ruth Adeyemi"]);
    expect(res.quarantined).toBe(197);
  });
  it("merges every field and adds STOP to every text", async () => {
    const out = (await json("j.rivera", "GET", "/api/outbox?recall=D-0417-2026")) as any[];
    const sms = out.filter((o) => o.channel === "sms");
    expect(sms).toHaveLength(13);
    expect(sms.every((o) => /Hi [A-Z][a-z]+,/.test(o.body) && !/\{/.test(o.body) && /STOP/.test(o.body))).toBe(true);
    expect(out.filter((o) => o.channel === "email").every((o) => !/\{/.test(o.body) && o.to_addr.endsWith("@example.com"))).toBe(true);
  });
  it("honours STOP from then on", async () => {
    const r = await json("j.rivera", "POST", "/api/sms/inbound", { from: "(555) 010-0101", body: "STOP" });
    expect(r.handled).toBe(true);
    expect(ctx.db.get<any>("SELECT sms_opt_out FROM patients WHERE id = 'S-0417'").sms_opt_out).toBe(1);
  });
  it("produces a PDF audit report and logs the lot events", async () => {
    const r = await call("j.rivera", "GET", "/api/recalls/D-0417-2026/report.pdf");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("application/pdf");
    expect(r.rawPayload.subarray(0, 4).toString()).toBe("%PDF");
    expect(ctx.db.all("SELECT 1 FROM audit WHERE action = 'recall.notify'")).toHaveLength(1);
  });
  it("the ledger still reconciles", () => expect(ledgerViolations(ctx)).toEqual([]));
});

describe("the real recall D-0526-2026 flags a real lot", () => {
  it("reads lot AC2040A and NDC 0054-0282-59 from the openFDA record", async () => {
    const r = await json("j.rivera", "POST", "/api/recalls/lookup", { number: "D-0526-2026" });
    expect(r.recall.lots.map((l: any) => l.lot)).toEqual(["AC2040A"]);
    expect(r.recall.lots[0].ndc10).toBe("0054-0282-59");
  });
  it("then fails the dock check for that lot", async () => {
    const r = await json("k.patel", "POST", "/api/deliveries/ASH-1105-08/scan", { raw: buildGs1("0054-0282-59", "AC2040A", "2026-04-30", "SN0001") });
    expect(r.checks.find((c: any) => c.id === "recall")).toMatchObject({ state: "fail" });
    expect(r.canConfirm).toBe(false);
  }, 20_000);
});

describe("label text from OCR", () => {
  it("pulls NDC, lot, expiry and serial out of label text, fixing O/0 confusion in the NDC", () => {
    const f = parseLabelText("NDC 70OO4-226-O1  Amoxicillin 500 mg\nLOT: AMX0926B\nEXP 09/2028\nSN 10443850");
    expect(f).toMatchObject({ ndc: "70004-226-01", lot: "AMX0926B", expiry: "2028-09", serial: "10443850" });
  });
  it("says what it could not find", () => {
    expect(parseLabelText("hello").notes.join(" ")).toMatch(/No NDC/);
  });
});

// ---- property: no sequence of bench and dock actions can break the ledger
describe("property: ledger invariants hold under random operations", () => {
  it("on hand = received - dispensed - returned - adjusted, no serial dispensed twice, every dispensed serial was received", async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 400 })), { minLength: 5, maxLength: 30 }), async (ops) => {
      const b = await boot();
      const tech = (await b.a.inject({ method: "POST", url: "/api/auth/login", payload: { storeId: "store-7", email: "j.rivera@elmstreetrx.example", password: PW } })).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const post = (url: string, payload?: unknown) => b.a.inject({ method: "POST", url, payload: (payload ?? {}) as never, headers: { cookie: tech } });
      const shelf = b.c.db.all<{ serial: string; gtin: string; lot: string; ndc10: string; expiry: string }>(
        "SELECT k.serial, k.gtin, l.lot, p.ndc10, k.expiry FROM packages k JOIN lots l ON l.id = k.lot_id JOIN products p ON p.ndc11 = l.ndc11 WHERE k.status = 'on_shelf' LIMIT 400");
      const rxs = ["0072210", "0072214"];
      for (const [op, n] of ops) {
        const pkg = shelf[n % shelf.length]!;
        if (op <= 1) await post(`/api/rx/${rxs[op]}/scan`, { raw: buildGs1(pkg.ndc10, pkg.lot, pkg.expiry, pkg.serial) });
        else if (op === 2) { const d = b.c.db.get<{ id: number }>("SELECT id FROM dispenses WHERE state = 'filled' ORDER BY id DESC LIMIT 1"); if (d) await post(`/api/dispenses/${d.id}/sendback`, { reason: "random test" }); }
        else if (op === 3) { const l = b.c.db.get<{ id: number; n: number }>("SELECT lot_id AS id, count(*) AS n FROM packages WHERE status = 'on_shelf' AND lot_id = (SELECT lot_id FROM packages WHERE id = ?) GROUP BY lot_id", (n % 300) + 1); if (l && l.n > 1) await post(`/api/lots/${l.id}/adjust`, { count: l.n - 1, reason: "random count" }); }
        else if (op === 4) await post("/api/recalls/lookup", { number: n % 2 ? "D-0417-2026" : "D-0603-2026" });
        else await post("/api/recalls/lookup", { number: "D-0522-2026" });
        const bad = ledgerViolations(b.c);
        if (bad.length) { console.error(bad); return false; }
      }
      return true;
    }), { numRuns: 12 });
  }, 120_000);
});
