import fs from "node:fs";
import path from "node:path";
import type { PasteKind, RecallRecord } from "./types";

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** openFDA enforcement JSON -> our record. Keeps `raw` untouched. */
export function normalizeRecord(raw: Raw, cached = false): RecallRecord {
  return {
    recall_number: str(raw.recall_number),
    classification: str(raw.classification) || "Unclassified",
    status: str(raw.status) || "Ongoing",
    product_description: str(raw.product_description),
    code_info: str(raw.code_info),
    reason_for_recall: str(raw.reason_for_recall),
    recalling_firm: str(raw.recalling_firm),
    report_date: str(raw.report_date),
    raw,
    cached
  };
}

export function classRoman(classification: string): "I" | "II" | "III" | "?" {
  const m = /class\s+(III|II|I)\b/i.exec(classification);
  return (m?.[1]?.toUpperCase() as "I" | "II" | "III" | undefined) ?? "?";
}

export function loadFixtureRecords(dir: string): RecallRecord[] {
  if (!fs.existsSync(dir)) return [];
  const out: RecallRecord[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Raw | Raw[];
    for (const r of Array.isArray(j) ? j : [j]) {
      if (str(r.recall_number)) out.push(normalizeRecord(r, true));
    }
  }
  return out;
}

const RECALL_NUMBER = /^[A-Z]-\d{3,4}-\d{4}$/i;

/** SUM-2: the Summon box takes either a recall number or free text. */
export function parsePaste(input: string): PasteKind {
  const t = input.trim();
  if (RECALL_NUMBER.test(t)) return { kind: "number", recallNumber: t.toUpperCase() };
  return { kind: "text", text: t };
}

function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Wrap pasted free text as a recall record so the Coroner can read it. */
export function recordFromText(text: string, now = new Date()): RecallRecord {
  const clean = text.trim();
  const firstLine = clean.split(/\n/)[0]!.slice(0, 90);
  const raw: Raw = {
    recall_number: `PASTE-${shortHash(clean)}`,
    classification: "Unclassified",
    status: "Pasted",
    product_description: firstLine,
    code_info: clean,
    reason_for_recall: "",
    recalling_firm: "Unknown (pasted text)",
    report_date: now.toISOString().slice(0, 10).replace(/-/g, "")
  };
  return normalizeRecord(raw);
}
