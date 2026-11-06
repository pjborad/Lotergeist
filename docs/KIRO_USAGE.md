# How Kiro was used

An honest account. Kiro (the agent) wrote this repo from the intent/spec document and the uploaded four-screen design, working through the six specs in `.kiro/specs/`. Things that were not measured or not run are marked.

## 1. Specs shaped the organs
Each spec has `requirements.md` (the EARS IDs from the plan), `design.md` and `tasks.md`. IDs travel into tests (`COR-3`, `TRK-3` ...) and `describe` blocks.

**One contradiction the requirements pass surfaced:** COR-4 (a human confirms any field under 0.80) versus a fully automatic Night Watch bot. Resolution recorded in `.kiro/specs/coroner/requirements.md`: Night Watch auto-confirms only when `needsReview` is false and `NIGHT_WATCH_AUTORUN=1`, enforced in `confirmRecall()` (HTTP 403 otherwise).

**One design/spec mismatch:** the plan lists six UI screens; the uploaded design has four. The Morgue (drawers, candles, letters) became "The afterlife" on screen IV. Recorded in `costume-ui/requirements.md`.

## 2. Property-based tests
`fast-check` properties live next to the code: GS1 check digits and NDC round-trips, element-string round-trips with FNC1, COR-2/COR-3 on noisy text with a lying LLM, TRK-3 over random synthetic worlds, rate-limit window, grade-6 letters without cross-patient IDs, route order and depot-to-depot.

### The counterexample PBT found
The TRK-3 property generates small synthetic worlds. It failed immediately:

```
Counterexample: [1]            (seed = 1, fillerSerialsPerLot = 30)
Caused by: Error: out of stock for FL015401 at 0614141000227
```

The world generator gave each of 8 pharmacies a random share of a 30-package lot, then generated up to 9 dispenses per pharmacy. A pharmacy holding 2 packages could "dispense" 9. The default 2,150-package lots hid it. Fix: cap fills at half of a pharmacy's stock (`packages/crypt-seed/src/world.ts`). Not a Coroner bug, but a real generator bug that only PBT could reach.

The plan suggested a lot like `B-2041/A` broken by the slash as the likely counterexample. A unit test for slash lots passes; **PBT did not find a slash bug**, so none is claimed.

### Bugs the 50 real openFDA records found (not PBT)
Running the regex pass over `fixtures/recalls/real-2025.json` found three real defects that the hand-written generators missed. Regression tests for each are in `packages/coroner/test/coroner.test.ts`.
1. `Mar-25` style expiries were emitted as lots (and `500-Count` too).
2. The plural keyword `Lots:` was not recognised, so a whole notice returned zero lots.
3. Lot lists that continue after a `;` were cut off, a silent false negative (the dangerous kind).

### Soul Catcher (updated spec)
Specs: `.kiro/specs/soul-catcher/`. Found while building it:
- **The real recall hid its NDC.** Real recall D-0526-2026 keeps the NDC in `product_description` and only the lot in `code_info`. The Coroner was reading `code_info` alone, so it extracted a lot but no NDC. COR-1 says both fields; the pipeline now reads both. A test covers it.
- **A wrong-hyphen bug in my own code.** The first version of the soul card showed `07000-4417-05` for a methylprednisolone package: 10 NDC digits do not say where the hyphens go and I took the first layout (4-4-2) instead of the one matching the prescription. The end-to-end test now asserts `70004-0417-05` and that the WRONG VESSEL message names `70004-417-05`.
- **The Playwright timeout.** The RPA-9 test (an unknown prescription) hung for 60 s because Playwright waits 30 s per click. The write-back bot now uses a 5 s action timeout and fails fast.
- **Camera rehearsal without a camera.** `packages/grave-robber/scripts/soul-catcher-e2e.mjs` replaces `getUserMedia` with a canvas stream that "holds up" each generated label. All six printed labels decoded through the real crop, zxing, 2-frame and API path with the right verdict. This is **not** a test of a physical webcam, lighting or print quality.

## 3. Hooks
`.kiro/hooks/*.json`: `pbt-on-save` (Coroner and GS1 tests on save), `rpa-selectors` (agent hook: re-check `selectors.json` when RxTerm 98 changes), `phi-guard` (PreToolUse on shell commands: blocks `git commit` when staged files look like PHI; the script is also a git pre-commit hook and runs in CI), `usage-log` (PostTaskExec: appends below).
Kiro hooks load at the next session start, so none of them had fired while this repo was being built. **No time-saved numbers exist.** `scripts/phi-guard.sh` was exercised by hand: clean on the repo, exit 2 on a planted SSN.

## 4. MCP
- `dead-registry-mcp` (ours, `packages/dead-registry-mcp`): `summon_recall`, `autopsy`, `trace_lot`, `who_holds`, `plan_hearse`; stdio and `--http`. The stdio server was smoke-tested with the MCP SDK client against a running API; the `--http` mode was not exercised. Configured in `.kiro/settings/mcp.json`.
- Playwright MCP and the AWS docs MCP are listed in `mcp.json` but disabled. They were not used while building.
- `rxterm-mcp` (stretch S3) was not built.

## 5. Custom agents and steering
Three agents (`coroner`, `grave-robber`, `costume-designer`) scope their folders and load the steering they need. Steering: `product`, `tech`, `pharmacy-safety` (always on), `gs1-standards` and `costume` (file-match), `coroner-prompt` (manual; the API reads the fenced prompt from it at runtime). **No before/after output-quality comparison was run.**

## 6. What did not work, and what changed
- `pdf-parse@1.1.4` throws `bad XRef entry` on the first parse in a fresh process (passed under Vitest, failed under the API). Added a retry wrapper in `packages/grave-robber/src/fax.ts`.
- The demo reset first loaded all 53 fixture recalls as "demo": real 2025 recall numbers also start with `D-`. Demo recalls are now identified by `(synthetic)` in the firm name.
- The design shows one terminal with "5 of 14" rows. With per-pharmacy terminals the counts are per store (7 at Riverside, 4, 2, 1, plus 3 by fax). Numbers on screen come from data, not from the mock.
- Dispense rows carry no serial. Serial numbers on the Body Trail are inferred FIFO and labelled. A real deployment would need pharmacy-side scanning at dispense.

## Not done
Lot inference for past fills (INF-1 to INF-6); testing the Soul Catcher with a physical webcam, printed labels and a real carton; Night Watch as a separate Kiro Crew repo (S1), voice narrator (S4), replay timeline (S5), fax OCR, a live OSRM run, a live LLM run, deployment to AWS, video, blog and social posts.
