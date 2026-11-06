# Summoner design

- `OpenFdaClient` (`packages/summoner/src/openfda.ts`): `fetchRecent(days)` queries `/drug/enforcement.json?search=report_date:[from TO to]&limit=100`; `fetchByNumber(n)`. API key from `OPENFDA_API_KEY`.
- `RateLimiter`: sliding window, 240 calls per 60 s (SUM-4). Every request goes through `acquire()`.
- Fallback (SUM-3): any non-OK response or network error returns `fixtures/recalls/*.json` with `cached: true`; the UI shows "spirits are quiet (cached fixture)". Synthetic demo recalls (`recalling_firm` contains "(synthetic)") never hit the network.
- `parsePaste` splits input into a recall number (`D-0417-2026`) or free text; free text becomes `PASTE-<hash>` via `recordFromText`.
- `normalizeRecord` keeps the raw openFDA JSON untouched in `recalls.raw_json` for audit.
- Nightly job: `node-cron` at 02:00 UTC in `apps/api/src/server.ts` calls `nightWatch()`; manual trigger `POST /api/night-watch/run`.
- Fixtures: 3 synthetic demo recalls plus 50 real 2025 enforcement records chosen for messy `code_info` (`packages/summoner/scripts/refresh-fixtures.ts`).
- Emits `recall.summoned { recallId }`.
