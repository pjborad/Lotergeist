/** GS1 element-string parsing/building for the AIs this app needs: 01, 17, 10, 21 (+ a few more). */

export const GS = "\x1d"; // FNC1 as transmitted in a raw scan

interface AiSpec { fixed?: number; max?: number }
const AI_TABLE: Record<string, AiSpec> = {
  "00": { fixed: 18 },
  "01": { fixed: 14 },
  "02": { fixed: 14 },
  "10": { max: 20 },
  "11": { fixed: 6 },
  "13": { fixed: 6 },
  "15": { fixed: 6 },
  "17": { fixed: 6 },
  "21": { max: 20 },
  "30": { max: 8 },
  "240": { max: 30 },
  "241": { max: 30 }
};

export interface Gs1Elements {
  gtin?: string;
  serial?: string;
  lot?: string;
  /** AI 17 as printed, YYMMDD */
  expiryRaw?: string;
  /** ISO date derived from AI 17 */
  expiry?: string;
}

export type ParseResult =
  | { ok: true; value: Gs1Elements; ais: Record<string, string> }
  | { ok: false; error: string };

export function yymmddToIso(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  const year = 2000 + yy;
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd === 0) dd = last; // GS1: DD=00 means end of month
  if (dd > last) return null;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function isoToYymmdd(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return `${m[1]!.slice(2)}${m[2]}${m[3]}`;
}

function toElements(ais: Record<string, string>): Gs1Elements {
  const v: Gs1Elements = {};
  if (ais["01"]) v.gtin = ais["01"];
  if (ais["21"]) v.serial = ais["21"];
  if (ais["10"]) v.lot = ais["10"];
  if (ais["17"]) {
    v.expiryRaw = ais["17"];
    const iso = yymmddToIso(ais["17"]);
    if (iso) v.expiry = iso;
  }
  return v;
}

function parseHuman(s: string): ParseResult {
  const ais: Record<string, string> = {};
  const re = /\((\d{2,4})\)([^(]*)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(s))) {
    const ai = m[1]!;
    const val = m[2]!;
    consumed += m[0].length;
    if (!AI_TABLE[ai]) return { ok: false, error: `unsupported AI (${ai})` };
    if (ais[ai] !== undefined) return { ok: false, error: `duplicate AI (${ai})` };
    const spec = AI_TABLE[ai]!;
    if (spec.fixed !== undefined && val.length !== spec.fixed) return { ok: false, error: `AI (${ai}) needs ${spec.fixed} chars` };
    if (spec.max !== undefined && (val.length < 1 || val.length > spec.max)) return { ok: false, error: `AI (${ai}) length 1-${spec.max}` };
    ais[ai] = val;
  }
  if (consumed !== s.length || Object.keys(ais).length === 0) return { ok: false, error: "malformed element string" };
  return { ok: true, value: toElements(ais), ais };
}

function parseRaw(s: string): ParseResult {
  const ais: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) { i++; continue; }
    let ai: string | null = null;
    for (const len of [2, 3, 4]) {
      const cand = s.slice(i, i + len);
      if (AI_TABLE[cand]) { ai = cand; break; }
    }
    if (!ai) return { ok: false, error: `unknown AI at offset ${i}` };
    const spec = AI_TABLE[ai]!;
    i += ai.length;
    let val: string;
    if (spec.fixed !== undefined) {
      val = s.slice(i, i + spec.fixed);
      if (val.length !== spec.fixed) return { ok: false, error: `AI ${ai} truncated` };
      i += spec.fixed;
    } else {
      let end = s.indexOf(GS, i);
      if (end === -1) end = s.length;
      val = s.slice(i, end);
      if (val.length < 1 || val.length > spec.max!) return { ok: false, error: `AI ${ai} length 1-${spec.max}` };
      i = end;
    }
    if (ais[ai] !== undefined) return { ok: false, error: `duplicate AI ${ai}` };
    ais[ai] = val;
  }
  if (Object.keys(ais).length === 0) return { ok: false, error: "empty element string" };
  return { ok: true, value: toElements(ais), ais };
}

/**
 * Parse a scanned GS1 element string. Accepts the human-readable "(01)...(21)..." form
 * and the raw form with FNC1 as ASCII GS (0x1d), with or without an "]d2" symbology prefix.
 * A literal "<GS>" or "~" is also accepted as a stand-in for GS when pasted by hand.
 */
export function parseElementString(input: string): ParseResult {
  let s = input.trim();
  if (s.startsWith("]d2") || s.startsWith("]C1") || s.startsWith("]Q3")) s = s.slice(3);
  s = s.replace(/<GS>/gi, GS).replace(/\^/g, GS);
  if (s.startsWith("(")) return parseHuman(s);
  return parseRaw(s);
}

export interface BuildOptions {
  mode?: "human" | "raw";
  order?: string[];
}

/** Inverse of parseElementString for the four AIs we care about. */
export function buildElementString(e: Gs1Elements, opts: BuildOptions = {}): string {
  const mode = opts.mode ?? "human";
  const order = opts.order ?? ["01", "21", "10", "17"];
  const vals: Record<string, string | undefined> = {
    "01": e.gtin,
    "21": e.serial,
    "10": e.lot,
    "17": e.expiryRaw ?? (e.expiry ? isoToYymmdd(e.expiry) ?? undefined : undefined)
  };
  const present = order.filter((ai) => vals[ai] !== undefined && vals[ai] !== "");
  if (mode === "human") return present.map((ai) => `(${ai})${vals[ai]}`).join("");
  let out = "";
  present.forEach((ai, idx) => {
    out += ai + vals[ai];
    const variable = AI_TABLE[ai]!.fixed === undefined;
    if (variable && idx < present.length - 1) out += GS;
  });
  return out;
}

/** GS1 Digital Link used as the EPCIS 2.0 instance identifier for a serialized item. */
export function sgtinDigitalLink(gtin14: string, serial: string): string {
  return `https://id.gs1.org/01/${gtin14}/21/${encodeURIComponent(serial)}`;
}

export function serialFromDigitalLink(epc: string): { gtin: string; serial: string } | null {
  const m = /\/01\/(\d{14})\/21\/(.+)$/.exec(epc);
  return m ? { gtin: m[1]!, serial: decodeURIComponent(m[2]!) } : null;
}
