/**
 * Pull real 2025 openFDA drug enforcement records with messy code_info and save the
 * 50 most interesting ones to fixtures/recalls/real-2025.json.
 * Usage: pnpm --filter @bsrx/summoner exec tsx scripts/refresh-fixtures.ts
 */
import fs from "node:fs";
import path from "node:path";
import { RateLimiter } from "../src/limiter";

const key = process.env.OPENFDA_API_KEY ? `&api_key=${process.env.OPENFDA_API_KEY}` : "";
const out = path.resolve(import.meta.dirname, "../../../fixtures/recalls/real-2025.json");
const limiter = new RateLimiter(200, 60_000);
const seen = new Map<string, Record<string, string>>();

for (let skip = 0; skip < 1000 && seen.size < 400; skip += 100) {
  await limiter.acquire();
  const url = `https://api.fda.gov/drug/enforcement.json?search=report_date:[20250101+TO+20251231]&limit=100&skip=${skip}${key}`;
  const res = await fetch(url);
  if (!res.ok) { console.error("openFDA", res.status); break; }
  const j = (await res.json()) as { results: Record<string, string>[] };
  for (const r of j.results) seen.set(r.recall_number!, r);
}

// "messy" = has a lot keyword, is long or lists several lots, and carries some date text
const messiness = (r: Record<string, string>) => {
  const c = r.code_info ?? "";
  if (!/lot|batch/i.test(c)) return -1;
  return Math.min(c.length, 600) / 100 + (c.match(/lot/gi)?.length ?? 0) + (/exp|bud|best by|use by/i.test(c) ? 2 : 0) + (/[;\n]/.test(c) ? 1 : 0);
};
const picked = [...seen.values()].map((r) => ({ r, s: messiness(r) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 50).map((x) => x.r);
fs.writeFileSync(out, JSON.stringify(picked, null, 2));
console.log(`wrote ${picked.length} records to ${out}`);
