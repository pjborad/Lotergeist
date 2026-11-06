# Product: Body Snatcher Rx

Body Snatcher Rx turns a vague FDA drug recall into an exact list of affected patients, shelf bottles and a pickup route in under 60 seconds. Kiroween 2026 entry, Frankenstein category, with a Costume Contest standard UI.

## The gap
The pharmacy knows who received a drug but not which lot each patient received. The lot number is lost between the supply chain (tracks lots) and the dispensing system (tracks patients). Pharmacies either warn everyone or no one.

## Users
| User | Job | Sees |
| --- | --- | --- |
| Pharmacist in charge | Respond to a recall fast and precisely | Affected patients, bottles to quarantine, approved outreach |
| Pharmacy technician | Pull stock from the shelf | Scan-to-verify page: cursed or clean |
| Distributor returns coordinator | Collect recalled stock | Pickup route with cold-chain weather warnings |
| Judge | Understand it in 3 minutes | One story: notice, hunt, scan, hearse |

## The six-stage hunt
1. Summoner: openFDA enforcement notice (poll or paste)
2. Coroner: regex + LLM lift NDC, lots and expiry with confidence
3. Tracker: GS1 EPCIS 2.0 chain of custody in DuckDB
4. Grave Robber: Playwright bot reads RxTerm 98 (1998 terminal) and a fax inbox
5. Undertaker: quarantine bins, patient letters (pharmacist approves), shortage omen
6. Hearse: pickup route with NWS weather and cold-chain checks

## Non-goals
No real patient data, no HIPAA claims, no real pharmacy/wholesaler/payer portals, no message is ever sent, no DCLI code or accounts, no native app, no user accounts beyond judge demo mode.

## Cut list (cut from the top when behind)
S5 replay timeline, S4 voice narrator, S2 NADAC card, S3 rxterm-mcp, fax OCR, S1 Night Watch Crew bot, weather check. Never cut: extraction with PBT, trace, RPA on RxTerm 98, Body Trail, Scan, judge mode.
