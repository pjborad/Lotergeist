# Summoner: recall ingest

Reads FDA drug enforcement notices and turns them into recall records the Coroner can read.

## Requirements (EARS)
- **SUM-1** WHEN the nightly schedule fires, THE system SHALL query openFDA `/drug/enforcement` for records with `report_date` in the last 7 days and store any new `recall_number`.
- **SUM-2** WHEN a user pastes recall text or a recall number into the Summon box, THE system SHALL create a recall record within 2 seconds.
- **SUM-3** IF openFDA returns an error or HTTP 429, THEN THE system SHALL fall back to the cached fixture set and show a "spirits are quiet (cached)" badge.
- **SUM-4** THE system SHALL never call openFDA more than 240 times per minute.

## Acceptance
- `packages/summoner/test/summoner.test.ts` covers SUM-3 (429 fallback), SUM-4 (property test on the limiter) and SUM-2 paste parsing.
- `apps/api/test/e2e.test.ts` asserts SUM-2 end to end (< 2 s).
