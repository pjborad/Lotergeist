# Soul Catcher: scan at fill, with RPA write-back

From "Body Snatcher Rx - Intent, Spec & Build Plan (Kiroween 2026) 2". The lot is already printed in the DataMatrix on every prescription package. Going forward, a webcam scan at fill time captures it and the bot writes it into the old system.

## Requirements (EARS)
- **SOUL-1** WHEN the Soul Catcher screen opens, THE system SHALL request the rear camera (`facingMode: environment`) at 1280x720 and show a live preview with an aiming frame.
- **SOUL-2** WHEN a GS1 DataMatrix is in the aiming frame, THE system SHALL decode it within 1.5 seconds under normal indoor light.
- **SOUL-3** THE system SHALL accept a decode only when the same value is read in 2 consecutive frames.
- **SOUL-4** THE system SHALL parse GS1 AIs 01, 17, 10 and 21, handling the FNC1 group separator and the `]d2` prefix.
- **SOUL-5** IF the GTIN check digit is invalid, THEN THE system SHALL reject the scan and show "the spirit is garbled, scan again".
- **SOUL-6** WHEN a scan is accepted, THE system SHALL derive the 10-digit NDC from the GTIN and look up the drug name in openFDA `/drug/ndc`.
- **SOUL-7** IF the scanned NDC does not match the prescription being filled, THEN THE system SHALL block the fill with a "wrong vessel" warning.
- **SOUL-8** IF the scanned lot is in an active recall, THEN THE system SHALL block the fill and show CURSED with the recall number.
- **SOUL-9** IF the expiry date is in the past, THEN THE system SHALL warn "this soul has already departed" and block the fill.
- **SOUL-10** WHEN a scan is accepted, THE system SHALL save {rx_number, gtin, ndc, lot, expiry, serial, scanned_at} within 500 ms.
- **SOUL-11** IF no camera is available or permission is denied, THEN THE system SHALL accept a USB 2D scanner (keyboard wedge) or a typed GS1 string.
- **SOUL-12** THE camera stream SHALL run only on HTTPS or localhost and stop when the user leaves the screen.
- **RPA-7** WHEN a fill scan is saved, THE bot SHALL open that prescription in RxTerm 98, open the notes field (F6) and type `LOT <lot> EXP <yyyy-mm> SN <serial>`.
- **RPA-8** THE bot SHALL re-read the saved note and mark the write-back "verified" only if it matches the scan exactly.
- **RPA-9** IF write-back fails 2 times, THEN THE system SHALL keep the scan, flag it "not written back" and retry on the next run.

## Decisions
- Verdict precedence when several apply: CURSED, then WRONG VESSEL, then DEPARTED, then CAPTURED. All flags are stored and shown.
- Only a CAPTURED scan is written back. A cursed, wrong or expired package never reaches the prescription record.
- "Saved within 500 ms" covers parse, checks and the SQLite insert. The openFDA drug name is filled in afterwards (3 s timeout), so a slow network cannot block a flag.
- Synthetic drugs are named from the demo catalog; only real drugs (alendronate) call openFDA.
- The legacy note field is upper-case ASCII, 80 columns. A lot with lowercase letters cannot be stored faithfully, so RPA-8 reports it as not verified instead of pretending.

## Not built from the updated plan
Lot inference for past fills (INF-1 to INF-6, `lot_assignments`, `GET /api/recalls/:id/assignments`) and its two properties (INF-2, INF-5).
