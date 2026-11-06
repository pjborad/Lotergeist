# Soul Catcher design

## Browser (`apps/web/src/lib/scanner.ts`, `screens/SoulCatcher.tsx`)
1. `getUserMedia({ video: { facingMode: "environment", width: 1280, height: 720 } })`, refused unless `isSecureContext` (SOUL-12). The tracks stop when the screen unmounts.
2. About 10 frames a second, cropped to the centre square (the aiming frame). Decoder: native `BarcodeDetector({ formats: ["data_matrix"] })` when the browser reports `data_matrix`, otherwise `@zxing/browser` with `POSSIBLE_FORMATS = [DATA_MATRIX]` and `TRY_HARDER`.
3. A code is accepted when the same string is read in 2 consecutive frames; then the video freezes and the scan is posted.
4. Fallbacks: "Speak the code" text box and a USB keyboard-wedge mode that focuses the same box.
5. Verdict ribbon pairs colour, icon and word. Sound: chime on CAPTURED, crack on CURSED.

## API (`apps/api/src/fills.ts`)
- `POST /api/fills/:rx/scan { raw, device }` parses (`@bsrx/gs1`), checks the GTIN (SOUL-5), finds an active recall by NDC + lot (`findActiveRecall`, the same rule the Mirror uses), compares the NDC with the prescription, checks the expiry, saves to `fill_scans`, then names the drug.
- 10 NDC digits do not say where the hyphens go. The layout that matches the prescription wins, then the catalog's, then a 5-3-2 guess.
- `GET /api/fills`, `/api/fills/next`, `/api/fills/scans`, `POST /api/fills/:rx/writeback`, `POST /api/fills/retry`, SSE `GET /api/fills/stream` (`fill.scanned`, `fill.step`, `fill.writeback`).
- A CAPTURED scan starts `runWriteback` (never throws). Result: `verified` or `failed`; failed scans are retried at startup and on `POST /api/fills/retry` (RPA-9).

## RxTerm 98 and the bot
- New screens: F2 FILL QUEUE (`/queue`), prescription detail (`/rx/:rx`), F6 NOTES (`/rx/:rx/notes`). Notes are upper-cased ASCII, 80 columns, kept in memory.
- `packages/grave-robber/src/writeback.ts`: login, queue, open Rx, F6, type, submit, re-read `#note`, compare. 5 s action timeout, 2 attempts.

## Data
`fill_scans(rx_number, pharmacy_gln, raw_gs1, gtin, ndc, lot, expiry, serial, scanned_at, device, verdict, flags_json, recall_id, drug, drug_source, labeler, saved_ms, writeback_status, writeback_note, writeback_readback, writeback_error, writeback_attempts)`.
The queue (5 prescriptions at Riverside Apothecary) comes from `generateWorld().queue`.
