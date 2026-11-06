/** Human-readable GS1 element string for bwip-js: (01)gtin(17)yymmdd(10)lot(21)serial */
export function gs1Text(l: { gtin: string; lot: string; expiry: string; serial: string }): string {
  const e = l.expiry.replace(/-/g, "");
  const yymmdd = e.length >= 8 ? e.slice(2, 8) : "";
  return `(01)${l.gtin}${yymmdd ? `(17)${yymmdd}` : ""}(10)${l.lot}(21)${l.serial}`;
}
