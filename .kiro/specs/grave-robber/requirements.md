# Grave Robber: RPA

## Requirements (EARS)
- **RPA-1** WHEN pharmacies holding affected lots are known, THE bot SHALL log into RxTerm 98 for each pharmacy and search dispense history by NDC.
- **RPA-2** THE bot SHALL parse each dispense row into {rx_number, patient_id, ndc, lot, qty, fill_date}.
- **RPA-3** THE bot SHALL parse fax PDFs in the inbox with text extraction and the same row schema.
- **RPA-4** WHEN a dispense row is parsed, THE system SHALL write it as an EPCIS ObjectEvent with bizStep `dispensing`.
- **RPA-5** THE bot SHALL only navigate to hosts on the allowlist (the RxTerm 98 mock and the local fax store).
- **RPA-6** WHILE the bot runs, THE UI SHALL stream each step (login, search, row found) to the Exhumation panel in real time.

## Decisions
- Fax OCR (tesseract) is on the cut list. Fax PDFs have a text layer; "parse confidence" is parsed rows over lines that start with `Rx`.
- Rows carry no serial. The API assigns the oldest on-shelf serials of that lot at that pharmacy (FIFO) and flags `serialInferred`.
- Instant replay: a successful live run is recorded and can be streamed with `RPA_MODE=replay`.
