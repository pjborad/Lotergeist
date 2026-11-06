import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Server } from "node:http";
import path from "node:path";
import { generateWorld } from "@bsrx/crypt-seed";
import { createApp } from "../../../apps/rxterm98/src/app";
import { exhume, hostAllowed, parseFaxText, parseTerminalLine, readFaxInbox } from "../src/index";

const faxDir = path.resolve(import.meta.dirname, "../../../fixtures/fax");
const world = generateWorld();
let server: Server;
let url = "";

beforeAll(async () => {
  server = createApp({ world, latencyMs: 0 }).listen(0);
  await new Promise((r) => server.once("listening", r));
  url = `http://localhost:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

describe("parsers", () => {
  it("reads the design's terminal row", () => {
    expect(parseTerminalLine("0071834 S-0417  10/09/25   1  PRORX050925-1")).toEqual({ rxNumber: "0071834", patientId: "S-0417", fillDate: "2025-10-09", qty: 1, lot: "PRORX050925-1" });
    expect(parseTerminalLine("F3=EXIT F7=PREV")).toBeNull();
  });
  it("round-trips any terminal row", () => {
    fc.assert(fc.property(fc.integer({ min: 1000000, max: 9999999 }), fc.integer({ min: 1, max: 2400 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }), fc.integer({ min: 1, max: 9 }), (rx, pt, m, d, q) => {
      const line = `${String(rx).padStart(7, "0")} S-${String(pt).padStart(4, "0")}  ${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/25  ${String(q).padStart(2)}  LOT123-A`;
      const r = parseTerminalLine(line);
      return r?.qty === q && r.fillDate === `2025-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }));
  });
  it("RPA-5 allowlist blocks everything but the allowed hosts", () => {
    expect(hostAllowed("http://localhost:4100/menu", ["localhost:4100"])).toBe(true);
    expect(hostAllowed("https://fonts.googleapis.com/css2", ["localhost:4100"])).toBe(false);
    expect(hostAllowed("file:///etc/passwd", ["localhost:4100"])).toBe(false);
    expect(hostAllowed("not a url", ["localhost:4100"])).toBe(false);
  });
});

describe("fax path (RPA-3)", () => {
  it("reads the Branch 7 fax for the demo lot", async () => {
    const inbox = await readFaxInbox(faxDir);
    expect(inbox.length).toBe(4);
    const demo = inbox.map((f) => f.page).find((p) => p?.lot === "PRORX050925-1")!;
    expect(demo.rows.map((r) => [r.rxNumber, r.patientId, r.fillDate])).toEqual([
      ["88123", "S-0502", "2025-10-11"], ["88140", "S-0519", "2025-10-12"], ["88177", "S-0533", "2025-10-14"]
    ]);
    expect(demo.confidence).toBe(1);
  });
  it("parseFaxText lowers confidence on garbled rows", () => {
    const p = parseFaxText("Dispense Log - X\nNDC: 70004-0417-05   LOT: AB1\nRUN DATE: 11/05/25\nRx 111  S-0001  10/02  #1\nRx 1l2  S-OOO2  1O/03  #1");
    expect(p?.rows).toHaveLength(1);
    expect(p?.confidence).toBe(0.5);
  });
});

describe("live exhumation against RxTerm 98 (Playwright)", () => {
  it("finds exactly the 17 dispenses of the demo lot (14 terminal + 3 fax)", async () => {
    const pharmacies = world.parties.filter((p) => p.kind === "pharmacy").slice(0, 5).map((p) => ({ gln: p.gln, name: p.name, system: p.system!, code: p.code ?? "" }));
    const events: string[] = [];
    const { rows } = await exhume({ rxtermUrl: url, pharmacies, ndcs: ["70004-0417-05"], lots: ["PRORX050925-1"], faxDir, onStep: (s) => { events.push(s.action); } });
    expect(rows).toHaveLength(17);
    expect(rows.filter((r) => r.source === "rxterm")).toHaveLength(14);
    expect(rows.filter((r) => r.source === "fax")).toHaveLength(3);
    expect(events).toContain("login");
    expect(events).toContain("skip"); // clean-lot rows on the same NDC were skipped, not exhumed
    const truth = world.fills.filter((f) => f.lot === "PRORX050925-1").map((f) => f.rx).sort();
    expect(rows.map((r) => r.rxNumber).sort()).toEqual(truth);
  }, 60_000);
});
