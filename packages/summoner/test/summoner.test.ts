import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { OpenFdaClient, RateLimiter, classRoman, parsePaste, recordFromText } from "../src/index";

describe("RateLimiter (SUM-4)", () => {
  it("never lets more than max calls through inside one window", async () => {
    let t = 0;
    const times: number[] = [];
    const lim = new RateLimiter(5, 1000, () => t, async (ms) => { t += ms; });
    for (let i = 0; i < 23; i++) { await lim.acquire(); times.push(t); }
    for (let i = 0; i < times.length; i++) {
      const inWindow = times.filter((x) => x > times[i]! - 1000 && x <= times[i]!).length;
      expect(inWindow).toBeLessThanOrEqual(5);
    }
  });
  it("property: any max/window combination holds", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 80 }), async (max, calls) => {
      let t = 0;
      const stamps: number[] = [];
      const lim = new RateLimiter(max, 100, () => t, async (ms) => { t += ms; });
      for (let i = 0; i < calls; i++) { await lim.acquire(); stamps.push(t); }
      return stamps.every((s) => stamps.filter((x) => x > s - 100 && x <= s).length <= max);
    }), { numRuns: 60 });
  });
});

describe("fallback to fixtures (SUM-3)", () => {
  it("serves cached fixtures on HTTP 429", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    const c = new OpenFdaClient({ fetchImpl, fixtureDir: new URL("../../../fixtures/recalls", import.meta.url).pathname });
    const r = await c.fetchRecent(7);
    expect(r.cached).toBe(true);
    expect(r.reason).toMatch(/429/);
    expect(r.records.length).toBeGreaterThan(0);
  });
  it("demo recalls never hit the network", async () => {
    const fetchImpl = (async () => { throw new Error("network used"); }) as unknown as typeof fetch;
    const c = new OpenFdaClient({ fetchImpl, fixtureDir: new URL("../../../fixtures/recalls", import.meta.url).pathname });
    const r = await c.fetchByNumber("D-0417-2026");
    expect(r.records[0]?.recall_number).toBe("D-0417-2026");
  });
});

describe("paste handling (SUM-2)", () => {
  it("recognises recall numbers", () => {
    expect(parsePaste(" f-0123-2025 ")).toEqual({ kind: "number", recallNumber: "F-0123-2025" });
    expect(parsePaste("Lot 123456 exp 01/2027").kind).toBe("text");
  });
  it("wraps text as a record with a stable id", () => {
    const a = recordFromText("Lot ABC123");
    expect(a.recall_number).toBe(recordFromText("Lot ABC123").recall_number);
    expect(a.code_info).toBe("Lot ABC123");
  });
  it("maps classes", () => {
    expect(classRoman("Class II")).toBe("II");
    expect(classRoman("Class I")).toBe("I");
  });
});
