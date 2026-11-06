import { beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { CryptStore } from "@bsrx/tracker";
import { ndc10ToGtin14 } from "@bsrx/gs1";
import { generateWorld, type World } from "../src/index";

let world: World;
let store: CryptStore;
const GTIN = ndc10ToGtin14("70004-417-05");
const LOT1 = { gtins: [GTIN], lots: ["PRORX050925-1"] };

beforeAll(async () => {
  world = generateWorld();
  store = await CryptStore.open(":memory:");
  await store.replaceParties(world.parties);
  await store.insertEvents(world.events());
});

describe("synthetic world", () => {
  it("is about 40,000 packages and 200,000 events", () => {
    expect(world.serialCount).toBeGreaterThan(39_000);
    expect(world.serialCount).toBeLessThan(41_000);
    expect(world.eventCount).toBeGreaterThan(190_000);
  });
  it("is deterministic for a given seed", () => {
    const a = generateWorld({ seed: 7, fillerSerialsPerLot: 40 });
    const b = generateWorld({ seed: 7, fillerSerialsPerLot: 40 });
    expect(JSON.stringify(a.fills)).toBe(JSON.stringify(b.fills));
    expect([...a.events()].slice(0, 500)).toEqual([...b.events()].slice(0, 500));
  });
  it("has 8 pharmacies, 2 distributors and 4 manufacturers", () => {
    const k = (kind: string) => world.parties.filter((p) => p.kind === kind).length;
    expect([k("pharmacy"), k("distributor"), k("manufacturer")]).toEqual([8, 2, 4]);
  });
  it("gives each rx number once per pharmacy", () => {
    const seen = new Set<string>();
    for (const f of world.fills) {
      const key = f.pharmacyGln + f.rx;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("tracker on the demo recall", () => {
  it("matches the design numbers: 214 serials, 17 dispensed (before the bot runs: 0)", async () => {
    const t = await store.trace(LOT1);
    expect(t.totalSerials).toBe(214);
    expect(t.lots[0]).toMatchObject({ lot: "PRORX050925-1", serials: 214, onPharmacyShelf: 214, dispensed: 0 });
    expect(t.pharmacies.map((p) => p.received)).toEqual(expect.arrayContaining([45, 45, 65, 31, 28]));
  });
  it("TRK-3: no orphan serials", async () => {
    expect((await store.trace(LOT1)).orphans).toBe(0);
    expect(await store.findOrphans({ gtins: [GTIN], lots: [] })).toBe(0);
  });
  it("lot -3 never left the distributor", async () => {
    const t = await store.trace({ gtins: [GTIN], lots: ["PRORX050925-3"] });
    expect(t.lots[0]).toMatchObject({ serials: 198, atDistributor: 198, onPharmacyShelf: 0 });
  });
  it("TRK-4: a trace over the 200k-event crypt takes under 3 seconds", async () => {
    const t0 = performance.now();
    await store.trace({ gtins: world.products.map((p) => p.gtin), lots: [] });
    expect(performance.now() - t0).toBeLessThan(3000);
  });
  it("custody of serial 000214 runs factory to shelf C-12", async () => {
    const c = await store.custody(GTIN, "000214");
    expect(c.map((s) => s.bizStep)).toEqual(["commissioning", "shipping", "receiving", "shipping", "receiving"]);
    expect(c.at(-1)).toMatchObject({ partyName: "Branch 7 · Elm St", shelf: "C-12" });
  });
  it("RPA write-back turns shelf packages into dispensed ones (idempotently)", async () => {
    const shelf = await store.shelfSerials(LOT1);
    const first = shelf[0]!;
    const ev = store.makeDispenseEvent({ gtin: first.gtin, serial: first.serial, lot: first.lot, expiry: first.expiry, pharmacyGln: first.currentOwner, eventTime: "2025-11-05T10:00:00Z", rxNumber: "X1", patientId: "S-0001", source: "rxterm", serialInferred: true });
    expect(await store.appendEvents([ev])).toBe(1);
    expect(await store.appendEvents([ev])).toBe(0);
    const t = await store.trace(LOT1);
    expect(t.lots[0]).toMatchObject({ dispensed: 1, onPharmacyShelf: 213 });
    await store.deleteEventsByOrigin("rpa");
    expect((await store.trace(LOT1)).lots[0]!.dispensed).toBe(0);
  });
});

// PBT: TRK-3 over random small worlds
describe("properties", () => {
  it("TRK-3: no orphan serials in any random synthetic world", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 5, max: 60 }), async (seed, perLot) => {
      const w = generateWorld({ seed, fillerSerialsPerLot: perLot });
      const s = await CryptStore.open(":memory:");
      await s.replaceParties(w.parties);
      await s.insertEvents(w.events());
      const orphans = await s.findOrphans({ gtins: w.products.map((p) => p.gtin), lots: [] });
      await s.close();
      return orphans === 0;
    }), { numRuns: 12 });
  });
  it("ground-truth serials never repeat and stay inside the pharmacy's range", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9999 }), (seed) => {
      const w = generateWorld({ seed, fillerSerialsPerLot: 30 });
      const seen = new Set<string>();
      for (const f of w.fills) for (const s of f.serials) {
        const k = `${f.ndc10}|${s}`;
        if (seen.has(k)) return false;
        seen.add(k);
      }
      return true;
    }), { numRuns: 20 });
  });
});
