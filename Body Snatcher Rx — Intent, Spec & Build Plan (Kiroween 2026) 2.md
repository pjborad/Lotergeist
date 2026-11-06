# Body Snatcher Rx — Intent, Spec & Build Plan (Kiroween 2026)

Nov 5, 2026 · @Pritesh Borad

## 1. Intent

Body Snatcher Rx turns a vague FDA drug recall into an exact list of affected patients, shelf bottles and a pickup route in under 60 seconds. It is submitted to the **Frankenstein** category of Kiroween 2026, with a frontend built to Costume Contest standard.

**The problem (the gap).** When the FDA recalls a drug lot, the pharmacy knows who received the drug but not which lot each patient received. The lot number is lost between the supply chain (which tracks lots) and the pharmacy's dispensing system (which tracks patients). UCSF and the FDA built automated recall alerts in 2026 and could not deploy them for exactly this reason (JMIRx Med 2026;7:e68345). Pharmacies either warn everyone, causing panic, or warn no one, which is dangerous.

**Root cause and the fix.** Most pharmacy systems never record the lot at fill time: the pharmacist pours from a stock bottle and nobody scans its lot. Yet the lot is already printed on every prescription drug package in the 2D DataMatrix barcode required under DSCSA. The app fixes the gap in two directions: going forward, a webcam scan at fill time captures the exact lot and an RPA bot writes it back into the old system; for past fills, a lot-window inference ranks patients as likely or possible from stock arrival and fill dates.

**What the app does.** It stitches together six systems that were never meant to talk:

1. openFDA recall notices (government free text)
2. An AI extractor that pulls lot numbers out of that text
3. GS1 EPCIS supply-chain events (the DSCSA tracing standard)
4. An RPA bot that reads a 1998-era pharmacy terminal and a fax inbox
5. A GS1 DataMatrix barcode scanner in the browser
6. Routing and weather APIs for the return trip

**One-line pitch.** "Somewhere out there, a cursed lot is still walking. Body Snatcher Rx hunts it down: from the FDA's death notice, through the crypt of a 1998 pharmacy terminal, to the patient's cabinet, then hauls the body home in a refrigerated hearse."

**Users.**

| User | Job to be done | What they see |
| --- | --- | --- |
| Pharmacist in charge (primary) | Respond to a recall fast and precisely | Affected patients, bottles to quarantine, approved outreach |
| Pharmacy technician | Pull stock from the shelf | Scan-to-verify page: cursed or clean |
| Distributor returns coordinator | Collect recalled stock | Pickup route with cold-chain weather warnings |
| Judge (demo audience) | Understand it in 3 minutes | One story: notice, hunt, scan, hearse |

**Win thesis.** Judges score five criteria at 20% each. This idea wins on Impact (a peer-reviewed, unsolved gap), Innovation (unusual public datasets combined), Technological Implementation (eight organs, deep Kiro use with property-based tests) and Design plus Presentation (a haunted UI with a physical barcode-scan moment). Generic chatbots and RAG apps cannot match all five at once.

**Success criteria for submission day.**

- [ ] A live URL where a judge can run the full flow with no login in under 3 minutes
- [ ] End-to-end trace of a real 2025 openFDA recall against synthetic data, from notice to route
- [ ] At least 6 property-based tests passing, including one documented bug PBT caught
- [ ] `.kiro/` folder with 6 specs, 5 steering files, 4 hooks and 2 custom MCP servers
- [ ] UI passes WCAG AA contrast and works on a phone for the scan page
- [ ] Video under 3:00, blog post and social post published

## 2. Category strategy and judging map

Submit to **Frankenstein** and polish the UI as if it were a Costume Contest entry. A project can win one Overall or one Category prize plus any Bonus prizes. Overall prizes ($30k / $20k / $10k) are judged across all categories, so a Frankenstein entry with a stunning UI competes for both the $5,000 category prize and the top three.

Why not submit to Costume Contest: that category rewards a haunted UI first. Our strongest argument is the stitched technologies, and the UI amplifies it. In Frankenstein, the UI becomes the tiebreaker most entries lack.

**Bonus prizes to target.** Best Demo ($1,000), Best Kiro Crew App ($1,000, via the Night Watch bot), Blog (2,000 credits), Social Blitz.

| Criterion (20% each) | What judges look for | How Body Snatcher Rx scores | Proof in the submission |
| --- | --- | --- | --- |
| Potential Impact | Real problem, real users | Peer-reviewed gap; DSCSA small-pharmacy deadline Nov 27, 2027; 225 active shortages | Problem slide in video, citation in README |
| Technological Implementation | Depth and variety of Kiro use | 6 specs, PBT, 4 hooks, 5 steering files, 2 custom MCP servers, 3 custom agents, Crew bot | `.kiro/` folder, `docs/KIRO_USAGE.md` |
| Design | Complete, coherent product, not a proof of concept | Costume-grade UI where every spooky element maps to a function | Live URL, screens in section 7 |
| Innovation | Unusual tech and public data combined | AI + EPCIS + 1998 terminal RPA + barcode + routing + weather | Architecture diagram, organ table |
| Presentation | Clear story, memorable demo | Four-act story with a physical webcam scan moment | Video, section 10 |

**Rule.** Every Halloween element must do a job. The candle shows stock level, the coffin shows quarantine, the hearse shows the route. Decoration that does nothing loses Design points.

## 3. Scope

The MVP is the six-stage hunt working end to end on one live recall; everything else is stretch and can be cut without breaking the story.

**MVP (must ship by Nov 30).**

| # | Capability | Module |
| --- | --- | --- |
| M1 | Ingest a recall from openFDA by poll or by paste | `summoner` |
| M2 | Extract NDC, lots and expiry with regex plus LLM and confidence scores | `coroner` |
| M3 | Trace lots through synthetic EPCIS events to receiving pharmacies | `tracker` |
| M4 | RPA bot reads dispense records from RxTerm 98 and a fax PDF inbox | `grave-robber` |
| M5 | Body Trail screen: timeline plus graph from notice to patient | `web` |
| M6 | Quarantine list and pharmacist-approved outreach drafts | `undertaker` |
| M7 | **Soul Catcher: live webcam scan of a GS1 DataMatrix at fill time, returning the real lot, expiry, serial and drug name** | `scanner` + `web/soul-catcher` |
| M8 | **RPA write-back: bot types the scanned lot into the RxTerm 98 prescription record** | `grave-robber` |
| M9 | **Lot-window inference for past fills: exact, likely, possible, unlikely** | `tracker` |
| M10 | Mirror: scan any package to get CURSED or CLEAN against active recalls (reuses the scanner) | `web/mirror` |
| M11 | Pickup route with NWS weather warnings | `hearse` |
| M12 | Haunted design system, sound toggle, reduced-motion mode | `web` |
| M13 | `dead-registry-mcp` server exposing trace tools | `mcp` |

**Stretch (only after MVP is green).**

| # | Capability | Value |
| --- | --- | --- |
| S1 | Night Watch Kiro Crew bot: nightly recall poll, re-trace, Discord digest | Best Kiro Crew App bonus |
| S2 | Shortage and NADAC cost card | Impact depth |
| S3 | `rxterm-mcp` wrapping the RPA bot as an MCP tool | Kiro depth |
| S4 | Voice narrator for the oracle (Web Speech API) | Demo flair |
| S5 | Recall replay of the last 30 days on a timeline | Design |

**Non-goals.** No real patient data, no HIPAA claims, no real pharmacy, wholesaler or payer portals, no messages actually sent to anyone, no DCLI code, data or accounts, no native mobile app, no user accounts beyond a judge demo mode.

## 4. Requirements (EARS)

Each block below becomes one `.kiro/specs/<module>/requirements.md`; the IDs are reused in tests, tasks and commit messages.

### 4.1 Summoner (recall ingest)

- **SUM-1** WHEN the nightly schedule fires, THE system SHALL query openFDA `/drug/enforcement` for records with `report_date` in the last 7 days and store any new `recall_number`.
- **SUM-2** WHEN a user pastes recall text or a recall number into the Summon box, THE system SHALL create a recall record within 2 seconds.
- **SUM-3** IF openFDA returns an error or HTTP 429, THEN THE system SHALL fall back to the cached fixture set and show a "spirits are quiet (cached)" badge.
- **SUM-4** THE system SHALL never call openFDA more than 240 times per minute.

### 4.2 Coroner (lot extraction)

- **COR-1** WHEN a recall record is created, THE system SHALL extract NDC codes, lot numbers and expiry dates from `product_description` and `code_info`.
- **COR-2** THE system SHALL run a deterministic regex pass before the LLM pass and mark each field with its source: regex, llm or both.
- **COR-3** THE system SHALL never output a lot number that does not appear verbatim (case-insensitive, whitespace-normalized) in the source text.
- **COR-4** IF any field's confidence is below 0.8, THEN THE system SHALL flag the recall "needs a living witness" and require human confirmation before tracing.
- **COR-5** THE LLM response SHALL validate against a JSON schema; invalid output SHALL be retried once, then fall back to regex-only.

### 4.3 Tracker (EPCIS trace)

- **TRK-1** WHEN extraction is confirmed, THE system SHALL convert each NDC to GTIN-14 and find all EPCIS events whose SGTIN lot matches.
- **TRK-2** THE system SHALL return, for each matching serial: current owner, location, last bizStep and timestamp.
- **TRK-3** THE trace graph SHALL contain no orphan serials: every serial at a pharmacy SHALL have an upstream shipping event.
- **TRK-4** THE trace for a recall SHALL complete in under 3 seconds for 50,000 events.

### 4.4 Grave Robber (RPA)

- **RPA-1** WHEN pharmacies holding affected lots are known, THE bot SHALL log into RxTerm 98 for each pharmacy and search dispense history by NDC.
- **RPA-2** THE bot SHALL parse each dispense row into {rx\_number, patient\_id, ndc, lot, qty, fill\_date}.
- **RPA-3** THE bot SHALL parse fax PDFs in the inbox with text extraction and the same row schema.
- **RPA-4** WHEN a dispense row is parsed, THE system SHALL write it as an EPCIS ObjectEvent with bizStep `dispensing`.
- **RPA-5** THE bot SHALL only navigate to hosts on the allowlist (the RxTerm 98 mock and the local fax store).
- **RPA-6** WHILE the bot runs, THE UI SHALL stream each step (login, search, row found) to the Exhumation panel in real time.

### 4.5 Undertaker (actions)

- **UND-1** THE system SHALL list every affected serial still on a shelf as a quarantine item.
- **UND-2** THE system SHALL draft one plain-language outreach message per affected patient at grade 6 reading level.
- **UND-3** THE system SHALL never send a message; a pharmacist SHALL approve each draft, and approval only marks it "ready".
- **UND-4** WHERE a recalled drug appears in openFDA `/drug/shortages`, THE system SHALL show a shortage-risk badge.

### 4.6 Scan (verify)

- **SCN-1** WHEN a GS1 DataMatrix is in camera view, THE system SHALL decode GTIN (01), serial (21), lot (10) and expiry (17) within 1.5 seconds.
- **SCN-2** IF the lot matches an active recall, THEN THE system SHALL show CURSED with the patient trail; otherwise CLEAN.
- **SCN-3** IF no camera is available, THEN THE system SHALL accept a typed or pasted barcode string.

### 4.7 Hearse (routing)

- **HRS-1** THE system SHALL plan a pickup route from the distributor depot through every pharmacy holding quarantined stock and back.
- **HRS-2** THE route SHALL start and end at the depot and visit each stop exactly once.
- **HRS-3** WHERE a drug requires refrigeration, THE system SHALL check NWS alerts and hourly forecasts along the route and flag any stop above 25 C or below 0 C.

### 4.8 Experience and safety

- **UX-1** THE app SHALL offer a judge demo mode reachable from the landing page with no login.
- **UX-2** WHERE the user prefers reduced motion, THE UI SHALL disable animations and the audio SHALL stay off.
- **UX-3** THE UI SHALL meet WCAG 2.2 AA contrast for all text.
- **SAFE-1** THE app SHALL show a persistent "Synthetic data, not for clinical use" banner.
- **SAFE-2** THE repository SHALL fail its pre-commit hook if a file matches PHI patterns (SSN, real DOB plus name pairs).

### 4.9 Soul Catcher (scan at fill)

- **SOUL-1** WHEN the Soul Catcher screen opens, THE system SHALL request the rear camera (`facingMode: environment`) at 1280x720 and show a live preview with an aiming frame.
- **SOUL-2** WHEN a GS1 DataMatrix is in the aiming frame, THE system SHALL decode it within 1.5 seconds under normal indoor light.
- **SOUL-3** THE system SHALL accept a decode only when the same value is read in 2 consecutive frames.
- **SOUL-4** THE system SHALL parse GS1 Application Identifiers 01 (GTIN), 17 (expiry), 10 (lot) and 21 (serial), handling the FNC1 group separator and the `]d2` symbology prefix.
- **SOUL-5** IF the GTIN check digit is invalid, THEN THE system SHALL reject the scan and show "the spirit is garbled, scan again".
- **SOUL-6** WHEN a scan is accepted, THE system SHALL derive the 10-digit NDC from the GTIN and look up the drug name in openFDA `/drug/ndc`.
- **SOUL-7** IF the scanned NDC does not match the NDC of the prescription being filled, THEN THE system SHALL block the fill with a "wrong vessel" warning.
- **SOUL-8** IF the scanned lot is in an active recall, THEN THE system SHALL block the fill and show CURSED with the recall number.
- **SOUL-9** IF the expiry date is in the past, THEN THE system SHALL warn "this soul has already departed" and block the fill.
- **SOUL-10** WHEN a scan is accepted, THE system SHALL save {rx\_number, gtin, ndc, lot, expiry, serial, scanned\_at} within 500 ms.
- **SOUL-11** IF no camera is available or permission is denied, THEN THE system SHALL accept a USB 2D scanner (keyboard wedge) or a typed GS1 string.
- **SOUL-12** THE camera stream SHALL run only on HTTPS or localhost and stop when the user leaves the screen.

### 4.10 RPA write-back

- **RPA-7** WHEN a fill scan is saved, THE bot SHALL open that prescription in RxTerm 98, open the notes field (F6) and type `LOT <lot> EXP <yyyy-mm> SN <serial>`.
- **RPA-8** THE bot SHALL re-read the saved note and mark the write-back "verified" only if it matches the scan exactly.
- **RPA-9** IF write-back fails 2 times, THEN THE system SHALL keep the scan, flag it "not written back" and retry on the next run.

### 4.11 Lot inference (past fills)

- **INF-1** WHEN a recall is traced, THE system SHALL classify every past fill of the recalled NDC at each pharmacy as exact, likely, possible or unlikely.
- **INF-2** WHERE a fill has a scan or a lot in its record, THE system SHALL classify it exact and skip inference.
- **INF-3** WHERE a fill has no lot, THE system SHALL simulate stock first-in-first-out from receiving events and fill quantities, and assign a probability per lot.
- **INF-4** THE system SHALL label probability 0.8 or more likely, 0.2 to 0.8 possible, and below 0.2 unlikely.
- **INF-5** THE total quantity assigned to a lot SHALL never exceed the quantity of that lot received.
- **INF-6** THE UI SHALL show the evidence for each likely or possible fill: lot arrival date, next lot arrival date and fill date.

## 5. Architecture and data model

One Node.js API server runs the six modules as a pipeline; outside systems feed in on the left and three surfaces read the results on the right.

&#91;embedded content: system architecture · 5 sources, 6 modules, 3 outputs\]

The highlighted RPA step is the bridge across the gap: it turns legacy terminal screens and faxes into the same EPCIS events the supply chain already uses.

### 5.1 Pipeline events

| Event | Emitted by | Payload |
| --- | --- | --- |
| `recall.summoned` | Summoner | recallId |
| `recall.autopsied` | Coroner | recallId, needsReview |
| `recall.confirmed` | User or auto (confidence 0.8 or more) | recallId |
| `trace.found` | Tracker | recallId, pharmacies, serials |
| `rpa.step` | Grave Robber | pharmacy, action, screenshot |
| `dispense.found` | Grave Robber | recallId, patientId, serial, lot |
| `undertaker.ready` | Undertaker | recallId, quarantine count, drafts count |
| `hearse.planned` | Hearse | recallId, route GeoJSON, warnings |

The web UI subscribes to all events for a recall over one SSE stream: `GET /api/recalls/:id/stream`.

### 5.2 Data model

| Table | Store | Key columns |
| --- | --- | --- |
| `recalls` | SQLite | id, recall\_number, classification, product\_description, code\_info, raw\_json, status |
| `extractions` | SQLite | recall\_id, kind (ndc, lot, expiry), value, confidence, source, confirmed |
| `events` | DuckDB | event\_id, type, biz\_step, event\_time, epc (SGTIN), gtin, serial, lot, expiry, read\_point, owner\_gln |
| `serials` (view) | DuckDB | gtin, serial, lot, current\_owner, current\_location, last\_biz\_step |
| `pharmacies` | SQLite | gln, name, lat, lon, system (rxterm or fax) |
| `dispenses` | SQLite | rx\_number, patient\_id, pharmacy\_gln, ndc, lot, serial, qty, fill\_date, source |
| `quarantine` | SQLite | recall\_id, pharmacy\_gln, serial, status |
| `outreach` | SQLite | recall\_id, patient\_id, draft\_text, reading\_grade, status (draft, approved) |
| `routes` | SQLite | recall\_id, stops\_json, geojson, cold\_chain\_warnings |

Tables added for scan at fill and inference:

| Table | Store | Key columns |
| --- | --- | --- |
| `fill_scans` | SQLite | rx\_number, pharmacy\_gln, raw\_gs1, gtin, ndc, lot, expiry, serial, scanned\_at, device (webcam, usb, typed), writeback\_status (pending, verified, failed) |
| `lot_assignments` | SQLite | recall\_id, rx\_number, lot, probability, class (exact, likely, possible, unlikely), evidence\_json |

### 5.3 Key API routes

| Method and path | Purpose |
| --- | --- |
| `POST /api/recalls` | Summon by paste or recall number |
| `GET /api/recalls/:id` | Full state of one recall |
| `POST /api/recalls/:id/confirm` | Confirm extracted lots |
| `GET /api/recalls/:id/stream` | SSE event stream |
| `POST /api/scan` | Verify a GS1 element string |
| `POST /api/outreach/:id/approve` | Seal a letter (never sends) |
| `POST /api/demo/reset` | Reset judge mode to its starting state |

Routes added for scan at fill:

| Method and path | Purpose |
| --- | --- |
| `GET /api/fills/next` | The prescription waiting to be filled (from RxTerm 98) |
| `POST /api/fills/:rx/scan` | Save a parsed scan; returns drug name, match result, recall and expiry verdicts |
| `POST /api/fills/:rx/writeback` | Queue the RPA write-back into RxTerm 98 |
| `GET /api/recalls/:id/assignments` | Exact, likely, possible and unlikely fills with evidence |

## 6. Module design

Every module is a TypeScript package in one pnpm monorepo, talking through a typed in-process event bus in the API server; only RxTerm 98 runs as a separate app so the RPA has something real to drive.

### 6.1 Summoner

- Node cron (`node-cron`) at 02:00 UTC calls `https://api.fda.gov/drug/enforcement.json?search=report_date:[{7d ago}+TO+{today}]&limit=100` with the free API key from an env var.
- Dedupe on `recall_number`. Store the raw JSON untouched in `recalls.raw` for audit.
- Fixture set: 50 real 2025 enforcement records saved to `fixtures/recalls/*.json`, chosen for messy `code_info` values.
- Emits `recall.summoned { recallId }`.

### 6.2 Coroner

- **Regex pass.** Patterns for NDC (4-4-2, 5-3-2, 5-4-1 and 11-digit), lot tokens after `lot`, `lot#`, `lot no.`, `batch`, and dates (`exp`, `BUD`, `MM/YY`, `Month YYYY`).
- **LLM pass.** Amazon Bedrock, Claude model, temperature 0, system prompt from `.kiro/steering/coroner-prompt.md`. The prompt gives the raw text and the regex result and asks for JSON only.
- **Output schema** (zod): `{ ndcs: string[], lots: {value, expiry?, confidence, source}[], notes: string }`.
- **Reconcile.** Keep a lot only if it is found verbatim in the source (COR-3). Agreement between regex and LLM sets confidence to max(both, 0.9).
- Emits `recall.autopsied { recallId, needsReview }`.

### 6.3 Tracker

- **Synthetic world generator** (`packages/crypt-seed`): 3 manufacturers, 2 distributors, 8 pharmacies, 12 drug products, about 40,000 serialized packages, EPCIS 2.0 JSON-LD events (commissioning, packing, shipping, receiving). Uses OpenEPCIS test-data patterns; seeded RNG so every run is identical.
- **Storage.** DuckDB file `crypt.duckdb` with an `events` table and a flattened `serials` view.
- **NDC to GTIN-14.** Pad the 10-digit NDC to the 11-digit HIPAA form, prefix `03` plus indicator digit, compute the GS1 mod-10 check digit.
- **Trace query.** Join serials on GTIN and lot; walk events by timestamp to build the chain of custody.
- Emits `trace.found { recallId, pharmacies[], serials[] }`.

### 6.4 RxTerm 98 (the mock legacy system)

- Separate Express app with server-rendered HTML that looks like a green-on-black 80x24 terminal, keyboard-first, with F-key commands.
- Screens: LOGIN, MAIN MENU, F3 DISPENSE HISTORY (search by NDC), result pages of 15 rows with PgDn.
- Seeded with synthetic patients (S-0001 to S-2400) whose fills reference real serials from the crypt.
- Some pharmacies are "fax-only": their records exist only as PDFs in `fixtures/fax/`, rendered with a scan-noise effect.

### 6.5 Grave Robber (RPA)

- Playwright (Chromium) driven from the API server, one browser context per pharmacy.
- Page objects for each RxTerm screen; selectors live in `rpa/selectors.json` so a hook can regenerate them.
- Fax path: `pdf-parse` for text, with an OCR fallback (`tesseract.js`) for noisy pages.
- Every step emits `rpa.step { pharmacy, action, screenshot? }` streamed to the UI over Server-Sent Events (SSE).
- Writes `dispensing` ObjectEvents back into the crypt so legacy data joins the same trail.

### 6.6 Undertaker

- Quarantine list = affected serials whose last event is `receiving` at a pharmacy and with no `dispensing` event.
- Outreach drafts from the LLM using a fixed template (what happened, what to do, who to call); reading level checked with a Flesch-Kincaid function, regenerated if above grade 6.
- Shortage check: openFDA `/drug/shortages` by generic name.
- Stretch: NADAC cost of the cheapest same-ingredient substitute.

### 6.7 Scan

- `@zxing/browser` reading DataMatrix from `getUserMedia`.
- GS1 element-string parser for AIs 01, 21, 10, 17, with FNC1/GS separator handling.
- Printable test labels generated by `bwip-js` into `public/labels.pdf` for the demo.

### 6.8 Hearse

- Stops geocoded from the synthetic pharmacy table (real public addresses of anonymous landmarks, not real pharmacies).
- Route order by nearest-neighbour plus 2-opt over an OSRM `/table` matrix; geometry from OSRM `/route`.
- Weather from `api.weather.gov` `/points` then `/forecast/hourly`, plus `/alerts/active?point=`. A custom `User-Agent` header is required.
- Output GeoJSON for the map plus per-stop cold-chain flags (HRS-3).

### 6.9 dead-registry-mcp

MCP server (TypeScript SDK, stdio and HTTP) with tools:

| Tool | Input | Output |
| --- | --- | --- |
| `summon_recall` | recall number or text | recall id |
| `autopsy` | recall id | extracted lots with confidence |
| `trace_lot` | NDC, lot | chain of custody |
| `who_holds` | recall id | patients and shelves affected |
| `plan_hearse` | recall id | route summary |

Kiro itself calls this server during development, which you show in the video.

### 6.10 Soul Catcher: webcam scanning logic

The scanner reads the real 2D barcode on a package, extracts the real lot and expiry, looks up the real drug name, and saves it against the prescription, all in the browser plus one API call.

**Pipeline, one frame to one saved scan:**

1. **Camera.** `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 1280, height: 720 } })`. Works only on HTTPS or localhost (SOUL-12).
2. **Decode.** Use the browser's native `BarcodeDetector({ formats: ['data_matrix'] })` when available (Chrome, Edge, Android). Otherwise fall back to `@zxing/browser` `BrowserMultiFormatReader` with hints `POSSIBLE_FORMATS = [DATA_MATRIX]` and `TRY_HARDER = true`. Decode about 10 frames per second, cropped to the aiming frame.
3. **Debounce.** Accept only when 2 consecutive frames return the same string (SOUL-3). Play the scan chime and freeze the frame.
4. **Parse GS1.** Strip a leading `]d2` if present. Read Application Identifiers in order: `01` = 14 digits, `17` = 6 digits (YYMMDD), `10` = lot up to 20 characters, `21` = serial up to 20 characters. Variable fields end at the group separator `\u001d` or the end of the string. Also accept the printed form `(01)…(17)…(10)…(21)…` for typed input.
5. **Validate.** GS1 mod-10 check digit on the GTIN (SOUL-5). Expiry day `00` means the last day of that month.
6. **GTIN to NDC.** For US drugs the GTIN is `0` + `03` + 10-digit NDC + check digit, so the NDC is characters 4 to 13. The 10 digits alone don't say whether the NDC is 4-4-2, 5-3-2 or 5-4-1, so try all three hyphenations against openFDA `/drug/ndc.json?search=packaging.package_ndc:"…"` and keep the one that returns a product. This gives the real drug name, strength and labeler.
7. **Verdicts.** Compare with the prescription being filled (SOUL-7), active recalls (SOUL-8) and today's date (SOUL-9).
8. **Save and write back.** `POST /api/fills/:rx/scan`, then queue the RPA write-back (RPA-7).

**Parser sketch (packages/gs1):**

```ts
const GS = '\u001d';
const FIXED: Record<string, number> = { '01': 14, '17': 6 };
export function parseGs1(raw: string) {
  let s = raw.replace(/^\]d2/, '');
  const out: Record<string, string> = {};
  while (s.length) {
    const ai = s.slice(0, 2); s = s.slice(2);
    if (FIXED[ai]) { out[ai] = s.slice(0, FIXED[ai]); s = s.slice(FIXED[ai]); }
    else { const end = s.indexOf(GS); out[ai] = end < 0 ? s : s.slice(0, end); s = end < 0 ? '' : s.slice(end + 1); }
    if (s.startsWith(GS)) s = s.slice(1);
  }
  return { gtin: out['01'], expiry: out['17'], lot: out['10'], serial: out['21'] };
}
```

**Real barcodes for the demo.**

- **Printed labels for the real recall.** Generate GS1 DataMatrix labels with `bwip-js` using the real data of recall D-0526-2026: GTIN from NDC 0054-0282-59, lot `AC2040A`, expiry `260400`, plus synthetic serials. Print one cursed label with lot `AC2040A` and two clean labels with a synthetic lot `AC2105B`. Stick them on empty bottles.
- **One genuine package.** Also scan a real prescription drug carton (from your own medicine cabinet, empty) to prove the scanner reads real-world barcodes. Its drug name comes back live from openFDA. Note: over-the-counter products and the small bottles handed to patients usually do not carry the DSCSA DataMatrix; manufacturer prescription packages do.
- Print labels at 15 to 20 mm square on matte paper; glossy paper glares under webcams.

**RxTerm 98 additions.** A FILL QUEUE screen listing prescriptions waiting to be filled, and an F6 NOTES field on each prescription where the bot writes `LOT AC2040A EXP 2026-04 SN …`.

### 6.11 Lot inference for past fills

Past fills have no scan, so the tracker estimates which lot each one most likely came from.

1. Load receiving events for the recalled NDC at the pharmacy: lot, quantity, date.
2. Load fills from RxTerm 98 for the same NDC: rx\_number, quantity, date.
3. Walk fills in date order and consume stock first-in-first-out (oldest receipt first). A fill drawn entirely from one lot gets probability 1.0 for that lot.
4. When a fill could come from two lots on the shelf at once (the overlap window around a new delivery), split the probability by the quantity left of each lot.
5. Scanned fills override inference (INF-2) and are removed from the stock pool first.
6. Classify by INF-4 and store evidence for the UI (INF-6).

**Example with the real recall:** lot AC2040A arrives Nov 14 (synthetic date inside the real Sep 9, 2024 to Apr 4, 2025 distribution window), next lot arrives Mar 1. Fills Nov 14 to late Feb are likely, fills in the first days after Mar 1 are possible, later fills are unlikely.

## 7. Costume-grade frontend

The visual concept is **"The Apothecary of the Dead"**: a Victorian apothecary that doubles as a morgue, where every spooky object is a working control. Haunted on the surface, a precise pharmacy tool underneath.

### 7.1 Design principles

1. **Every costume piece has a job.** If removing a spooky element loses no information, remove it.
2. **Two voices.** Spooky labels for the theatre, plain-language tooltips and patient letters for the real work.
3. **One hero moment per screen.** The ectoplasm trail, the cracking mirror, the moving hearse.
4. **Dark, but readable.** WCAG AA contrast everywhere; colour never carries meaning alone.

### 7.2 Design tokens

| Token | Hex | Use |
| --- | --- | --- |
| `--crypt-ink` | #0B0A0F | Page background |
| `--crypt-slab` | #16131D | Cards, panels |
| `--crypt-stone` | #2A2533 | Borders, dividers |
| `--parchment` | #E8DCC2 | Primary text |
| `--parchment-dim` | #A99F8A | Secondary text |
| `--ectoplasm` | #8BE36B | Traced path, active state, links |
| `--candle` | #F2B544 | Warnings, stock level, focus ring |
| `--cursed` | #E0443E | Recalled lot, CURSED verdict |
| `--spirit` | #7FD8D0 | CLEAN verdict, safe states |
| `--bruise` | #7B5EA7 | AI-generated content marker |

Check every text and background pair in a contrast checker before coding; adjust lightness, not hue, if a pair fails AA.

**Typography.** `Cinzel Decorative` for screen titles only, `IM Fell English` for oracle narration and letters, `Inter` for UI text, `JetBrains Mono` for lots, NDCs and the terminal. All from Google Fonts with system fallbacks.

**Texture.** A subtle paper-grain SVG noise overlay at 4% opacity, a two-layer drifting fog (CSS transform, 40 s loop) on the landing page only, and a hand-inked 1 px border style for cards.

### 7.3 Spooky dictionary

The UI uses the spooky term; the tooltip and screen reader text use the plain term.

| Plain term | Spooky label | Visual |
| --- | --- | --- |
| Recall notice | Death notice | Black-bordered card with wax seal |
| Extract lots | Autopsy | Specimen jars |
| Confidence score | Embalming level | Fluid height in each jar |
| Supply-chain trace | Body trail | Glowing ectoplasm path |
| Dispense records | Exhumation | CRT terminal in a coffin frame |
| Affected patient | Haunted household | Lit window icon |
| Quarantine | Coffin | Drawer that slides shut |
| Stock on shelf | Candles | Candle height = units left |
| Approve outreach | Seal the letter | Wax-seal button |
| Verify package | Mirror | Webcam in an ornate frame |
| Pickup route | Hearse run | Animated hearse on map |
| Needs human review | Needs a living witness | Flickering candle badge |

### 7.4 Screens

**Screen 1: The Crypt Gate (landing).**

- Fog drifts over a row of tombstone cards, one per recent recall (drug name, class, date).
- Centre: "Summon a death notice" input (paste text or recall number) and a large "Enter as a judge" button that loads the demo recall.
- Hero moment: a bell tolls (if sound is on) and the chosen tombstone rises.

**Screen 2: The Autopsy Table.**

- Left: the raw recall text as yellowed parchment; extracted tokens light up in ectoplasm green as the extractor finds them.
- Right: one specimen jar per lot. Fluid height = confidence; jars below 0.8 flicker with a "needs a living witness" badge and a Confirm button.
- A purple quill icon marks every AI-generated field.

**Screen 3: The Body Trail (hero screen).**

- Horizontal four-lane graph: Manufacturer → Distributor → Pharmacy → Household, built with React Flow.
- Nodes: factory, warehouse, apothecary shopfront, house with a window. A haunted node pulses red.
- An ectoplasm particle travels each edge as the trace resolves, one edge per 300 ms.
- Right drawer, "Exhumation": a CRT-framed live view of the RPA bot driving RxTerm 98, with a log of steps that types out line by line.
- Bottom: the Oracle bar narrates in IM Fell English, for example "Lot B2041 sleeps in three houses on Alder Street."

**Screen 4: The Morgue.**

- One drawer per pharmacy. Opening it shows bottles still on the shelf; tapping "Coffin" slides the drawer shut and marks them quarantined.
- Candle row shows remaining units per pharmacy; candles gutter as stock is quarantined.
- Letters column: each patient draft as a folded envelope. Open to read, edit inline, then press the wax seal to approve. A sealed letter shows "ready, not sent".
- Shortage omen: a raven badge on drugs that appear on the FDA shortage list.

**Screen 5: The Mirror (scan).**

- Webcam feed inside an ornate oval mirror frame.
- CURSED: the mirror cracks (SVG crack lines draw in), the frame glows red, the patient trail appears below.
- CLEAN: mist clears from the glass and a spirit-teal check appears.
- Fallback: "Speak the code" text field for pasted barcode strings.

**Screen 6: The Hearse Run.**

- MapLibre map with a custom dark style (no labels except streets).
- Stops are lanterns; the hearse icon drives the route; a frost or heat omen appears on stops flagged by the weather check.
- Side card: stops in order, distance, time, and cold-chain warnings in plain language.

**Screen 7: The Soul Catcher (scan at fill).**

- Left: the prescription being filled, shown as a parchment ticket (Rx number, patient, drug, NDC) pulled from the RxTerm 98 fill queue.
- Centre: live webcam inside a brass lantern frame with a square aiming window; the lantern glows candle-amber while searching.
- On capture: the frame freezes, a ghostly hand "catches" the barcode, and a soul card flies out showing drug name (live from openFDA), lot, expiry and serial in JetBrains Mono.
- Verdict ribbon: CAPTURED (green, fill allowed), WRONG VESSEL (NDC mismatch), CURSED (lot recalled), DEPARTED (expired). Each verdict pairs colour, icon and word.
- Bottom strip: the RPA write-back running live in a mini CRT, ending in "Written to RxTerm 98, verified".
- Fallbacks visible but quiet: "Use USB scanner" and "Speak the code" (typed GS1 string).

### 7.5 Motion and sound

- Library: Framer Motion; all durations 150 to 600 ms except the fog loop.
- Every animation sits behind `prefers-reduced-motion: no-preference`; with reduced motion, state changes are instant and the fog is a still image.
- Sound is **off by default**, with a candle toggle in the header. Howler.js with CC0 clips: bell toll (summon), slow heartbeat (trace running), glass crack (cursed), soft chime (clean), hoof-and-wheel loop (hearse).
- Optional voice narrator (stretch S4) uses the Web Speech API for the Oracle bar.

### 7.6 Accessibility and responsiveness

- Keyboard path through all six screens; visible candle-amber focus ring.
- The Oracle bar is an `aria-live="polite"` region.
- CURSED and CLEAN always pair colour with an icon and the word.
- Layout breakpoints at 640 px and 1024 px; the Mirror and Morgue are fully usable on a phone.

### 7.7 Frontend stack

React 18 + Vite + TypeScript, Tailwind with the tokens above as CSS variables, Framer Motion, React Flow, MapLibre GL, Howler.js, `@zxing/browser`, TanStack Query, and SSE for live RPA and trace events.

## 8. Kiro usage plan

Kiro use must be visible, varied and honest: judges read the `.kiro/` folder and the write-up, so every feature below leaves a file or a log behind.

### 8.1 `.kiro/` layout

```
.kiro/
  steering/
    product.md            what we build, for whom, non-goals
    tech.md               stack, versions, monorepo rules
    pharmacy-safety.md    synthetic data only, never send, pharmacist approves
    gs1-standards.md      AIs 01/21/10/17, GTIN math, EPCIS bizSteps
    costume.md            tokens, spooky dictionary, motion and a11y rules
    coroner-prompt.md     the extraction prompt, versioned
  specs/
    summoner/  coroner/  tracker/  grave-robber/  undertaker-hearse/  costume-ui/
      requirements.md  design.md  tasks.md
  hooks/
    pbt-on-save.kiro.hook
    rpa-selectors.kiro.hook
    phi-guard.kiro.hook
    usage-log.kiro.hook
  settings/
    mcp.json
  agents/
    coroner.json  grave-robber.json  costume-designer.json
```

### 8.2 Specs

- Six specs, each from section 4 requirements, a design file from section 6 or 7, and a tasks file of 8 to 15 tasks.
- Run Kiro's requirements analysis on each spec and keep one example where it caught a contradiction (likely candidate: COR-4 review versus fully automatic Night Watch).
- Commit messages reference task IDs, for example `TRK-3: add orphan-serial check`.

### 8.3 Property-based tests (the showpiece)

Use `fast-check` with Kiro's correctness properties generated from requirements.

| Property | Requirement | Generator |
| --- | --- | --- |
| No invented lots: every output lot is a substring of the input | COR-3 | Random recall text with injected lot tokens and noise |
| Regex extraction is idempotent | COR-2 | Any string |
| NDC to GTIN to NDC round-trips | TRK-1 | All valid NDC formats |
| Every GTIN check digit is valid | TRK-1 | Random 13-digit bodies |
| No orphan serials in any trace | TRK-3 | Random synthetic worlds from the seed generator |
| GS1 element string parse then build round-trips | SCN-1 | Random AI combinations with FNC1 |
| Route starts and ends at depot, each stop once | HRS-2 | Random stop sets of 1 to 12 |
| Outreach letters never contain another patient's ID | UND-2 | Random patient batches |

Properties added for scanning and inference:

| Property | Requirement | Generator |
| --- | --- | --- |
| Build a GS1 string from random (GTIN, expiry, lot, serial), parse it back, get the same four values, in any AI order | SOUL-4 | Random AI order, lots with dashes and slashes, with and without `]d2` |
| Any single changed digit in a GTIN fails the check digit | SOUL-5 | Valid GTINs with one digit mutated |
| GTIN to NDC to GTIN round-trips for 4-4-2, 5-3-2 and 5-4-1 | SOUL-6 | All three NDC formats |
| The RPA note re-read always equals the scan that produced it | RPA-8 | Random lots and serials, including characters the terminal escapes |
| Quantity assigned to a lot never exceeds quantity received | INF-5 | Random receipts and fills |
| A scanned fill is always exact and never changes another fill's class to exact | INF-2 | Random mixes of scanned and unscanned fills |

Keep the first real counterexample PBT finds (for example a lot like `B-2041/A` broken by the slash) and write it up with the shrunk input. That paragraph is your strongest Technological Implementation evidence.

### 8.4 Hooks

| Hook | Trigger | Action |
| --- | --- | --- |
| `pbt-on-save` | Save in `packages/coroner/**` or `packages/gs1/**` | Run the property tests for that package |
| `rpa-selectors` | Save in `apps/rxterm98/views/**` | Ask the agent to update `rpa/selectors.json` and run the RPA smoke test |
| `phi-guard` | Before commit | Scan staged files for SSN and DOB-plus-name patterns; block on match |
| `usage-log` | Task completed | Append the task, files changed and Kiro feature used to `docs/KIRO_USAGE.md` |

### 8.5 MCP servers used in Kiro

- **Playwright MCP**: author and debug RxTerm 98 selectors interactively.
- **openFDA MCP** (open-source community server): explore recall records while writing the extractor.
- **AWS documentation MCP**: Bedrock and Lambda configuration.
- **dead-registry-mcp** (ours): Kiro queries live traces while building the UI. Screenshot this.
- **rxterm-mcp** (ours, stretch): exposes the RPA bot as a tool.

### 8.6 Custom agents

| Agent | Scope | Purpose |
| --- | --- | --- |
| Coroner | `packages/coroner`, steering coroner-prompt and gs1 | Prompt and extraction work, PBT-first |
| Grave Robber | `packages/grave-robber`, `apps/rxterm98` | RPA authoring with Playwright MCP |
| Costume Designer | `apps/web` | UI work bound to `costume.md` tokens and a11y rules |

### 8.7 Kiro surfaces

- **IDE**: specs, PBT and hooks (PBT runs in the IDE).
- **CLI**: seed generation and fixture refresh in scripts, `kiro` headless runs in CI.
- **Kiro Crew (stretch S1)**: the Night Watch bot, scheduled nightly, polls openFDA, re-runs traces and posts a recall digest to a Discord channel. Keep it in a small separate repo so it can be entered for Best Kiro Crew App. Watch credit use: cap it at one run per night.

### 8.8 `docs/KIRO_USAGE.md` outline

1. How specs shaped the six organs (with one before/after of a requirement)
2. The PBT counterexample story
3. Hooks that saved time, with numbers from the usage log
4. MCP: tools used and the two we built
5. Custom agents and steering: what changed in output quality
6. What did not work and what we changed

## 9. Repo, stack and deployment

One public GitHub monorepo, MIT licence, deployed to two always-on services and one static site on a personal AWS account.

### 9.1 Repository layout

```
body-snatcher-rx/
  .kiro/                     (never gitignored)
  apps/
    web/                     React + Vite frontend (the costume)
    api/                     Fastify API server, event bus, SSE
    rxterm98/                Express mock legacy pharmacy terminal
  packages/
    summoner/  coroner/  tracker/  grave-robber/
    undertaker/  hearse/  gs1/  crypt-seed/
    dead-registry-mcp/
  fixtures/
    recalls/   fax/   labels/
  docs/
    KIRO_USAGE.md  ARCHITECTURE.md  DEMO.md  SAFETY.md
  LICENSE  README.md
```

### 9.2 Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript 5, Node 20 LTS | One language end to end |
| Monorepo | pnpm workspaces + Turborepo | Fast builds, shared types |
| API | Fastify + zod | Typed routes, SSE support |
| Data | DuckDB (events), SQLite (app state) | Single-file, zero ops |
| AI | Amazon Bedrock, Claude model | Matches AWS hackathon sponsor |
| RPA | Playwright, pdf-parse, tesseract.js | Browser and fax paths |
| Barcode | @zxing/browser, bwip-js | Scan and print labels |
| Routing | OSRM (Docker, US-West extract) | Free, self-hosted |
| Weather | api.weather.gov | Free, no key |
| Tests | Vitest + fast-check, Playwright test | Unit, PBT, end to end |
| MCP | @modelcontextprotocol/sdk | Our two servers |

### 9.3 Deployment

- **Web**: static build on AWS Amplify Hosting or CloudFront + S3.
- **API + Playwright**: one container on AWS App Runner (2 vCPU, 4 GB) using the official Playwright base image.
- **RxTerm 98**: a second small App Runner service with its own URL, so the bot visibly navigates to a separate system.
- **OSRM**: container on the same App Runner or a t4g.small; fallback to the public OSRM demo server for light demo traffic.
- **Secrets**: openFDA key and Bedrock access via App Runner environment and IAM role; never in the repo.
- **Judge mode**: preloaded demo recall, warmed caches, and an "instant replay" switch that streams recorded RPA steps if the live bot is slow.
- **Budget guard**: AWS Budgets alert at $25 per month.

## 10. Demo video script (2:55)

The video is a four-act story with one physical moment; record screen at 1080p, voice-over recorded separately, sound effects on.

| Time | Act | On screen | Voice-over (approximate) |
| --- | --- | --- | --- |
| 0:00–0:12 | Cold open | Black screen, bell toll, Crypt Gate fog fades in | "When a drug is recalled, pharmacies know who got the drug. They don't know who got the bad batch." |
| 0:12–0:27 | The gap | Hands pour pills from a stock bottle; the old terminal saves the fill with no lot field filled | "The batch number is printed on every package. Nobody records it. In 2026, UCSF and the FDA couldn't ship recall alerts because of this." |
| 0:27–0:50 | Act 1: Soul Catcher (live webcam) | Rx ticket on screen; hold a real labelled bottle to the webcam; soul card shows drug name from openFDA, lot AC2105B, CAPTURED; mini CRT shows the bot typing the lot into RxTerm 98 | "One scan at fill. Real barcode, real drug name from the FDA, and our robot writes the lot back into the 1998 system. No vendor changes." |
| 0:50–1:10 | Act 2: Death notice | Real recall D-0526-2026 arrives; Autopsy Table lights up lot AC2040A | "Months later, the FDA recalls lot AC2040A of alendronate. A real recall from April 2026." |
| 1:10–1:45 | Act 3: Body Trail | Trail draws edge by edge; households light up: 2 exact (scanned), 9 likely, 3 possible, each with a small arrival-and-fill timeline | "Scanned fills are exact. For older fills, we infer from when each batch arrived. Fourteen people to call, not fifty." |
| 1:45–2:00 | Act 4: Cursed scan | Next fill: hold the AC2040A bottle to the webcam; lantern cracks red, CURSED, fill blocked | "And it can never be handed out again." |
| 2:00–2:15 | Morgue and hearse | Drawers slide shut, wax seal on a letter, hearse drives the route | "Bottles quarantined, letters approved by a pharmacist, pickup route planned." |
| 2:15–2:45 | Built with Kiro | Spec tree, GS1 parser property test shrinking a counterexample, hook firing, Kiro calling dead-registry-mcp, Night Watch digest | "Specs, property tests that caught real bugs, hooks, our own MCP servers, and a Kiro Crew bot watching every night." |
| 2:45–2:55 | Close | Title card, live URL, GitHub link | "Every cursed lot, found." |

**Recording tips.** Record each act separately and cut together. Use judge mode with instant replay so the bot never stalls on camera. Film both webcam scans live (Acts 1 and 4) with a lamp beside the camera and matte labels; do three takes and keep the best. Add captions; many judges watch muted.

## 11. Build plan (Nov 6 to Dec 4)

Four weekly phases, each ending in a gate you could demo if time ran out; UI design is frozen on Nov 22 and the MVP is locked on Nov 30.

&#91;embedded content: build roadmap · 4 phases, 4 gates\]

If a gate slips by more than one day, apply the cut list in section 13 before starting the next phase.

**Week 1: Bones**

- [ ] Nov 6: Register, request 4,000 credits, check DCLI IP policy, create repo with MIT licence, pnpm and Turborepo skeleton
- [ ] Nov 7: Write the 6 steering files; generate summoner and coroner specs in Kiro
- [ ] Nov 8: openFDA client with key and rate limit; save 50 messy 2025 recalls as fixtures
- [ ] Nov 9: Regex pass; PBT for COR-2 and COR-3; `pbt-on-save` hook
- [ ] Nov 10: Bedrock LLM pass, zod schema, reconcile logic; log the first PBT counterexample
- [ ] Nov 11: `crypt-seed` synthetic EPCIS world; attend the Devpost build session
- [ ] Nov 12: `gs1` package (NDC to GTIN, check digit, element strings) with PBT. **Gate: lots extracted from all 50 fixtures**

**Week 2: Organs**

- [ ] Nov 13: Tracker queries on DuckDB; orphan-serial PBT (TRK-3); lot-window inference with INF-5 property (INF-1 to INF-6)
- [ ] Nov 14: `dead-registry-mcp`; connect it in Kiro and screenshot Kiro using it
- [ ] Nov 15: RxTerm 98 screens (login, menu, F3 history, paging, FILL QUEUE, F6 notes)
- [ ] Nov 16: Seed RxTerm patients and fills; generate fax PDFs with scan noise
- [ ] Nov 17: Playwright bot built with Playwright MCP; `selectors.json`; `rpa-selectors` hook
- [ ] Nov 18: Fax parse path; write dispensing events back; SSE step stream
- [ ] Nov 19: Undertaker quarantine and outreach drafts; full CLI run. **Gate: notice to patients from the command line**

**Week 3: Skin**

- [ ] Nov 20: Tokens, fonts, layout shell, sound toggle; Crypt Gate screen
- [ ] Nov 21: Autopsy Table with specimen jars and confirm flow
- [ ] Nov 22: Body Trail with React Flow and Exhumation drawer. **Design freeze**
- [ ] Nov 23: Morgue drawers, candles, wax-seal letters
- [ ] Nov 24: Scanner core: camera, BarcodeDetector with zxing fallback, GS1 parser with PBT, GTIN to NDC with live openFDA lookup; print labels for the real recall and test with a real carton
- [ ] Nov 25: Soul Catcher screen, verdicts and RPA write-back (RPA-7 to RPA-9); Mirror reuses the scanner; Hearse with OSRM, NWS and MapLibre. **Cut-list checkpoint**
- [ ] Nov 26: Buffer (US Thanksgiving). **Gate: full flow in the browser**

**Week 4: Seance**

- [ ] Nov 27: Deploy web, API and RxTerm 98; judge mode and instant replay
- [ ] Nov 28: Motion, sound clips, reduced-motion mode, accessibility pass
- [ ] Nov 29: Night Watch Kiro Crew bot (stretch)
- [ ] Nov 30: Bug bash, phone testing, performance. **MVP lock**
- [ ] Dec 1: `KIRO_USAGE.md`, README, architecture and safety docs
- [ ] Dec 2: Record and edit the video; publish blog and social posts
- [ ] Dec 3: Submit on Devpost. **Gate: submitted**
- [ ] Dec 4: Buffer only, final deadline 2:00 PM PT

## 12. Submission checklist

Submit on Dec 3; Dec 4 before 2:00 PM PT is buffer only.

**Eligibility and accounts**

- [ ] Registered on kiroween.devpost.com
- [ ] 4,000 Kiro credits requested before Dec 1, 12:00 PM PT
- [ ] Personal laptop and personal AWS and GitHub accounts only; DCLI moonlighting and IP policy checked

**Repository**

- [ ] Public GitHub repo, MIT licence visible in the About section
- [ ] `.kiro/` at repo root and not in `.gitignore`
- [ ] README: pitch, GIF, live URL, judge-mode steps, architecture image, safety banner text, how to run locally
- [ ] `docs/KIRO_USAGE.md`, `docs/ARCHITECTURE.md`, `docs/SAFETY.md` complete
- [ ] No secrets in git history (run a secret scanner)

**Product**

- [ ] Live URL loads in a fresh incognito window in under 5 seconds
- [ ] Judge mode runs the full flow with no login
- [ ] Printable labels PDF linked from the Mirror screen
- [ ] Works in Chrome, Safari and on a phone for the Mirror

**Media**

- [ ] YouTube video public, under 3:00, captions on
- [ ] Devpost write-up: inspiration, what it does, how built, Kiro usage, challenges, what's next
- [ ] Screenshots of all six screens
- [ ] Blog post published (Bonus Blog)
- [ ] Social post with #KiroweenHackathon26 (Social Blitz)
- [ ] Night Watch repo submitted separately for Best Kiro Crew App (if built)

## 13. Risks, fallbacks and cut list

The biggest risk is scope, not technology: protect the six-stage hunt and cut stretch features first.

| Risk | Likelihood | Fallback |
| --- | --- | --- |
| LLM invents or misses lots | Medium | Regex-first, COR-3 property, human confirm under 0.8, curated fixture for the demo |
| RPA flaky on camera | Medium | You own RxTerm 98, so pin selectors; instant-replay mode streams a recorded run |
| openFDA down or rate-limited | Low | Cached fixtures, free API key |
| Webcam scan fails on stage | Medium | Matte labels 15 to 20 mm, a lamp beside the webcam, a $100 USB 2D scanner as backup, "Speak the code" paste field, pre-recorded take |
| Bedrock access delays | Low | Swap to the Anthropic API behind the same interface |
| Credits run out | Medium | Night Watch capped at one run per night; do bulk work in specs, not chat |
| Judges think it's a real clinical tool | Low | Persistent synthetic-data banner, SAFETY.md, never-send rule |
| Employer IP conflict | Low | Personal hardware and accounts, policy check on day 1 |
| Another pharmacy-recall entry appears | Low | Lean on the costume UI and PBT depth, which are hard to copy late |
| UI polish eats the schedule | High | Design tokens and components frozen by Nov 22; after that only polish the hero screens 3 and 5 |

**Cut list, in order (cut from the top when behind).**

1. S5 recall replay timeline
2. S4 voice narrator
3. S2 shortage and NADAC card (keep the shortage badge only)
4. S3 rxterm-mcp
5. Fax OCR path (keep text-based fax PDFs)
6. S1 Night Watch Crew bot
7. Weather check (keep the route)

Never cut: extraction with PBT, trace, RPA on RxTerm 98, Body Trail screen, Soul Catcher webcam scan with write-back, lot inference, judge mode.
