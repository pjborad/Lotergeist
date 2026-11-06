# Safety

Body Snatcher Rx is a hackathon demo. It is **not** a medical device, **not** HIPAA-compliant and **not** for clinical use.

- **Synthetic data only.** Patients (`S-0417`), pharmacies, manufacturers, distributors, recalls D-0417/0522/0603-2026 and every serialized package are invented. The 50 files in `fixtures/recalls/real-2025.json` are real public openFDA enforcement records, which contain no patient data.
- **Nothing is sent.** There is no SMS, email or call code. Approving a letter sets `status = approved` and means "ready, not sent". A pharmacist approves each letter.
- **No invented lots.** The Coroner drops any lot not found verbatim in the notice (COR-3). Confidence under 0.80 requires a human to confirm that tag (COR-4).
- **Inferred serials are labelled.** The terminal and fax do not print serials; the app assigns the oldest on-shelf packages of that lot (FIFO) and shows `serialInferred`.
- **Scan at fill never writes a bad lot.** Only a CAPTURED scan is typed into the prescription record. CURSED, WRONG VESSEL and DEPARTED scans are saved for audit and block the fill. The software is a second check, not a replacement for the pharmacist: a package with no DataMatrix, or a damaged one, is not checked at all.
- **Bot allowlist.** The Grave Robber can only request the RxTerm 98 host (RPA-5). Other requests are aborted and logged.
- **PHI guard.** `scripts/phi-guard.sh` blocks commits containing SSN-shaped numbers or labelled dates of birth; it runs as a git pre-commit hook (`pnpm hooks:install`), a Kiro PreToolUse hook and in CI.
- **Secrets** live in environment variables, never in the repo (`.env.example` lists them).
- **Accessibility.** The design palette, focus rings, ARIA labels and reduced-motion handling are in place, but no contrast audit or screen-reader pass has been run. Full WCAG validation needs manual testing with assistive technologies.
- **Data sources.** openFDA and api.weather.gov are public APIs; their terms apply. openFDA's own disclaimer: do not rely on it to make decisions regarding medical care.
