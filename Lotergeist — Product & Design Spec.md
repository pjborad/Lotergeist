# Lotergeist — Product & Design Spec

Nov 5, 2026 · @Pritesh Borad

## Overview

Lotergeist is a web portal that records the lot number of every package from the moment it arrives at a pharmacy until it leaves with a patient. When a recall comes in, it names the affected stock and patients in minutes and sends the outreach.

**The gap.** Pharmacy systems count stock by product, not by lot. At fill, the barcode scan only confirms the drug code (NDC); the lot is not saved. A UCSF/FDA study (JMIRx Med, Jan 2026) found it "not possible to trace a medication prescription from the EHR to specific lot numbers dispensed." Small pharmacies are exempt from electronic package-level tracing until Nov 27, 2027, so the gap stays open.

**Goals**

- Capture lot, expiry and serial for 100% of packages at receiving, with a put-away location.
- Link every fill to the exact package (lot + serial), prescription and patient.
- Turn a recall number into a quarantine list and a patient list in under 60 seconds.
- Send pharmacist-approved SMS and email to affected patients, with a call list for the rest.

**Non-goals:** replacing the pharmacy management system, billing and insurance claims, prescriber e-prescribing, real patient data (the demo is synthetic only).

**Hackathon fit.** Submitted to Kiroween 2026 in the **Costume Contest** category: a polished, professional portal whose haunted touches (moonlit sign-in, crescent-moon mark, a recall screen that glows red) support the job rather than decorate it. Design canvas: [Lotergeist screens](https://claude.ai/code/artifact/70ac076d-1644-40a5-888f-4011eb053ec3).

## Users and roles

Three roles share one portal; only a pharmacist can approve fills or send recall messages.

| Role | Main screens | Can do | Cannot do |
| --- | --- | --- | --- |
| Technician (CPhT) | Receive, Inventory, Fill | Scan and check in deliveries, put away, move or adjust stock, scan packages at fill, print labels | Approve fills, start or send recall notices, witness own controlled-drug count |
| Pharmacist in charge (PharmD) | All | Everything a technician can, plus verify fills, witness C-II counts, run recalls, approve and send patient messages, export audit reports | — |
| Cashier / register | Fill & pickup (pickup step) | Confirm ID, record counseling offer and signature, complete sale | See full patient profile, edit inventory |

Sign-in uses email + password or badge/SSO, a second factor on new workstations, a 12-hour trusted-workstation option, and a store picker for multi-store users. Every action is written to an audit log with user, time, workstation and store.

## End-to-end flow

Every scan from delivery to sale writes one shared lot ledger, so a recall becomes a lookup instead of a search.

&#91;embedded content: end-to-end flow · daily and recall\]

1. **Delivery arrives.** Totes and an electronic invoice come from the wholesaler.
2. **Scan and check.** Each package's 2D barcode gives lot, expiry and serial; the system checks the invoice, supplier tracing record, expiry and active recalls.
3. **Put away.** The system names the spot: shelf bin, fridge or C-II safe. The package is now on the ledger with its location.
4. **Fill and verify.** The technician scans the package at fill; the lot and serial are saved on the prescription. A pharmacist approves.
5. **Sell.** At pickup the sale records the patient, time, register and contact details.
6. **Recall notice.** A fax or alert arrives; staff enter the FDA recall number.
7. **Find lots.** openFDA returns the recall; regex + AI read the lot numbers with confidence scores.
8. **Match the ledger.** Lots on the shelf are quarantined; patients who bought them are listed with their contact channels.
9. **Pharmacist approves** the SMS and email drafts and the call list.
10. **Notify and close.** Messages go out, delivery status is tracked, stock goes back to the reverse distributor, and an audit report is saved.

## Screens

Six screens share a left menu (Today, Receiving, Inventory, Fill & pickup, Recalls) and a top bar with a global "scan or search" field. Badges on the menu show open deliveries and open recalls.

### 1. Sign in

Split layout: a moonlit brand panel with three value lines on the left, the form on the right.

- [ ] Fields: pharmacy (store picker), work email, password with show/hide, "trust this workstation for 12 hours".
- [ ] Second option: badge tap or SSO.
- [ ] Wrong password shows an inline error under the field; 5 failures lock the account for 15 minutes.
- [ ] Success lands on Today.

### 2. Today

The shift's home page: what needs doing now, in priority order.

- [ ] Recall banner (red) appears when any open recall matches lots this store received; it shows lots received, units on hand and patients affected, and opens the Recall screen.
- [ ] Four summary cards: deliveries to check in, prescriptions filled (and waiting for pickup), lot-capture rate, fridge temperature.
- [ ] Work queue: up to 5 tasks, each opening its screen.
- [ ] Expiring-lots chart by month for the next 5 months; current month highlighted.
- [ ] Lot activity feed: time, event (Received, Filled, Sold, Quarantined, Returned), product, lot, user.

### 3. Receive & put away

One package at a time: scan, check, put away, next.

- [ ] Header shows the delivery number, wholesaler and a progress bar (checked in / expected).
- [ ] Scanning a GS1 DataMatrix fills GTIN (01), lot (10), expiry (17) and serial (21), and derives the NDC.
- [ ] Four automatic checks, each shown with a tick or a problem: matches an invoice line, transaction information (DSCSA TI/TS) verified, expiry beyond the store's minimum, lot not on an active recall.
- [ ] A put-away location is suggested with its reason and a zone tag: Shelf, Cold chain (fridge, 15-minute put-away), or Controlled (C-II safe, witness required, perpetual count updated).
- [ ] "Confirm put-away & scan next" saves the package and moves on; "Report a problem" logs short, damaged, wrong item or suspect product and quarantines it.
- [ ] The invoice panel ticks off lines; the delivery closes when all lines are received or explained.

### 4. Inventory by lot

One row per lot, not per product.

- [ ] Columns: product + NDC, lot, expiry, on hand, location, status (Available, Expiring soon, Recalled · held, Reorder).
- [ ] Filters with counts: All, Recalled, Expiring ≤ 60 days, Refrigerated, Controlled; search by drug, NDC, lot or location.
- [ ] Selecting a row opens lot detail: received / dispensed / on hand, and a history timeline (received, shelved, dispensed, quarantined).
- [ ] Actions: move location, adjust count (reason required, pharmacist sign-off for controlled drugs).

### 5. Fill & pickup

Where the package is tied to the patient.

- [ ] Left: prescription queue with status (To fill, To verify, Ready, Sold).
- [ ] Patient card: name, date of birth, patient ID, phone and preferred channel, email, allergies.
- [ ] Prescription card: drug, directions, prescriber, refills.
- [ ] Four steps with a progress bar: Scan → Label → Verify → Pickup.
- [ ] Scan: NDC must match the prescription or the step blocks; lot, serial and expiry are saved on the fill; a recalled or expired lot blocks the fill.
- [ ] Verify: pharmacist checklist and Approve / Send back.
- [ ] Pickup: ID verified, counseling offered, signature; "Complete sale" writes the sale record (patient, Rx, lot, serial, time, register, contact on file).

### 6. Recall (four steps)

From a fax to sent messages in one guided flow, with a step bar at the top.

1. **Look up.** Enter the FDA recall number (or upload the fax). The system pulls the record from openFDA and extracts the lot numbers from its free-text code\_info field.
2. **Review impact.** Recall card (class, level, reason, firm, date) and each lot with what this store received. Three numbers: units still on the shelf (auto-quarantined), patients affected, how they can be reached. Patient table: name, ID, Rx, lot, date sold, channels (Text, Email, Call only); first 6 shown, "Show all".
3. **Notify patients.** Editable SMS (1 segment, merge fields {first\_name}, {sold\_date}) with a live preview, and an editable email (subject + body, merge fields {drug\_name}, {rx\_number}). The send button stays disabled until the pharmacist ticks the attestation. Call-only patients go to the pharmacist's call list.
4. **Done.** Delivery results per channel, the call list, quarantined units, and next steps: schedule return pickup, send the response to the manufacturer, download the audit report.

Acceptance: for the demo recall D-0417-2026, the flow shows 2 lots, 197 units quarantined, 17 patients (13 text, 11 email, 2 call only) and sends 24 messages.

## Data model

The package (one serial of one lot) is the unit everything links to; a recall is answered by joining recall lots → packages → dispenses → patients.

| Entity | Key fields | Links to |
| --- | --- | --- |
| Store | id, name, NCPDP id, address | users, locations |
| User | id, name, role, email, store ids | audit events |
| Product | NDC (11-digit), GTIN-14, name, strength, form, pack size, storage (room / cold / C-II) | lots |
| Lot | lot number, NDC, expiry, manufacturer, status (active, quarantined, recalled, returned) | packages, recall lots |
| Package | serial, lot, GTIN, expiry, location, status (on shelf, dispensed, quarantined, returned, destroyed) | lot, receipt, dispense |
| Location | id, zone (shelf / fridge / safe / quarantine / RTV), aisle, bay, shelf, bin | packages |
| Delivery | id, wholesaler, invoice lines, TI/TS document, received by, status | packages |
| Prescription | Rx number, patient, prescriber, drug NDC, quantity, directions, refills | dispenses |
| Dispense | id, Rx, package serial(s), filled by, verified by, sold at, register, signature | patient, packages |
| Patient | id, name, date of birth, phone, email, preferred channel, consent to SMS/email, allergies | prescriptions |
| Recall | FDA recall number, class, level, reason, firm, initiation date, raw code\_info | recall lots |
| Recall lot | recall, lot number, confidence, source (regex / LLM / manual), confirmed by | lot |
| Notification | recall, patient, channel, template version, merged text, status (queued, sent, delivered, failed), timestamps | patient, recall |
| Audit event | who, what, when, workstation, before/after values | any entity |

Primary IDs never change; lots and serials are stored exactly as printed. Patient contact consent is checked at send time, not at recall time.

## Integrations and APIs

All external data in the demo is public or synthetic; real pharmacy, wholesaler and payer systems are mocked.

| Integration | Used for | Demo approach | Notes |
| --- | --- | --- | --- |
| openFDA /drug/enforcement | Recall lookup by recall number; nightly poll for new recalls | Live API with free key; cached fixtures as fallback | 240 req/min, 120,000/day with key; code\_info is free text |
| Lot extractor (regex + LLM) | Read lot numbers and expiry out of code\_info and fax text | Regex first, LLM second, results reconciled with a confidence score | Must never return a lot that is not in the source text |
| GS1 DataMatrix scanner | Decode GTIN, lot, expiry, serial at receiving and fill | Browser camera or USB scanner; zxing-js | Check-digit validated on every GTIN |
| EPCIS 2.0 / DSCSA TI-TS | Verify the package came from an authorized partner | OpenEPCIS generated events for the mock wholesaler | Small-dispenser electronic tracing deadline: Nov 27, 2027 |
| Wholesaler invoice (EDI 856-style) | Expected lines for check-in | Synthetic JSON | — |
| Fax inbox + OCR | Read recall faxes | Sample PDF faxes, OCR to text, then the extractor | Optional; recall number entry is the main path |
| SMS gateway | Patient texts | Sandbox provider; numbers in 555-01xx range | Opt-out keyword STOP honored |
| Email service | Patient emails | Sandbox provider; example.com addresses | — |
| openFDA /drug/shortages | Flag a recall that may cause a shortage | Live API | Stretch goal |

Internal API (REST, JSON): `POST /receipts/{id}/scan`, `POST /packages/{serial}/putaway`, `GET /lots?filter=`, `POST /dispenses`, `POST /dispenses/{id}/verify`, `POST /dispenses/{id}/sell`, `POST /recalls/lookup`, `GET /recalls/{id}/impact`, `POST /recalls/{id}/notifications`, `GET /recalls/{id}/report`.

## Design system

A calm "midnight" interface: dark navy surfaces, one violet accent, and color used only for meaning. Haunted details stay at the edges so the work areas read like clinical software.

| Token | Value | Use |
| --- | --- | --- |
| Background | #0B0E14 | Page |
| Sidebar | #0E121A | Left menu |
| Surface | #121722 / #0F141E | Cards / inset panels |
| Border | #1E2533 / #2A3344 | Dividers / inputs, secondary buttons |
| Text | #E6EAF2 / #9AA4B5 / #8892A6 | Primary / secondary / small labels |
| Accent (violet) | #A78BFA, light #C4B5FD | Primary buttons (dark text on violet), current step, links |
| Recall (red) | #F87171, light #FECACA | Recall banner, recall lots, send button |
| Success (green) | #34D399 | Checks passed, sold, delivered |
| Warning (amber) | #FBBF24 | Expiring soon, call-only patients |
| Cold chain (blue) | #38BDF8 | Refrigerated items |
| Controlled (orange) | #FB923C | C-II items, deliveries due |

**Type:** Inter for everything; JetBrains Mono for NDC, GTIN, lot, serial and Rx numbers. Sizes 12 / 13 / 14 / 15 body, 16 card titles, 22–24 page titles, 28–32 numbers.

**Shape and spacing:** 10 px radius on inputs and buttons, 14–16 px on cards, pill chips for status. 8 px spacing grid; 20–24 px gaps between cards.

**Components:** sidebar nav with count badges, top bar with scan/search, summary card, status pill, step bar, scan result card, put-away card, data table, filter chips, timeline, message editor with preview, success panel.

**Haunted touches (Costume Contest):** crescent-moon-with-cross logo; moonlit sky, stars and drifting fog on sign-in; a gently pulsing red recall banner; a red-to-violet glow behind the recall header; a scanning laser on the barcode reader. All motion stops under reduced-motion settings.

**Accessibility:** text contrast at least 4.5:1; status never shown by color alone (always a word); touch targets 44 px or larger; real buttons, links and labeled inputs; tables scroll sideways on phones; the sidebar stacks above content at phone width.

## Compliance and safety guardrails

The demo uses synthetic data only, and a pharmacist stays in control of every patient-facing action.

- **Synthetic data.** No real patients, prescriptions, pharmacies or wholesalers. Every screen carries a "synthetic data · not for clinical use" line. A pre-commit check blocks real-looking phone numbers, SSNs and emails outside example.com.
- **Human approval.** No message is sent without a pharmacist's attestation. Extracted lots below 0.95 confidence, or with no expiry, need pharmacist confirmation before matching.
- **Never invent a lot.** The extractor may only return strings that appear in the source text; this is enforced by property tests.
- **Patient messages** use plain, non-alarming language, name no diagnosis, and include the pharmacy phone number and a STOP opt-out for SMS. Contact consent is checked at send time.
- **Controlled drugs.** C-II receipts and count changes need a second staff member as witness; perpetual counts are kept per lot.
- **Audit.** Every scan, edit, approval and message is logged with who, when and where; the recall audit report exports to PDF.
- **Access.** Role-based permissions, second factor on new workstations, session timeout, HIPAA-style access logging.
- **Records.** Transaction information kept 6 years, in line with DSCSA.
- **Employer IP.** Built on a personal machine and account, with no DCLI code, data, branding or prompts.

The FDA small-dispenser exemption date (Nov 27, 2027) was seen only in vendor summaries of FDA's Aug 6, 2026 letter; check FDA's own page before quoting it on stage.

## Kiro build plan

Build in Kiro with one spec per module, enforced by hooks and property tests, and submit by Dec 4, 2026, 2:00 PM PT.

**Specs (one per module, each with requirements, design, tasks):** auth-and-roles, receiving-putaway, lot-inventory, fill-and-sale, recall-lookup-extract, recall-impact, patient-notify, ui-shell.

**Steering files:** `pharmacy-safety.md` (synthetic data only; pharmacist approves every message; never auto-contact patients), `gs1-standards.md` (AI 01/10/17/21, NDC↔GTIN rules), `design-system.md` (the tokens above), `tone.md` (haunted UI copy, plain patient copy).

**Hooks:** on save of recall fixtures → rerun extractor tests; on schema change → regenerate API types; pre-commit PHI-pattern scan; build fails if `.kiro/` is git-ignored.

**Property-based tests:**

- Every extracted lot appears verbatim in the source text.
- Every GTIN check digit is valid; NDC → GTIN → NDC round-trips.
- On-hand per lot = received − dispensed − returned − adjusted, never negative.
- Every dispensed serial has a receiving event; no serial is dispensed twice.
- Recall impact: patients found = distinct patients on dispenses of the recalled lots.

**MCP and agents:** openFDA MCP server; a small `lotergeist-mcp` exposing lot and recall queries; agents "Coroner" (reviews extractions) and "Night Watch" (polls openFDA nightly and posts new matches to the Today banner).

**Milestones**

1. Nov 6–8: repo, `.kiro/` steering and specs, design tokens, app shell and sign-in.
2. Nov 9–14: data model, seed data, receiving + put-away with scanner.
3. Nov 15–19: lot inventory, fill & pickup with lot capture.
4. Nov 20–25: recall lookup, extractor, impact, notifications (sandbox SMS/email).
5. Nov 26–30: Today dashboard, audit report, Night Watch, polish and accessibility pass.
6. Dec 1–3: deploy, record the 3-minute video, write-up; Dec 4 morning: submit.

**3-minute demo script:** sign in (0:00) → Today shows the recall banner (0:15) → receive three packages: shelf, fridge, safe (0:30) → fill and sell to Daniel Brooks, lot captured (1:05) → a recall fax arrives: enter D-0417-2026, see 197 units and 17 patients (1:40) → approve and send 24 messages (2:20) → Kiro specs, hooks and tests (2:40) → "Every lot accounted for." (2:55).

## Open questions and risks

- [ ] Does the portal sit beside an existing pharmacy system (sync Rx and patients) or stand alone for the demo?
- [ ] Barcode input for the live demo: phone camera, webcam or a USB scanner?
- [ ] Which SMS and email sandbox providers, and on whose personal account?
- [ ] Light theme as well as dark, for bright pharmacy counters?
- [ ] How much "haunt" do judges want: keep it subtle, or add a stronger theme toggle?
- [ ] Partial packs: when one bottle is split across several fills, record the lot on each fill (assumed yes).

| Risk | Fallback |
| --- | --- |
| LLM mis-reads a lot | Regex pass, confidence threshold, pharmacist confirmation, fixture recalls for the demo |
| openFDA down or rate-limited on demo day | Cached recall fixtures and a free API key |
| Camera scan fails live | Typed GS1 string and a recorded backup clip |
| Scope too large for 4 weeks | Cut shortage flag, Night Watch and audit PDF first; core is receive → fill → recall → notify |
