import { buildElementString, GS, ndc10ToGtin14 } from "@bsrx/gs1";

/** A raw GS1 DataMatrix payload as a scanner would send it: AIs 01, 17, 10, 21 with FNC1 after variable fields. */
export function buildGs1(ndc10: string, lot: string, expiryIso: string, serial: string): string {
  return buildElementString({ gtin: ndc10ToGtin14(ndc10), lot, expiry: expiryIso, serial }, { mode: "raw", order: ["01", "17", "10", "21"] });
}
export { GS };
