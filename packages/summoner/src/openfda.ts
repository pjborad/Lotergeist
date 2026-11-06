import { RateLimiter } from "./limiter";
import { loadFixtureRecords, normalizeRecord } from "./normalize";
import type { RecallRecord } from "./types";

export interface OpenFdaOptions {
  apiKey?: string;
  fixtureDir?: string;
  limiter?: RateLimiter;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export interface SummonResult {
  records: RecallRecord[];
  /** true when openFDA failed or rate-limited us and we served fixtures (SUM-3) */
  cached: boolean;
  reason?: string;
}

const fdaDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export class OpenFdaClient {
  private limiter: RateLimiter;
  private fetchImpl: typeof fetch;
  private base: string;

  constructor(private opts: OpenFdaOptions = {}) {
    this.limiter = opts.limiter ?? new RateLimiter(240, 60_000);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.base = opts.baseUrl ?? "https://api.fda.gov";
  }

  private url(pathname: string, params: Record<string, string>) {
    const u = new URL(pathname, this.base);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (this.opts.apiKey) u.searchParams.set("api_key", this.opts.apiKey);
    return u.toString();
  }

  private async getJson(u: string): Promise<Record<string, unknown>[]> {
    await this.limiter.acquire();
    const res = await this.fetchImpl(u, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return []; // openFDA answers 404 for "no matches"
    if (!res.ok) throw new Error(`openFDA HTTP ${res.status}`);
    const j = (await res.json()) as { results?: Record<string, unknown>[] };
    return j.results ?? [];
  }

  private fallback(reason: string, filter?: (r: RecallRecord) => boolean): SummonResult {
    const all = this.opts.fixtureDir ? loadFixtureRecords(this.opts.fixtureDir) : [];
    return { records: filter ? all.filter(filter) : all, cached: true, reason };
  }

  /** SUM-1: enforcement records reported in the last `days` days. */
  async fetchRecent(days = 7, now = new Date()): Promise<SummonResult> {
    const from = new Date(now.getTime() - days * 86_400_000);
    const search = `report_date:[${fdaDate(from)} TO ${fdaDate(now)}]`;
    try {
      const rows = await this.getJson(this.url("/drug/enforcement.json", { search, limit: "100" }));
      return { records: rows.map((r) => normalizeRecord(r)), cached: false };
    } catch (e) {
      return this.fallback((e as Error).message);
    }
  }

  /** SUM-2: one recall by number, live first, fixtures second. */
  async fetchByNumber(recallNumber: string): Promise<SummonResult> {
    const want = recallNumber.toUpperCase();
    const local = this.opts.fixtureDir ? loadFixtureRecords(this.opts.fixtureDir).find((r) => r.recall_number.toUpperCase() === want) : undefined;
    // Synthetic demo recalls only exist in fixtures: skip the network for them.
    if (local && /\(synthetic\)/i.test(local.recalling_firm)) return { records: [local], cached: true };
    try {
      const rows = await this.getJson(this.url("/drug/enforcement.json", { search: `recall_number:"${want}"`, limit: "1" }));
      if (rows.length) return { records: rows.map((r) => normalizeRecord(r)), cached: false };
      return local ? { records: [local], cached: true, reason: "not on openFDA" } : { records: [], cached: false };
    } catch (e) {
      return local ? { records: [local], cached: true, reason: (e as Error).message } : this.fallback((e as Error).message, (r) => r.recall_number.toUpperCase() === want);
    }
  }
}
