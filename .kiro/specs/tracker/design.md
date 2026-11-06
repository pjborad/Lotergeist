# Tracker design

- **Synthetic world** (`packages/crypt-seed`): 4 manufacturers, 2 distributors, 8 pharmacies, 12 products, about 40,000 packages, 5 EPCIS events per delivered package (commissioning, shipping, receiving at distributor, shipping, receiving at pharmacy). Seeded RNG, so every run is identical. Dispensing events are deliberately absent: that is the gap the bot fills.
- **Demo shape**: lot PRORX050925-1 has 214 serials split 45/45/65/31/28 across five pharmacies; lot -3 (198) never left the distributor; lot PRORX051125-2 is a clean sibling.
- **Storage** (`packages/tracker`): DuckDB `events` table (VARCHAR columns, ISO timestamps sort lexically), `parties` table, and a `serials` view using `arg_max(..., event_time)`.
- **NDC to GTIN** in `@bsrx/gs1`: `00` + `3` + NDC10 + check digit; 11-digit NDCs map to up to three candidates.
- **Trace** (`CryptStore.trace`): per-lot counts, per-pharmacy received/on-shelf/dispensed, stage summaries for the Body Trail cards, and an orphan check (NOT EXISTS anti-join).
- `custody(gtin, serial)` gives the chain of custody for the Scan trail. `receivedSerials` gives FIFO stock for serial inference.
- Emits `trace.found { recallId, serials, orphans, pharmacies }`.
