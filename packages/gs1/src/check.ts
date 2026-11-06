/** GS1 mod-10 check digit. `body` is the GTIN without its final check digit. */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new Error(`gtinCheckDigit: digits only, got "${body}"`);
  let sum = 0;
  // weights alternate 3,1,3,1... starting from the digit right next to the check digit
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(gtin: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(gtin)) return false;
  return gtinCheckDigit(gtin.slice(0, -1)) === gtin.charCodeAt(gtin.length - 1) - 48;
}
