import { fleschKincaidGrade } from "./readability";

export interface LlmLike { complete(system: string, user: string): Promise<string> }

export interface OutreachInput {
  patientId: string;
  /** ISO date of the fill */
  fillDate: string;
  pharmacyGln: string;
}

export interface OutreachDraft {
  patientId: string;
  pharmacyGln: string;
  fillDate: string;
  text: string;
  grade: number;
  /** "template" or "llm" */
  writtenBy: "template" | "llm";
}

export const MAX_GRADE = 6;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : "recently";
}

/** Plain-language templates from most to least formal. We never send these; a pharmacist approves each one. */
export function templates(fillDate: string): string[] {
  const d = longDate(fillDate);
  return [
    `Hello from [PHARMACY NAME]. A medicine you picked up on ${d} may be part of a safety recall. Please don't use it for now. Call us at [PHARMACY PHONE] and we'll replace it at no cost.`,
    `Hi, this is [PHARMACY NAME]. The medicine you got on ${d} may be part of a recall. Please stop using it. Call us at [PHARMACY PHONE]. We will swap it for free.`,
    `This is [PHARMACY NAME]. Your medicine from ${d} may be recalled. Please stop using it. Call [PHARMACY PHONE]. We will swap it free.`
  ];
}

const SYSTEM = `You write short text messages from a pharmacy to a patient about a drug recall.
Rules: reading grade 6 or lower, 4 sentences at most, calm tone, no medical advice beyond "do not use it for now and call us".
Keep the placeholders [PHARMACY NAME] and [PHARMACY PHONE] exactly as written. Never write a patient name, ID or date of birth.
Return only the message text.`;

/** UND-2: grade 6 or lower, and never another patient's ID. */
export async function draftOutreach(input: OutreachInput, opts: { llm?: LlmLike | null; knownPatientIds?: string[] } = {}): Promise<OutreachDraft> {
  const forbidden = (opts.knownPatientIds ?? []).concat(input.patientId);
  const ok = (t: string) => t.includes("[PHARMACY NAME]") && t.includes("[PHARMACY PHONE]") && !forbidden.some((id) => id && t.includes(id)) && !/S-\d{4}/.test(t) && fleschKincaidGrade(t) <= MAX_GRADE;
  const base = (t: string, by: OutreachDraft["writtenBy"]): OutreachDraft => ({ patientId: input.patientId, pharmacyGln: input.pharmacyGln, fillDate: input.fillDate, text: t, grade: fleschKincaidGrade(t), writtenBy: by });

  if (opts.llm) {
    const tpl = templates(input.fillDate)[0]!;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = (await opts.llm.complete(SYSTEM, `Rewrite this message at grade 6:\n${tpl}`)).trim();
        if (ok(out)) return base(out, "llm");
      } catch { /* fall through to templates */ }
    }
  }
  for (const t of templates(input.fillDate)) if (ok(t)) return base(t, "template");
  return base(templates(input.fillDate).at(-1)!, "template");
}
