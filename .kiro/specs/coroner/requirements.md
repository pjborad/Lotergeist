# Coroner: lot extraction

## Requirements (EARS)
- **COR-1** WHEN a recall record is created, THE system SHALL extract NDC codes, lot numbers and expiry dates from `product_description` and `code_info`.
- **COR-2** THE system SHALL run a deterministic regex pass before the LLM pass and mark each field with its source: regex, llm or both.
- **COR-3** THE system SHALL never output a lot number that does not appear verbatim (case-insensitive, whitespace-normalized) in the source text.
- **COR-4** IF any field's confidence is below 0.8, THEN THE system SHALL flag the recall "needs a living witness" and require human confirmation before tracing.
- **COR-5** THE LLM response SHALL validate against a JSON schema; invalid output SHALL be retried once, then fall back to regex-only.

## Properties (fast-check)
| Property | Requirement |
| --- | --- |
| Every output lot is a substring of the input, even if the LLM lies | COR-3 |
| Regex extraction is deterministic and idempotent | COR-2 |
| Injected lots in noisy text are always found | COR-1 |

## Design tension found by the requirements pass
COR-4 (human confirms low-confidence lots) conflicts with a fully automatic Night Watch run. Resolution: Night Watch may auto-confirm only when `needsReview` is false and `NIGHT_WATCH_AUTORUN=1`; otherwise it leaves the recall at `autopsied`.
