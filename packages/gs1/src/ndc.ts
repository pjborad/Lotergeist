import { gtinCheckDigit } from "./check";

/** The three FDA 10-digit NDC layouts (labeler-product-package segment lengths). */
export type NdcPattern = "4-4-2" | "5-3-2" | "5-4-1";
export const NDC10_PATTERNS: NdcPattern[] = ["4-4-2", "5-3-2", "5-4-1"];

export interface ParsedNdc {
  /** hyphen-separated segments as written */
  segments: [string, string, string];
  /** every digit, hyphens removed */
  digits: string;
  /** set for 10-digit NDCs */
  pattern?: NdcPattern;
  /** 10 for FDA labels, 11 for the HIPAA 5-4-2 billing form */
  length: 10 | 11;
}

const lens = (p: NdcPattern) => p.split("-").map(Number) as [number, number, number];

/**
 * Parse an NDC. Accepts hyphenated 10-digit (4-4-2, 5-3-2, 5-4-1), hyphenated
 * 11-digit (5-4-2) and bare 11 digits (assumed 5-4-2). Bare 10 digits are
 * ambiguous and rejected.
 */
export function parseNdc(input: string): ParsedNdc | null {
  const s = input.trim();
  const m = /^(\d{4,5})-(\d{3,4})-(\d{1,2})$/.exec(s);
  if (m) {
    const [, a, b, c] = m as unknown as [string, string, string, string];
    const key = `${a.length}-${b.length}-${c.length}`;
    if (key === "5-4-2") return { segments: [a, b, c], digits: a + b + c, length: 11 };
    if ((NDC10_PATTERNS as string[]).includes(key)) {
      return { segments: [a, b, c], digits: a + b + c, pattern: key as NdcPattern, length: 10 };
    }
    return null;
  }
  if (/^\d{11}$/.test(s)) {
    return { segments: [s.slice(0, 5), s.slice(5, 9), s.slice(9)], digits: s, length: 11 };
  }
  return null;
}

/** Format 10 NDC digits using the given layout, e.g. ("7000441705","5-3-2") -> "70004-417-05". */
export function formatNdc10(digits10: string, pattern: NdcPattern): string {
  if (!/^\d{10}$/.test(digits10)) throw new Error("formatNdc10: need exactly 10 digits");
  const [a, b] = lens(pattern);
  return `${digits10.slice(0, a)}-${digits10.slice(a, a + b)}-${digits10.slice(a + b)}`;
}

/** 10-digit NDC to the 11-digit HIPAA 5-4-2 form by zero-padding the short segment. */
export function ndc10ToNdc11(ndc10: string): string {
  const p = parseNdc(ndc10);
  if (!p || p.length !== 10 || !p.pattern) throw new Error(`ndc10ToNdc11: not a 10-digit NDC: ${ndc10}`);
  const [a, b, c] = p.segments;
  if (p.pattern === "4-4-2") return `0${a}-${b}-${c}`;
  if (p.pattern === "5-3-2") return `${a}-0${b}-${c}`;
  return `${a}-${b}-0${c}`;
}

/** GTIN-14 for a 10-digit hyphenated NDC: "00" + "3" + NDC10 + mod-10 check digit. */
export function ndc10ToGtin14(ndc10: string): string {
  const p = parseNdc(ndc10);
  if (!p || p.length !== 10) throw new Error(`ndc10ToGtin14: not a 10-digit NDC: ${ndc10}`);
  const body = `003${p.digits}`;
  return body + gtinCheckDigit(body);
}

/** The 10 NDC digits embedded in an NDC-derived GTIN-14, or null if it is not one. */
export function gtin14ToNdc10Digits(gtin14: string): string | null {
  if (!/^003\d{10}\d$/.test(gtin14)) return null;
  const body = gtin14.slice(0, 13);
  if (gtinCheckDigit(body) !== gtin14.charCodeAt(13) - 48) return null;
  return gtin14.slice(3, 13);
}

export function gtin14ToNdc10(gtin14: string, pattern: NdcPattern): string | null {
  const d = gtin14ToNdc10Digits(gtin14);
  return d ? formatNdc10(d, pattern) : null;
}

/**
 * Every GTIN-14 an NDC could correspond to. A 10-digit NDC has exactly one. An
 * 11-digit NDC has up to three, one for each segment that may have lost a leading zero.
 */
export function ndcToGtin14Candidates(ndc: string): string[] {
  const p = parseNdc(ndc);
  if (!p) return [];
  if (p.length === 10) return [ndc10ToGtin14(ndc)];
  const [a, b, c] = p.segments;
  const out: string[] = [];
  if (a.startsWith("0")) out.push(ndc10ToGtin14(`${a.slice(1)}-${b}-${c}`));
  if (b.startsWith("0")) out.push(ndc10ToGtin14(`${a}-${b.slice(1)}-${c}`));
  if (c.startsWith("0")) out.push(ndc10ToGtin14(`${a}-${b}-${c.slice(1)}`));
  return [...new Set(out)];
}

/** Canonical comparison key for any NDC spelling: the 11-digit zero-padded digit string(s). */
export function ndcKeys(ndc: string): string[] {
  const p = parseNdc(ndc);
  if (!p) return [];
  if (p.length === 11) return [p.digits];
  return [ndc10ToNdc11(ndc).replace(/-/g, "")];
}

/** SOUL-6: 10 NDC digits do not say where the hyphens go, so offer all three layouts to try against openFDA. */
export function ndcHyphenations(digits10: string): string[] {
  if (!/^\d{10}$/.test(digits10)) return [];
  return NDC10_PATTERNS.map((p) => formatNdc10(digits10, p));
}
