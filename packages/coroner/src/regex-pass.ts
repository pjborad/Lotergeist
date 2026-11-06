import { parseNdc } from "@bsrx/gs1";
import { dateAt } from "./dates";
import type { ExtractedLot, ExtractedNdc } from "./types";

export interface RegexResult {
  ndcs: ExtractedNdc[];
  lots: ExtractedLot[];
}

const LOT_KEYWORD = /\b(?:lots?(?:\s*(?:nos?\.?|numbers?|#|codes?))?|batch(?:\s*(?:nos?\.?|numbers?|#))?)\b\s*[:#.]?/gi;
const EXP_KEYWORD = /(?:exp(?:iry|iration|ires)?\.?|bud|use\s+by|best\s+by)\s*(?:date)?\s*[:\-]?\s*/iy;
const STOP_WORD = /^(?:ndc|upc|gtin|serial|serials|manufactured|distributed|packaged|sku|ref)$/i;
const DOSE_TOKEN = /^\d+(?:\.\d+)?-?(?:mg|ml|mcg|g|iu|units?|ct|count|counts|oz|%|l|cc|tablets?|capsules?|bottles?|vials?|pens?)(?:\/\w+)?$/i;
const NDC_RE = /\b\d{4,5}-\d{3,4}-\d{1,2}\b/g;

function cleanToken(tok: string): string {
  return tok.replace(/^[("'\[]+/, "").replace(/[)"'\].,;:]+$/, "");
}

/** "AB1234-1" -> "AA9999-9": lets us recognise a lot list that continues after a semicolon. */
function shape(tok: string): string {
  return tok.replace(/[A-Za-z]/g, "A").replace(/\d/g, "9");
}

function plausibleLot(tok: string): boolean {
  if (tok.length < 3 || tok.length > 30) return false;
  if (!/\d/.test(tok)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/_.]*[A-Za-z0-9]$/.test(tok)) return false;
  if (DOSE_TOKEN.test(tok)) return false;
  if (/^\d{4}$/.test(tok) && +tok >= 1990 && +tok <= 2100) return false; // bare year
  if (parseNdc(tok)) return false;
  return true;
}

export function extractNdcs(text: string): ExtractedNdc[] {
  const out = new Map<string, ExtractedNdc>();
  for (const m of text.matchAll(NDC_RE)) {
    if (!parseNdc(m[0])) continue;
    const before = text.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    const confidence = /ndc/i.test(before) ? 0.95 : 0.85;
    const prev = out.get(m[0]);
    if (!prev || prev.confidence < confidence) out.set(m[0], { value: m[0], confidence, source: "regex" });
  }
  for (const m of text.matchAll(/\bNDC[:\s#]*(\d{11})\b/gi)) {
    const v = m[1]!;
    if (!out.has(v)) out.set(v, { value: v, confidence: 0.9, source: "regex" });
  }
  return [...out.values()];
}

export function extractLotsRegex(input: string): ExtractedLot[] {
  const text = input.replace(/\s+/g, " ");
  const kws = [...text.matchAll(LOT_KEYWORD)];
  const lots = new Map<string, ExtractedLot>();

  kws.forEach((kw, idx) => {
    const start = (kw.index ?? 0) + kw[0].length;
    const nextKw = kws[idx + 1]?.index ?? text.length;
    const end = nextKw;
    let crossedSemi = false;
    let cursor = start;
    let last: ExtractedLot | undefined;
    let pending: ExtractedLot[] = [];
    let position = 0;

    while (cursor < end) {
      const sep = /^[\s,;]+/.exec(text.slice(cursor, end));
      if (sep) {
        if (sep[0].includes(";")) crossedSemi = true;
        cursor += sep[0].length;
        continue;
      }

      EXP_KEYWORD.lastIndex = cursor;
      const ek = EXP_KEYWORD.exec(text);
      if (ek && ek.index === cursor && cursor + ek[0].length <= end + 1) {
        cursor += ek[0].length;
        const d = dateAt(text, cursor);
        if (d && d.end <= end + 1) {
          for (const p of pending) if (!p.expiry) p.expiry = d.iso;
          pending = [];
          cursor = d.end;
        }
        continue;
      }

      const d = dateAt(text, cursor);
      if (d && d.end <= end) {
        for (const p of pending) if (!p.expiry) p.expiry = d.iso;
        pending = [];
        cursor = d.end;
        continue;
      }

      const tokMatch = /^[^\s,;]+/.exec(text.slice(cursor, end));
      if (!tokMatch) break;
      cursor += tokMatch[0].length;
      const tok = cleanToken(tokMatch[0]);
      if (STOP_WORD.test(tok)) break;
      if (!plausibleLot(tok)) continue;
      // After a ";" only keep going if the token looks like the previous lot (same shape)
      if (crossedSemi) {
        if (!last || shape(tok) !== shape(last.value)) break;
        crossedSemi = false;
      }

      const mixed = /[A-Za-z]/.test(tok);
      let confidence = mixed ? 0.88 : 0.82;
      if (position > 0) confidence -= 0.02;
      position++;
      const key = tok.toUpperCase();
      const existing = lots.get(key);
      if (existing) { last = existing; pending.push(existing); continue; }
      last = { value: tok, confidence, source: "regex" };
      lots.set(key, last);
      pending.push(last);
    }
  });

  for (const l of lots.values()) {
    if (l.expiry) l.confidence = Math.min(0.95, l.confidence + 0.07);
    l.confidence = Math.round(l.confidence * 100) / 100;
  }
  return [...lots.values()];
}

export function extractRegex(text: string): RegexResult {
  return { ndcs: extractNdcs(text), lots: extractLotsRegex(text) };
}
