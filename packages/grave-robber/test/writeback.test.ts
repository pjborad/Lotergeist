import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Server } from "node:http";
import { generateWorld } from "@bsrx/crypt-seed";
import { createApp } from "../../../apps/rxterm98/src/app";
import { buildNote, writeBack } from "../src/index";

const world = generateWorld();
const riverside = world.parties.find((p) => p.code === "RIV02")!;
const pharmacy = { gln: riverside.gln, name: riverside.name, system: "rxterm" as const, code: "RIV02" };
let server: Server;
let url = "";

beforeAll(async () => {
  server = createApp({ world, latencyMs: 0 }).listen(0);
  await new Promise((r) => server.once("listening", r));
  url = `http://localhost:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

describe("RPA write-back (RPA-7, RPA-8, RPA-9)", () => {
  it("builds the note the spec asks for", () => {
    expect(buildNote({ lot: "AC2040A", expiry: "2026-04-30", serial: "000214" })).toBe("LOT AC2040A EXP 2026-04 SN 000214");
    expect(buildNote({ lot: "X1", expiry: "", serial: "7" })).toBe("LOT X1 EXP NONE SN 7");
  });

  it("types the lot into the prescription, re-reads it and verifies", async () => {
    const steps: string[] = [];
    const note = buildNote({ lot: "PRORX051125-2", expiry: "2027-12-08", serial: "000522" });
    const [r] = await writeBack({ rxtermUrl: url, pharmacy, items: [{ rx: "0099101", note }], onStep: (s) => { steps.push(s.action); } });
    expect(r).toMatchObject({ rx: "0099101", verified: true, readBack: note, attempts: 1 });
    expect(steps).toEqual(expect.arrayContaining(["login", "writeback", "verify", "done"]));
  }, 30_000);

  it("PBT RPA-8: the re-read note equals the scan, even for characters the terminal HTML-escapes", async () => {
    const lotChar = fc.constantFrom(..."ABCDEFGHJKLMNPQRSTUVWXYZ0123456789-/.&<>\"'%()*+,:;=?_!".split(""));
    const lot = fc.array(lotChar, { minLength: 1, maxLength: 20 }).map((a) => a.join(""));
    const serial = fc.array(fc.constantFrom(..."0123456789ABCDEF-/&<>".split("")), { minLength: 1, maxLength: 20 }).map((a) => a.join(""));
    const notes = fc.sample(fc.record({ lot, serial }), 20).map((f) => buildNote({ ...f, expiry: "2027-03-31" }));
    const results = await writeBack({ rxtermUrl: url, pharmacy, items: notes.map((n) => ({ rx: "0099102", note: n })) });
    for (const r of results) expect(r.verified, `${r.note} -> ${r.readBack}`).toBe(true);
  }, 90_000);

  it("is honest when the legacy field cannot hold the note: lowercase lots are not verified", async () => {
    const note = buildNote({ lot: "ab12cd", expiry: "2027-03-31", serial: "1" });
    const [r] = await writeBack({ rxtermUrl: url, pharmacy, items: [{ rx: "0099103", note }], attempts: 2 });
    expect(r!.verified).toBe(false);
    expect(r!.attempts).toBe(2);
    expect(r!.readBack).toBe(note.toUpperCase());
  }, 30_000);

  it("RPA-9: an unknown prescription fails twice and is reported, not thrown", async () => {
    const [r] = await writeBack({ rxtermUrl: url, pharmacy, items: [{ rx: "9999999", note: "LOT A EXP NONE SN 1" }], attempts: 2 });
    expect(r).toMatchObject({ verified: false, attempts: 2 });
    expect(r!.error).toBeTruthy();
  }, 60_000);
});
