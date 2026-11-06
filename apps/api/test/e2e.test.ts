import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { generateWorld } from "@bsrx/crypt-seed";
import { buildElementString, GS, ndc10ToGtin14 } from "@bsrx/gs1";
import { CryptStore } from "@bsrx/tracker";
import { createApp as createRxterm } from "../../rxterm98/src/app";
import { buildApp, createContext, loadConfig, type Ctx } from "../src/index";
import { Db } from "../src/db";
import type { FastifyInstance } from "fastify";

let rx: Server;
let ctx: Ctx;
let app: FastifyInstance;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bsrx-"));

async function waitReady(id: string, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = (await app.inject({ url: `/api/recalls/${id}` })).json();
    if (r.status === "ready" || r.status === "error") return r;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${id}: ${r.status}`);
    await new Promise((s) => setTimeout(s, 100));
  }
}

beforeAll(async () => {
  const world = generateWorld();
  rx = createRxterm({ world, latencyMs: 0 }).listen(0);
  await new Promise((r) => rx.once("listening", r));
  const store = await CryptStore.open(":memory:");
  await store.replaceParties(world.parties);
  await store.insertEvents(world.events());
  const cfg = loadConfig({}, { rxtermUrl: `http://localhost:${(rx.address() as { port: number }).port}`, stepDelayMs: 0, today: "2026-11-05", dataDir: tmp, sqlitePath: ":memory:", webDist: path.join(tmp, "none") });
  ctx = await createContext(cfg, { world, store, llm: null, db: new Db(":memory:") });
  app = await buildApp(ctx);
}, 60_000);
afterAll(async () => { rx.close(); await app.close(); });

describe("end to end: notice to hearse (the design's demo recall)", () => {
  it("reset loads the three tonight's death notices, autopsied", async () => {
    await app.inject({ method: "POST", url: "/api/demo/reset", payload: {} });
    const list = (await app.inject({ url: "/api/recalls" })).json();
    expect(list.map((r: any) => r.id)).toEqual(expect.arrayContaining(["D-0417-2026", "D-0522-2026", "D-0603-2026"]));
    const d = (await app.inject({ url: "/api/recalls/D-0417-2026" })).json();
    expect(d.status).toBe("autopsied");
    expect(d.lots.map((l: any) => [l.value, l.expiry])).toEqual([["PRORX050925-1", "2025-11-04"], ["PRORX050925-3", "2025-11-06"]]);
    expect(d.ndcs[0].value).toBe("70004-417-05");
    expect(d.segments.filter((s: any) => s.hit).map((s: any) => s.t)).toEqual(["PRORX050925-1", "November 4, 2025", "PRORX050925-3", "November 6, 2025", "70004-417-05"]);
  });

  it("refuses a bad confirm and runs the whole hunt on a good one", async () => {
    expect((await app.inject({ method: "POST", url: "/api/recalls/D-0417-2026/confirm", payload: { lots: ["NOPE"] } })).statusCode).toBe(422);
    const res = await app.inject({ method: "POST", url: "/api/recalls/D-0417-2026/confirm", payload: {} });
    expect(res.statusCode).toBe(202);
    const d = await waitReady("D-0417-2026");
    expect(d.status).toBe("ready");
    expect(d.stats).toMatchObject({ lots: 2, packages: 412, patients: 17 });
  }, 60_000);

  it("Body Trail: 214 serials in lot 1, 0 orphans, 17 dispensed, 197 held", async () => {
    const t = (await app.inject({ url: "/api/recalls/D-0417-2026/trace" })).json();
    expect(t.orphans).toBe(0);
    expect(t.inPatientHands).toBe(17);
    expect(t.held).toBe(197);
    expect(t.dispenses.filter((d: any) => d.source === "fax")).toHaveLength(3);
    expect(t.dispenses.filter((d: any) => d.source === "rxterm")).toHaveLength(14);
    expect(t.dispenses.every((d: any) => d.serial && d.eventWritten)).toBe(true);
    expect(t.stages.map((s: any) => s.key)).toEqual(["commissioning", "shipping", "receiving", "dispensing", "shelf"]);
    expect(t.steps.some((s: any) => s.action === "row")).toBe(true);
  });

  it("serial inference matches the pharmacy's own ground truth", async () => {
    const t = (await app.inject({ url: "/api/recalls/D-0417-2026/trace" })).json();
    const truth = new Map(ctx.world.fills.filter((f) => f.lot === "PRORX050925-1").map((f) => [f.rx, f.serials[0]]));
    for (const d of t.dispenses) expect(d.serial).toBe(truth.get(d.rx));
  });

  it("Afterlife: bins, 17 letters (grade 6), nothing sent", async () => {
    const a = (await app.inject({ url: "/api/afterlife?recalls=D-0417-2026" })).json();
    expect(a.bins.map((b: any) => b.count)).toEqual([42, 38, 61, 29, 27]);
    expect(a.total).toBe(197);
    expect(a.outreach).toHaveLength(17);
    expect(a.outreach.every((o: any) => o.status === "draft" && o.grade <= 6 && !/S-\d{4}/.test(o.text))).toBe(true);
    expect(a.shortage).toMatchObject({ soleSource: true, substitute: "Triamcinolone 40 mg/mL" });
  });

  it("approving a letter only marks it approved (UND-3)", async () => {
    const a = (await app.inject({ url: "/api/afterlife?recalls=D-0417-2026" })).json();
    const r = (await app.inject({ method: "POST", url: `/api/outreach/${a.outreach[0].id}/approve`, payload: { approvedBy: "RPh J." } })).json();
    expect(r).toMatchObject({ status: "approved", approvedBy: "RPh J." });
    const e = (await app.inject({ method: "PATCH", url: `/api/outreach/${a.outreach[0].id}`, payload: { text: "Hello from [PHARMACY NAME]. Please call [PHARMACY PHONE]." } })).json();
    expect(e).toMatchObject({ status: "draft", writtenBy: "pharmacist" });
  });

  it("Scan: Package A is cursed (bin Q-1), Package B is clean", async () => {
    const pk = (await app.inject({ url: "/api/demo/packages" })).json();
    expect(pk[0].element).toBe("(01)00370004417051(21)000214(10)PRORX050925-1(17)251104");
    const a = (await app.inject({ method: "POST", url: "/api/scan", payload: { element: pk[0].raw } })).json();
    expect(a).toMatchObject({ verdict: "CURSED", recallNumber: "D-0417-2026", bin: "Q-1", location: { pharmacy: "Branch 7", shelf: "C-12" } });
    expect(a.trail.map((t: any) => t.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Commissioned at Hollow Creek/), expect.stringMatching(/^Sibling serial/)]));
    const b = (await app.inject({ method: "POST", url: "/api/scan", payload: { element: pk[1].element } })).json();
    expect(b).toMatchObject({ verdict: "CLEAN", known: true });
    expect((await app.inject({ method: "POST", url: "/api/scan", payload: { element: "garbage!!" } })).statusCode).toBe(422);
  });

  it("Hearse: five stops, depot to depot, heat avoided with zero exposure", async () => {
    const h = (await app.inject({ url: "/api/hearse?recalls=D-0417-2026&avoid=1" })).json();
    expect(h.stops.map((s: any) => s.id).sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect(h.geometry[0]).toEqual(h.geometry.at(-1));
    expect(h.hazardExposureMin).toBe(0);
    expect(h.avoided).toBe(true);
    const d = (await app.inject({ url: "/api/hearse?recalls=D-0417-2026&avoid=0" })).json();
    expect(d.distanceKm).toBeLessThan(h.distanceKm);
  });

  it("the cold-chain recall puts refrigerated stock on a heat-exposed route", async () => {
    await app.inject({ method: "POST", url: "/api/recalls/D-0603-2026/confirm", payload: {} });
    await waitReady("D-0603-2026");
    const d = (await app.inject({ url: "/api/hearse?avoid=0" })).json();
    expect(d.stops.filter((s: any) => s.cold).map((s: any) => s.id).sort()).toEqual(["C", "D"]);
    expect(d.warnings.length).toBeGreaterThan(0);
    const h = (await app.inject({ url: "/api/hearse?avoid=1" })).json();
    expect(h.warnings.filter((w: any) => w.kind === "transit")).toHaveLength(0);
  }, 60_000);

  it("pasting free text summons a recall within 2 s (SUM-2)", async () => {
    const t0 = Date.now();
    const r = await app.inject({ method: "POST", url: "/api/recalls", payload: { input: "Lot AB12345 exp 05/2027, Lot CD67890 exp 06/2027; NDC 12345-678-90" } });
    expect(r.statusCode).toBe(201);
    expect(Date.now() - t0).toBeLessThan(2000);
    const d = (await app.inject({ url: `/api/recalls/${r.json().id}` })).json();
    expect(d.lots).toHaveLength(2);
  });

  it("SSE history replays the pipeline events in order", async () => {
    const ev = ctx.bus.since("D-0417-2026").map((e) => e.type);
    for (const t of ["recall.summoned", "recall.autopsied", "recall.confirmed", "trace.found", "rpa.step", "dispense.found", "undertaker.ready", "hearse.planned"]) expect(ev).toContain(t);
    expect(ev.indexOf("trace.found")).toBeLessThan(ev.indexOf("undertaker.ready"));
  });
});


// ---------------------------------------------------------------- Soul Catcher (scan at fill)

describe("Soul Catcher: webcam scan at fill, flagged by recall lot", () => {
  const label = (ndc: string, lot: string, expiry: string, serial: string) => buildElementString({ gtin: ndc10ToGtin14(ndc), lot, expiry, serial }, { mode: "raw", order: ["01", "17", "10", "21"] });
  const scan = (rx: string, raw: string, device = "webcam") => app.inject({ method: "POST", url: `/api/fills/${rx}/scan`, payload: { raw, device } });
  const scanStatus = async (id: number, want: string) => {
    for (let i = 0; i < 200; i++) {
      const r = (await app.inject({ url: `/api/fills/scans/${id}` })).json();
      if (r.writeback === want || r.writeback === "failed") return r;
      await new Promise((s) => setTimeout(s, 100));
    }
    throw new Error("write-back never settled");
  };

  it("the real recall D-0526-2026 is read from product_description and code_info (COR-1)", async () => {
    const d = (await app.inject({ url: "/api/recalls/D-0526-2026" })).json();
    expect(d.lots.map((l: any) => [l.value, l.expiry])).toEqual([["AC2040A", "2026-04"]]);
    expect(d.ndcs.map((n: any) => n.value)).toContain("0054-0282-59");
    expect((await app.inject({ method: "POST", url: "/api/recalls/D-0526-2026/confirm", payload: {} })).statusCode).toBe(202);
    await waitReady("D-0526-2026");
  });

  it("starts with a queue of five prescriptions, the first waiting", async () => {
    const q = (await app.inject({ url: "/api/fills" })).json();
    expect(q).toHaveLength(5);
    expect((await app.inject({ url: "/api/fills/next" })).json()).toMatchObject({ rx: "0099101", status: "waiting" });
  });

  it("CURSED: a recalled lot blocks the fill, names the recall, and is never written back (SOUL-8)", async () => {
    const r = await scan("0099104", label("0054-0282-59", "AC2040A", "2026-04-30", "SN0001"));
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ verdict: "CURSED", fillAllowed: false, recallNumber: "D-0526-2026", lot: "AC2040A", writeback: "none" });
    expect(r.json().drug).toMatch(/alendronate/i);
    expect(r.json().savedMs).toBeLessThan(500 + 3000); // SOUL-10 saves before the openFDA lookup; lookup has a 3 s timeout
  });

  it("CURSED also catches the synthetic demo lot", async () => {
    const r = (await scan("0099102", label("70004-417-05", "PRORX050925-1", "2027-03-31", "000214"))).json();
    expect(r).toMatchObject({ verdict: "CURSED", recallNumber: "D-0417-2026" });
  });

  it("CAPTURED: a clean lot is allowed, then the bot writes it into RxTerm 98 and verifies (RPA-7, RPA-8)", async () => {
    const r = (await scan("0099104", label("0054-0282-59", "AC2105B", "2027-05-31", "SN0042"))).json();
    expect(r).toMatchObject({ verdict: "CAPTURED", fillAllowed: true, lot: "AC2105B", ndc: "00054-0282-59" });
    const done = await scanStatus(r.id, "verified");
    expect(done).toMatchObject({ writeback: "verified", note: "LOT AC2105B EXP 2027-05 SN SN0042" });
    expect(ctx.bus.since("fills").map((e) => e.type)).toEqual(expect.arrayContaining(["fill.scanned", "fill.step", "fill.writeback"]));
    const fills = (await app.inject({ url: "/api/fills" })).json();
    expect(fills.find((f: any) => f.rx === "0099104")).toMatchObject({ status: "filled", lastVerdict: "CAPTURED" });
  }, 30_000);

  it("WRONG VESSEL: ondansetron prescription, methylprednisolone package (SOUL-7)", async () => {
    const r = (await scan("0099103", label("70004-417-05", "PRORX051125-2", "2027-12-08", "000522"))).json();
    expect(r).toMatchObject({ verdict: "WRONG_VESSEL", fillAllowed: false, ndc: "70004-0417-05" });
    expect(r.message).toMatch(/wrong vessel/i);
    expect(r.message).toContain("70004-417-05"); // the real 5-3-2 layout, not a 4-4-2 guess
  });

  it("DEPARTED: an expired package is blocked (SOUL-9)", async () => {
    const r = (await scan("0099101", label("70004-417-05", "PRORX040925-9", "2025-09-30", "000999"))).json();
    expect(r).toMatchObject({ verdict: "DEPARTED", fillAllowed: false });
  });

  it("garbled barcodes are rejected, including a bad GTIN check digit (SOUL-5)", async () => {
    const good = label("70004-417-05", "PRORX051125-2", "2027-12-08", "000522");
    const bad = good.replace("00370004417051", "00370004417052");
    for (const raw of [bad, "not a barcode at all", "(01)123"]) {
      const r = await scan("0099101", raw);
      expect(r.statusCode).toBe(422);
      expect(r.json().error).toMatch(/garbled/i);
    }
    expect((await scan("0000000", good)).statusCode).toBe(404);
  });

  it("reads the printed form and the ]d2 prefix a USB wedge scanner sends (SOUL-4, SOUL-11)", async () => {
    const human = "(01)00370004417051(17)271208(10)PRORX051125-2(21)000522";
    expect((await scan("0099101", human, "typed")).json()).toMatchObject({ verdict: "CAPTURED", device: "typed", expiry: "2027-12-08" });
    const wedge = `]d2010037000441705117271208${"10"}PRORX051125-2${GS}21000522`;
    expect((await scan("0099105", wedge, "usb")).json()).toMatchObject({ verdict: "CAPTURED", device: "usb", lot: "PRORX051125-2", serial: "000522" });
  }, 30_000);

  it("RPA-9: if the bot cannot reach the terminal the scan is kept and flagged failed, then retried", async () => {
    const r = (await scan("0099102", label("70004-417-05", "PRORX051125-2", "2027-12-08", "000777"))).json();
    expect(r.verdict).toBe("CAPTURED");
    await scanStatus(r.id, "verified");
    const saved = ctx.cfg.rxtermUrl;
    ctx.cfg.rxtermUrl = "http://localhost:1"; // nothing listens here
    const r2 = (await scan("0099105", label("70004-417-05", "PRORX051125-2", "2027-12-08", "000778"))).json();
    const failed = await scanStatus(r2.id, "failed");
    expect(failed.writeback).toBe("failed");
    expect(failed.lot).toBe("PRORX051125-2"); // the scan itself is kept
    ctx.cfg.rxtermUrl = saved;
    await app.inject({ method: "POST", url: "/api/fills/retry" });
    expect((await scanStatus(r2.id, "verified")).writeback).toBe("verified");
  }, 60_000);
});
