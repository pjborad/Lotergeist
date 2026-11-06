export * from "./check";
export * from "./ndc";
export * from "./elements";

/** Lot comparison key: case-insensitive, whitespace-collapsed. */
export function normalizeLot(lot: string): string {
  return lot.replace(/\s+/g, "").toUpperCase();
}
