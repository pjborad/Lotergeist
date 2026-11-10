/**
 * Medicine knowledge for the Rx Watcher's deterministic rules.
 *
 * This is a small, curated table for the products in the demo store. It is NOT a licensed interaction database
 * (plan 6.1 names First Databank / Medi-Span for production) and it is not clinical advice. Every entry is a
 * rule input; a pharmacist makes every decision.
 */

export type DrugClass =
  | "basal-insulin" | "ace-inhibitor" | "biguanide" | "statin" | "ssri" | "penicillin" | "opioid" | "ccb" | "glp1"
  | "bronchodilator" | "antiemetic" | "corticosteroid" | "fluoroquinolone" | "bisphosphonate";

export interface Drug {
  id: string;
  match: RegExp;
  generic: string;
  cls: DrugClass;
  /** doses per day the label allows (any of these is normal) */
  labelDosesPerDay: number[];
  /** what one "unit" of quantity is when the pack is counted: tablets, capsules, insulin units, doses */
  unit: "tablet" | "capsule" | "units" | "dose" | "puff" | "ml";
  /** units in one pack as dispensed (qty counts packs) */
  unitsPerPack: number;
  /** extra units used per administration (insulin pens are primed with 2 units) */
  primeUnits?: number;
  /** typical single-dose range, same unit */
  doseRange?: [number, number];
  /** dosing interval in days for weekly products */
  intervalDays?: number;
  /** controlled-substance schedule */
  schedule?: "CII";
  /** allergy words that mean this drug is in an allergy class */
  allergyClass?: string;
}

export const DRUGS: Drug[] = [
  { id: "insulin-glargine", match: /insulin glargine/i, generic: "insulin glargine", cls: "basal-insulin", labelDosesPerDay: [1], unit: "units", unitsPerPack: 1500, primeUnits: 2, doseRange: [4, 80] },
  { id: "lisinopril", match: /lisinopril/i, generic: "lisinopril", cls: "ace-inhibitor", labelDosesPerDay: [1, 2], unit: "tablet", unitsPerPack: 90, doseRange: [1, 2] },
  { id: "metformin", match: /metformin/i, generic: "metformin", cls: "biguanide", labelDosesPerDay: [1, 2], unit: "tablet", unitsPerPack: 100, doseRange: [1, 4] },
  { id: "atorvastatin", match: /atorvastatin/i, generic: "atorvastatin", cls: "statin", labelDosesPerDay: [1], unit: "tablet", unitsPerPack: 90, doseRange: [1, 2] },
  { id: "sertraline", match: /sertraline/i, generic: "sertraline", cls: "ssri", labelDosesPerDay: [1], unit: "tablet", unitsPerPack: 30, doseRange: [1, 4] },
  { id: "amoxicillin", match: /amoxicillin/i, generic: "amoxicillin", cls: "penicillin", labelDosesPerDay: [2, 3], unit: "capsule", unitsPerPack: 100, doseRange: [1, 2], allergyClass: "penicillin" },
  { id: "oxycodone", match: /oxycodone/i, generic: "oxycodone", cls: "opioid", labelDosesPerDay: [3, 4, 6], unit: "tablet", unitsPerPack: 100, doseRange: [1, 2], schedule: "CII" },
  { id: "amlodipine", match: /amlodipine/i, generic: "amlodipine", cls: "ccb", labelDosesPerDay: [1], unit: "tablet", unitsPerPack: 90, doseRange: [1, 2] },
  { id: "semaglutide", match: /semaglutide/i, generic: "semaglutide", cls: "glp1", labelDosesPerDay: [1], unit: "dose", unitsPerPack: 4, intervalDays: 7, doseRange: [1, 1] },
  { id: "albuterol", match: /albuterol/i, generic: "albuterol", cls: "bronchodilator", labelDosesPerDay: [1, 2, 3, 4], unit: "puff", unitsPerPack: 200, doseRange: [1, 2] },
  { id: "ondansetron", match: /ondansetron/i, generic: "ondansetron", cls: "antiemetic", labelDosesPerDay: [1, 2, 3], unit: "tablet", unitsPerPack: 30, doseRange: [1, 2] },
  { id: "methylprednisolone", match: /methylprednisolone/i, generic: "methylprednisolone", cls: "corticosteroid", labelDosesPerDay: [1], unit: "ml", unitsPerPack: 5, doseRange: [0.25, 2] },
  { id: "prednisone", match: /prednisone/i, generic: "prednisone", cls: "corticosteroid", labelDosesPerDay: [1, 2], unit: "tablet", unitsPerPack: 10, doseRange: [1, 4] },
  { id: "ciprofloxacin", match: /ciprofloxacin/i, generic: "ciprofloxacin", cls: "fluoroquinolone", labelDosesPerDay: [2], unit: "tablet", unitsPerPack: 14, doseRange: [1, 2] },
  { id: "alendronate", match: /alendronate/i, generic: "alendronate", cls: "bisphosphonate", labelDosesPerDay: [1], unit: "dose", unitsPerPack: 4, intervalDays: 7, doseRange: [1, 1] }
];

export const findDrug = (name: string): Drug | undefined => DRUGS.find((d) => d.match.test(name));

export interface InteractionRule { a: DrugClass; b: DrugClass; severity: "monitor" | "needs_review"; title: string; body: string }

export const INTERACTIONS: InteractionRule[] = [
  { a: "ace-inhibitor", b: "basal-insulin", severity: "monitor", title: "Lisinopril with insulin", body: "May add to insulin's blood-sugar-lowering effect. Common pairing; counsel on low-sugar signs." },
  { a: "corticosteroid", b: "basal-insulin", severity: "monitor", title: "Steroid with insulin", body: "Steroids can raise blood sugar and change the insulin dose needed. Counsel on checking sugars." },
  { a: "glp1", b: "basal-insulin", severity: "needs_review", title: "GLP-1 pen with insulin", body: "Together they raise the chance of low blood sugar. Confirm the prescriber meant both and counsel on low-sugar signs." },
  { a: "ssri", b: "antiemetic", severity: "monitor", title: "Sertraline with ondansetron", body: "Both can affect heart rhythm and serotonin. Usually fine at normal doses; counsel on palpitations or agitation." },
  { a: "opioid", b: "ssri", severity: "monitor", title: "Opioid with sertraline", body: "Sedation and serotonin effects can add up. Counsel on drowsiness." },
  { a: "fluoroquinolone", b: "corticosteroid", severity: "needs_review", title: "Fluoroquinolone with steroid", body: "Together they raise the risk of tendon injury, mostly in older adults. Confirm with the prescriber." },
  { a: "statin", b: "ccb", severity: "monitor", title: "Atorvastatin with amlodipine", body: "Amlodipine can raise statin levels a little. Counsel on unexplained muscle pain." }
];

/** Therapy classes where two active drugs of the same class is a duplicate. */
export const DUPLICATE_CLASSES = new Set<DrugClass>(["basal-insulin", "statin", "ssri", "ace-inhibitor", "ccb", "opioid"]);

// ------------------------------------------------------------------ sig parsing

export interface ParsedSig {
  dosesPerDay: number | null;
  perDose: number | null;
  /** days the sig itself names ("for 10 days") */
  courseDays: number | null;
  weekly: boolean;
  atBedtime: boolean;
  text: string;
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };

/** Read a prescription direction into numbers. Returns nulls for anything it cannot read; it never guesses. */
export function parseSig(sig: string): ParsedSig {
  const s = ` ${sig.toLowerCase().replace(/\s+/g, " ")} `;
  const num = (t: string) => (WORD_NUM[t] ?? (Number.isFinite(Number(t)) ? Number(t) : null));

  let dosesPerDay: number | null = null;
  if (/\b(four times (a|per) day|four times daily|qid)\b/.test(s)) dosesPerDay = 4;
  else if (/\b(three times (a|per) day|three times daily|tid)\b/.test(s)) dosesPerDay = 3;
  else if (/\b(twice (a|per) day|twice daily|two times (a|per) day|bid)\b/.test(s)) dosesPerDay = 2;
  else if (/\b(morning and (at )?(bed ?time|night|evening)|morning and evening)\b/.test(s)) dosesPerDay = 2;
  else if (/\b(once (a|per) day|once daily|every day|daily|each day|every morning|every evening|at bed ?time|every night|nightly)\b/.test(s)) dosesPerDay = 1;
  const weekly = /\b(once (a|per) week|once weekly|weekly|every week)\b/.test(s);
  const everyN = /every (\d+)(?:\s*-\s*\d+)? hours/.exec(s);
  if (everyN) dosesPerDay = Math.round(24 / Number(everyN[1]));

  let perDose: number | null = null;
  const m = /\b(?:inject|take|use|give|inhale|apply|insert)?\s*(\d+(?:\.\d+)?|one|two|three|four|five|six|half)\s*(?:to \d+\s*)?(units?|tablets?|capsules?|puffs?|ml|mL|doses?|pens?)\b/.exec(s);
  if (m) perDose = num(m[1]!);

  const course = /for (\d+) days?/.exec(s);
  return { dosesPerDay, perDose, courseDays: course ? Number(course[1]) : null, weekly, atBedtime: /bed ?time|night/.test(s), text: sig };
}

/** Expected days supply from quantity (packs) and the sig. null when the sig cannot be read. */
export function expectedDaysSupply(drug: Drug, qtyPacks: number, sig: ParsedSig): number | null {
  if (sig.courseDays) return sig.courseDays;
  if (drug.intervalDays) return Math.floor((qtyPacks * drug.unitsPerPack) * drug.intervalDays);
  if (!sig.dosesPerDay || !sig.perDose) return null;
  const perAdmin = sig.perDose + (drug.primeUnits ?? 0);
  const perDay = perAdmin * sig.dosesPerDay;
  return Math.floor((qtyPacks * drug.unitsPerPack) / perDay);
}

// ------------------------------------------------------------------ age band (the only demographic that reaches the LLM)

export function ageBand(dob: string, today: string): string {
  const y = (Date.parse(today) - Date.parse(dob)) / (365.25 * 86_400_000);
  if (!Number.isFinite(y)) return "unknown";
  if (y < 18) return "under 18";
  if (y < 40) return "18-39";
  if (y < 65) return "40-64";
  if (y < 80) return "65-79";
  return "80+";
}
