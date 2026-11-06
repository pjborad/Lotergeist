# Tracker: EPCIS trace

## Requirements (EARS)
- **TRK-1** WHEN extraction is confirmed, THE system SHALL convert each NDC to GTIN-14 and find all EPCIS events whose SGTIN lot matches.
- **TRK-2** THE system SHALL return, for each matching serial: current owner, location, last bizStep and timestamp.
- **TRK-3** THE trace graph SHALL contain no orphan serials: every serial at a pharmacy SHALL have an upstream shipping event.
- **TRK-4** THE trace for a recall SHALL complete in under 3 seconds for 50,000 events.

## Properties (fast-check)
| Property | Requirement |
| --- | --- |
| Every GTIN check digit is valid | TRK-1 |
| NDC -> GTIN -> NDC round-trips for 4-4-2, 5-3-2, 5-4-1 | TRK-1 |
| The 11-digit HIPAA form maps back to the original GTIN | TRK-1 |
| No orphan serials in any random synthetic world | TRK-3 |

## Notes
The crypt holds about 200,000 events (about 40,000 packages) and the trace test asserts < 3 s for the whole crypt, which is four times the TRK-4 bound.
