import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { autopsy, appearsVerbatim, extractRegex, parseLlmJson, type LlmClient } from "../src/index";

const D1 = "Lot PRORX050925-1, BUD November 4, 2025; Lot PRORX050925-3, BUD November 6, 2025; NDC 70004-417-05";
const D2 = "lot code No Expiration Date on product: a) 224010, b) 224011; UPC 3 70004 08812 4";
const D3 = "Lot Nos.: GX4471A exp 03/2027, GX4471B exp 03/2027; Serial range 000510–000980";

describe("regex pass on the design's three notices", () => {
  it("D-0417: two lots with BUD dates and one NDC", () => {
    const r = extractRegex(D1);
    expect(r.lots.map((l) => [l.value, l.expiry])).toEqual([["PRORX050925-1", "2025-11-04"], ["PRORX050925-3", "2025-11-06"]]);
    expect(r.ndcs.map((n) => n.value)).toEqual(["70004-417-05"]);
  });
  it("D-0522: lot list with no expiry, ignores the UPC", () => {
    const r = extractRegex(D2);
    expect(r.lots.map((l) => l.value)).toEqual(["224010", "224011"]);
    expect(r.lots.every((l) => !l.expiry)).toBe(true);
  });
  it("D-0603: lot list with month-only expiries, ignores the serial range", () => {
    const r = extractRegex(D3);
    expect(r.lots.map((l) => [l.value, l.expiry])).toEqual([["GX4471A", "2027-03"], ["GX4471B", "2027-03"]]);
  });
  it("keeps slashes and hyphens inside a lot", () => {
    expect(extractRegex("Lot B-2041/A exp 05/2026").lots[0]).toMatchObject({ value: "B-2041/A", expiry: "2026-05" });
  });
});

const hallucinating: LlmClient = {
  name: "fake",
  complete: async () => JSON.stringify({ ndcs: ["99999-999-99"], lots: [{ value: "ZZZ999", confidence: 0.99 }, { value: "PRORX050925-1", expiry: "2025-11-04", confidence: 0.98 }], notes: "x" })
};

describe("autopsy", () => {
  it("never emits a lot the source text does not contain (COR-3)", async () => {
    const a = await autopsy(D1, { llm: hallucinating });
    expect(a.lots.map((l) => l.value)).not.toContain("ZZZ999");
    expect(a.warnings.join(" ")).toMatch(/ZZZ999/);
  });
  it("agreement lifts confidence to at least 0.9 and marks source both", async () => {
    const a = await autopsy(D1, { llm: hallucinating });
    const lot1 = a.lots.find((l) => l.value === "PRORX050925-1")!;
    expect(lot1.source).toBe("both");
    expect(lot1.confidence).toBeGreaterThanOrEqual(0.98);
  });
  it("falls back to regex-only after two invalid LLM answers (COR-5)", async () => {
    let calls = 0;
    const bad: LlmClient = { name: "bad", complete: async () => { calls++; return "not json"; } };
    const a = await autopsy(D1, { llm: bad });
    expect(calls).toBe(2);
    expect(a.passes.llm).toBe(false);
    expect(a.lots).toHaveLength(2);
    expect(a.warnings.join(" ")).toMatch(/regex-only/);
  });
  it("flags needs-a-living-witness when nothing is found (COR-4)", async () => {
    const a = await autopsy("Recalled due to a labeling mix-up.");
    expect(a.needsReview).toBe(true);
  });
  it("parseLlmJson tolerates code fences", () => {
    expect(parseLlmJson('```json\n{"ndcs":[],"lots":[],"notes":"ok"}\n```')?.notes).toBe("ok");
    expect(parseLlmJson('{"lots":[{"value":"A","confidence":2}]}')).toBeNull();
  });
});

// ---- property-based tests ----
const lotArb = fc.oneof(
  fc.stringMatching(/^[A-Z]{1,5}[0-9]{4,8}$/),
  fc.stringMatching(/^[A-Z]{1,3}[0-9]{3,6}-[A-Z0-9]{1,3}$/),
  fc.stringMatching(/^[A-Z][0-9]{3,5}\/[A-Z]$/),
  fc.stringMatching(/^[0-9]{5,8}$/)
);
const noiseWord = fc.stringMatching(/^[A-Za-z][a-z ,.;:()]{0,24}$/);
const kw = fc.constantFrom("Lot ", "lot# ", "LOT NO. ", "Batch ", "lot code: ", "Lot Nos.: ");
const noisyText = fc.tuple(fc.array(fc.tuple(noiseWord, kw, lotArb, noiseWord), { minLength: 1, maxLength: 5 }), noiseWord)
  .map(([parts, tail]) => ({ text: parts.map(([a, k, l, b]) => `${a} ${k}${l} ${b}`).join("; ") + tail, injected: parts.map((p) => p[2]) }));

describe("properties", () => {
  it("COR-3: even a lying LLM can never add a lot absent from the source", async () => {
    await fc.assert(fc.asyncProperty(fc.string({ maxLength: 200 }), fc.array(lotArb, { maxLength: 4 }), async (text, fake) => {
      const llm: LlmClient = { name: "liar", complete: async () => JSON.stringify({ ndcs: [], lots: fake.map((v) => ({ value: v, confidence: 0.99 })), notes: "" }) };
      const a = await autopsy(text, { llm });
      return a.lots.every((l) => appearsVerbatim(text, l.value));
    }), { numRuns: 200 });
  });

  it("COR-3: regex output is always a substring of noisy input", () => {
    fc.assert(fc.property(noisyText, ({ text }) => extractRegex(text).lots.every((l) => appearsVerbatim(text, l.value))));
  });

  it("COR-2: injected lots are found", () => {
    fc.assert(fc.property(noisyText, ({ text, injected }) => {
      const found = new Set(extractRegex(text).lots.map((l) => l.value.toUpperCase()));
      return injected.every((l) => found.has(l.toUpperCase()));
    }));
  });

  it("COR-2: regex extraction is idempotent", () => {
    fc.assert(fc.property(fc.string({ maxLength: 300 }), (text) => {
      const a = extractRegex(text);
      const b = extractRegex(text);
      if (JSON.stringify(a) !== JSON.stringify(b)) return false;
      const rendered = a.lots.map((l) => `Lot ${l.value}`).join("; ");
      const again = extractRegex(rendered).lots.map((l) => l.value);
      return JSON.stringify(again) === JSON.stringify(a.lots.map((l) => l.value));
    }));
  });
});

// ---- regressions found by running the 50 real 2025 openFDA fixtures ----
import fs from "node:fs";

describe("real 2025 openFDA fixtures (gate: lots extracted from all 50)", () => {
  const recs = JSON.parse(fs.readFileSync(new URL("../../../fixtures/recalls/real-2025.json", import.meta.url), "utf8")) as { code_info: string }[];
  it("finds lots in every record and never invents one", () => {
    expect(recs.length).toBe(50);
    for (const r of recs) {
      const x = extractRegex(r.code_info);
      expect(x.lots.length).toBeGreaterThan(0);
      expect(x.lots.every((l) => appearsVerbatim(r.code_info, l.value))).toBe(true);
    }
  });
  it("reads 'Mon-YY' expiries as dates, not lots (bug: 'Mar-25' was emitted as a lot)", () => {
    const x = extractRegex("[100-Count Bottles] Lot 19231618, exp Mar-25; 19232064, exp Apr-25; 19232324, May-25");
    expect(x.lots.map((l) => [l.value, l.expiry])).toEqual([["19231618", "2025-03"], ["19232064", "2025-04"], ["19232324", "2025-05"]]);
  });
  it("accepts the plural keyword 'Lots:' (bug: whole notice returned zero lots)", () => {
    expect(extractRegex("Lots: 19234121, 19234148, Exp Sep-30-25").lots.map((l) => l.value)).toEqual(["19234121", "19234148"]);
  });
  it("keeps a lot list going after a semicolon when the shape matches (bug: silent false negatives)", () => {
    expect(extractRegex("Lot 19231618, exp Mar-25; 19232064, exp Apr-25").lots).toHaveLength(2);
  });
});
