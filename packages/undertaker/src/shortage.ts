export interface ShortageInfo {
  onList: boolean;
  soleSource: boolean;
  source: "openfda" | "fixture" | "none";
  genericName: string;
  substitute?: string;
  substituteUnitPrice?: number;
  drugUnitPrice?: number;
  /** substitute minus recalled drug, per unit; fixture prices are synthetic */
  nadacDelta?: number;
  unit?: string;
  note?: string;
}

export interface ShortageFixture {
  [generic: string]: { onList: boolean; soleSource: boolean; substitute?: string; unit?: string; drugUnitPrice?: number; substituteUnitPrice?: number };
}

/** UND-4: ask openFDA /drug/shortages, falling back to synthetic fixtures for demo drugs. */
export async function checkShortage(genericName: string, opts: { fetchImpl?: typeof fetch; fixture?: ShortageFixture; apiKey?: string; offline?: boolean } = {}): Promise<ShortageInfo> {
  const key = genericName.toLowerCase().trim();
  const fx = opts.fixture?.[key];
  if (fx) {
    const delta = fx.drugUnitPrice !== undefined && fx.substituteUnitPrice !== undefined ? Math.round((fx.substituteUnitPrice - fx.drugUnitPrice) * 100) / 100 : undefined;
    return { onList: fx.onList, soleSource: fx.soleSource, source: "fixture", genericName, substitute: fx.substitute, substituteUnitPrice: fx.substituteUnitPrice, drugUnitPrice: fx.drugUnitPrice, nadacDelta: delta, unit: fx.unit, note: "Demo fixture; prices are synthetic." };
  }
  if (opts.offline) return { onList: false, soleSource: false, source: "none", genericName };
  try {
    const f = opts.fetchImpl ?? fetch;
    const u = new URL("https://api.fda.gov/drug/shortages.json");
    u.searchParams.set("search", `generic_name:"${key.replace(/"/g, "")}"`);
    u.searchParams.set("limit", "5");
    if (opts.apiKey) u.searchParams.set("api_key", opts.apiKey);
    const res = await f(u, { signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return { onList: false, soleSource: false, source: "openfda", genericName };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { results?: { status?: string }[] };
    const current = (j.results ?? []).some((r) => /current/i.test(r.status ?? ""));
    return { onList: current, soleSource: false, source: "openfda", genericName };
  } catch {
    return { onList: false, soleSource: false, source: "none", genericName, note: "openFDA shortage lookup unavailable." };
  }
}
