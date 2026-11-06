# Grave Robber design

- **RxTerm 98** (`apps/rxterm98`): Express app that serves a green-on-black terminal as HTML. Screens: sign-on, main menu, F3 dispense history (query by NDC and optional lot, 5 rows per page, F7/F8 paging). Login is the pharmacy code with password `GRAVE98`. Each pharmacy sees only its own fills.
- **Bot** (`packages/grave-robber`): one Playwright browser context per pharmacy. Page navigation is driven by `rpa/selectors.json`. Every request is checked against the host allowlist through `page.route` (RPA-5); off-list requests, including the terminal's web font, are aborted.
- Rows are parsed from the screen text (`parseTerminalLine`), filtered to the recalled lots, and reported through `onStep` as `rpa.step` events with the full screen text for the UI.
- **Fax path**: `pdf-parse` reads each PDF in `fixtures/fax`, `parseFaxText` extracts NDC, lot and `Rx` rows. A retry wrapper handles pdf-parse's first-parse failure.
- **Write-back** (`apps/api/src/pipeline.ts`): rows are sorted by fill date and assigned FIFO serials, then written to the crypt as `dispensing` ObjectEvents (`origin: rpa`).
- **Replay**: a successful live run is saved to `data/replay/<id>.json`; `RPA_MODE=replay` streams it.
