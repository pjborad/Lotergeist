export interface ShelfItem {
  pharmacyGln: string;
  gtin: string;
  serial: string;
  lot: string;
  expiry: string;
  shelf: string;
}

export interface Bin {
  id: string;
  pharmacyGln: string;
  pharmacyName: string;
  count: number;
}

/** UND-1: every affected package still on a shelf is a quarantine item; one bin (Q-n) per pharmacy. */
export function buildBins(items: ShelfItem[], pharmacies: { gln: string; name: string }[]): Bin[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.pharmacyGln, (counts.get(i.pharmacyGln) ?? 0) + 1);
  return pharmacies
    .filter((p) => counts.has(p.gln))
    .map((p, idx) => ({ id: `Q-${idx + 1}`, pharmacyGln: p.gln, pharmacyName: p.name, count: counts.get(p.gln)! }));
}
