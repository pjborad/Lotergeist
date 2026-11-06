import { dateAt } from "@bsrx/coroner";
import { parseNdc } from "@bsrx/gs1";

export interface LabelFields { ndc?: string; lot?: string; expiry?: string; serial?: string; gtin?: string; notes: string[] }

/** OCR confuses letters and digits; fix the obvious ones inside a token that should be numeric. */
const digitsOnly = (s: string) => s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");

/**
 * Pull NDC, lot, expiry and serial out of text read off a package label (OCR) or typed in.
 * The caller shows the result for a person to check: OCR on curved labels is never trusted blindly.
 */
export function parseLabelText(text: string): LabelFields {
  const t = text.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const out: LabelFields = { notes: [] };

  const gtin = /\(?01\)?\s?(\d{14})/.exec(t);
  if (gtin) out.gtin = gtin[1];

  const ndcM = /\bNDC[:\s#-]*([0-9OIl]{4,5}-[0-9OIl]{3,4}-[0-9OIl]{1,2})\b/i.exec(t) ?? /\b([0-9OIl]{4,5}-[0-9OIl]{3,4}-[0-9OIl]{1,2})\b/.exec(t);
  if (ndcM) {
    const cleaned = ndcM[1]!.split("-").map(digitsOnly).join("-");
    if (parseNdc(cleaned)) out.ndc = cleaned; else out.notes.push(`Could not make sense of NDC "${ndcM[1]}"`);
  }

  const lotM = /\b(?:LOT|BATCH)\s*(?:NO\.?|#|NUMBER)?\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,19})\b/i.exec(t);
  if (lotM) out.lot = lotM[1]!.toUpperCase();

  const expM = /\b(?:EXP(?:IRY|IRES|IRATION)?|USE\s*BY|BUD)\.?\s*(?:DATE)?\s*[:.\-]?\s*/i.exec(t);
  if (expM) {
    const d = dateAt(t, (expM.index ?? 0) + expM[0].length);
    if (d) out.expiry = d.iso;
  }

  const snM = /\b(?:SN|S\/N|SERIAL(?:\s*(?:NO\.?|NUMBER|#))?)\s*[:#.\-]?\s*([A-Z0-9]{3,20})\b/i.exec(t);
  if (snM) out.serial = snM[1]!.toUpperCase();

  if (!out.ndc && !out.gtin) out.notes.push("No NDC found. Hold the label flatter and closer, or type it.");
  if (!out.lot) out.notes.push("No lot number found.");
  if (!out.expiry) out.notes.push("No expiry date found.");
  return out;
}
