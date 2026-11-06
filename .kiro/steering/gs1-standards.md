---
inclusion: fileMatch
fileMatchPattern: "packages/(gs1|tracker|crypt-seed)/**"
---

# GS1 standards used here

## Application identifiers
| AI | Meaning | Format |
| --- | --- | --- |
| 01 | GTIN | 14 digits, fixed |
| 10 | Lot | 1-20 chars, variable |
| 17 | Expiry | YYMMDD, fixed (DD=00 means end of month) |
| 21 | Serial | 1-20 chars, variable |

Variable-length AIs are followed by FNC1 (ASCII GS, 0x1d) unless last. Scanners may prefix `]d2`. Human-readable form is `(01)...(21)...`.

## NDC to GTIN-14
- 10-digit FDA NDC layouts: 4-4-2, 5-3-2, 5-4-1. The 11-digit HIPAA form is 5-4-2 (zero-padded).
- GTIN-14 = `00` + `3` + NDC10 digits + mod-10 check digit. Example: `70004-417-05` -> `00370004417051`.
- An 11-digit NDC maps back to up to three GTINs, one per segment that could have lost a leading zero (`ndcToGtin14Candidates`).
- Check digit: weights 3,1,3,1 from the right of the body, `(10 - sum % 10) % 10`.

## EPCIS 2.0
Events are flattened ObjectEvents. Instance identifier is a GS1 Digital Link: `https://id.gs1.org/01/{gtin}/21/{serial}`.

| bizStep | Who writes it | Notes |
| --- | --- | --- |
| commissioning | manufacturer | readPoint = manufacturer GLN, bizLocation = line |
| shipping | manufacturer or distributor | `sourceGln` -> `destGln` |
| receiving | distributor or pharmacy | `ownerGln` is the holder after the event, `bizLocation` = shelf |
| dispensing | Grave Robber (`origin: rpa`) | written back from terminal/fax rows, never in the seed |

Invariant (TRK-3): every pharmacy `receiving` has an earlier `shipping` to that pharmacy. No orphan serials.
