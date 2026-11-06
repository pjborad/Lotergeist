import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildBins, checkShortage, draftOutreach, fleschKincaidGrade, templates, type LlmLike } from "../src/index";

const pid = fc.integer({ min: 1, max: 2400 }).map((n) => `S-${String(n).padStart(4, "0")}`);
const day = fc.integer({ min: 1, max: 28 }).map((d) => `2025-10-${String(d).padStart(2, "0")}`);

describe("outreach drafts (UND-2)", () => {
  it("the design's wording is grade 6 or below", () => {
    expect(fleschKincaidGrade(templates("2025-10-09")[0]!)).toBeLessThanOrEqual(6);
  });
  it("PBT: a letter never contains another patient's ID and is plain language", async () => {
    await fc.assert(fc.asyncProperty(fc.uniqueArray(pid, { minLength: 2, maxLength: 12 }), day, async (ids, d) => {
      const drafts = await Promise.all(ids.map((id) => draftOutreach({ patientId: id, fillDate: d, pharmacyGln: "g" }, { knownPatientIds: ids })));
      return drafts.every((dr, i) => ids.every((id, j) => i === j || !dr.text.includes(id)) && !dr.text.includes(ids[i]!) && dr.grade <= 6);
    }));
  });
  it("rejects an LLM letter that leaks a patient ID or reads too hard, and falls back to the template", async () => {
    const leaky: LlmLike = { complete: async () => "Hello from [PHARMACY NAME]. Patient S-0417, call [PHARMACY PHONE]." };
    const dense: LlmLike = { complete: async () => "Notwithstanding pharmacovigilance considerations, [PHARMACY NAME] recommends discontinuation; telephone [PHARMACY PHONE] immediately for reimbursement." };
    for (const llm of [leaky, dense]) {
      const d = await draftOutreach({ patientId: "S-0417", fillDate: "2025-10-09", pharmacyGln: "g" }, { llm });
      expect(d.writtenBy).toBe("template");
    }
  });
  it("accepts a good LLM letter", async () => {
    const good: LlmLike = { complete: async () => "Hi, this is [PHARMACY NAME]. Your medicine may be part of a recall. Please do not use it. Call us at [PHARMACY PHONE]." };
    expect((await draftOutreach({ patientId: "S-1", fillDate: "2025-10-09", pharmacyGln: "g" }, { llm: good })).writtenBy).toBe("llm");
  });
});

describe("quarantine bins (UND-1)", () => {
  it("one bin per pharmacy with stock, numbered Q-1..", () => {
    const items = [{ pharmacyGln: "b", gtin: "g", serial: "1", lot: "L", expiry: "", shelf: "C-12" }, { pharmacyGln: "b", gtin: "g", serial: "2", lot: "L", expiry: "", shelf: "C-12" }, { pharmacyGln: "a", gtin: "g", serial: "3", lot: "L", expiry: "", shelf: "C-12" }];
    expect(buildBins(items, [{ gln: "a", name: "A" }, { gln: "b", name: "B" }, { gln: "c", name: "C" }]).map((b) => [b.id, b.count])).toEqual([["Q-1", 1], ["Q-2", 2]]);
  });
});

describe("shortage (UND-4)", () => {
  it("uses the fixture for demo drugs and computes a NADAC delta", async () => {
    const r = await checkShortage("Methylprednisolone", { fixture: { methylprednisolone: { onList: false, soleSource: true, substitute: "Triamcinolone 40 mg/mL", unit: "mL", drugUnitPrice: 1.1, substituteUnitPrice: 1.52 } } });
    expect(r).toMatchObject({ soleSource: true, nadacDelta: 0.42, source: "fixture" });
  });
  it("reads current shortages from openFDA", async () => {
    const f = (async () => new Response(JSON.stringify({ results: [{ status: "Current" }] }))) as unknown as typeof fetch;
    expect((await checkShortage("x", { fetchImpl: f })).onList).toBe(true);
  });
  it("degrades quietly when openFDA is down", async () => {
    const f = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect((await checkShortage("x", { fetchImpl: f })).source).toBe("none");
  });
});
