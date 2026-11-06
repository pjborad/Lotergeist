import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildElementString, gtinCheckDigit, gtin14ToNdc10, isValidGtin, ndc10ToGtin14, ndc10ToNdc11,
  ndcToGtin14Candidates, formatNdc10, parseElementString, parseNdc, GS, type NdcPattern
} from "../src/index";

const digits = (n: number) => fc.stringMatching(new RegExp(`^[0-9]{${n}}$`));
const patterns: NdcPattern[] = ["4-4-2", "5-3-2", "5-4-1"];
const ndc10Arb = fc.tuple(fc.constantFrom(...patterns), digits(10)).map(([p, d]) => ({ p, ndc: formatNdc10(d, p) }));

describe("GTIN math", () => {
  it("matches the design's worked example", () => {
    expect(ndc10ToGtin14("70004-417-05")).toBe("00370004417051");
  });

  // PBT: every generated GTIN check digit is valid (TRK-1)
  it("every GTIN check digit is valid", () => {
    fc.assert(fc.property(digits(13), (body) => isValidGtin(body + gtinCheckDigit(body))));
  });

  it("detects a single flipped digit", () => {
    fc.assert(fc.property(digits(13), fc.integer({ min: 0, max: 12 }), fc.integer({ min: 1, max: 9 }), (body, at, delta) => {
      const g = body + gtinCheckDigit(body);
      const flipped = g.slice(0, at) + String((Number(g[at]) + delta) % 10) + g.slice(at + 1);
      return !isValidGtin(flipped);
    }));
  });

  // PBT: NDC -> GTIN -> NDC round-trips for all valid formats (TRK-1)
  it("NDC to GTIN to NDC round-trips for every 10-digit layout", () => {
    fc.assert(fc.property(ndc10Arb, ({ p, ndc }) => gtin14ToNdc10(ndc10ToGtin14(ndc), p) === ndc));
  });

  it("the 11-digit HIPAA form maps back to the original GTIN", () => {
    fc.assert(fc.property(ndc10Arb, ({ ndc }) => ndcToGtin14Candidates(ndc10ToNdc11(ndc)).includes(ndc10ToGtin14(ndc))));
  });

  it("parseNdc rejects junk and bare 10 digits", () => {
    expect(parseNdc("1234567890")).toBeNull();
    expect(parseNdc("12-34-56")).toBeNull();
    expect(parseNdc("70004-0417-05")?.length).toBe(11);
  });
});

describe("GS1 element strings", () => {
  const safe = fc.stringMatching(/^[A-Z0-9][A-Z0-9\-./]{0,18}[A-Z0-9]$/);
  const gtinArb = digits(13).map((b) => b + gtinCheckDigit(b));
  const exp = fc.record({ y: fc.integer({ min: 20, max: 40 }), m: fc.integer({ min: 1, max: 12 }), d: fc.integer({ min: 1, max: 28 }) })
    .map(({ y, m, d }) => `${String(y).padStart(2, "0")}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`);
  const elems = fc.record({ gtin: gtinArb, serial: safe, lot: safe, expiryRaw: exp }, { requiredKeys: ["gtin"] });
  const orders = fc.constantFrom(["01", "21", "10", "17"], ["01", "17", "10", "21"], ["01", "10", "21", "17"]).map((o) => [...o]);

  // PBT: parse then build round-trips with FNC1 (SCN-1)
  it("build then parse round-trips in human and raw form", () => {
    fc.assert(fc.property(elems, orders, fc.constantFrom("human" as const, "raw" as const), (e, order, mode) => {
      const s = buildElementString(e, { mode, order });
      const r = parseElementString(s);
      if (!r.ok) return false;
      return r.value.gtin === e.gtin && r.value.serial === e.serial && r.value.lot === e.lot && r.value.expiryRaw === e.expiryRaw;
    }));
  });

  it("parses the design example", () => {
    const r = parseElementString("(01)00370004417051(21)000214(10)PRORX050925-1(17)251104");
    expect(r).toMatchObject({ ok: true, value: { gtin: "00370004417051", serial: "000214", lot: "PRORX050925-1", expiry: "2025-11-04" } });
  });

  it("handles FNC1 separators and the ]d2 prefix", () => {
    const raw = `]d2010037000441705121000214${GS}10PRORX050925-1${GS}17251104`;
    expect(parseElementString(raw)).toMatchObject({ ok: true, value: { lot: "PRORX050925-1", serial: "000214" } });
  });

  it("rejects garbage", () => {
    expect(parseElementString("hello").ok).toBe(false);
    expect(parseElementString("(01)123").ok).toBe(false);
  });
});
