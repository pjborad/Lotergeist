# Lotergeist — Full Solution Plan

> Pharmacy operations platform that tracks every package by lot and serial from the delivery dock to the patient, catches prescription problems with an AI checker, and turns a recall into a list of affected stock and patients in minutes.
>
> Version 1.0 · Nov 2026 · Author: Pritesh Borad
> Status: hackathon build (Kiroween 2026, Costume Contest) → pilot-ready architecture.
> **Synthetic data only until a pilot signs a BAA.** Nothing here is legal or regulatory advice; verify with counsel and a practicing pharmacist.

---

## Contents

1. Problem and goals
2. Users, roles and permissions
3. End-to-end flows (the eight screens)
4. System architecture
5. Data model
6. AI agents: what each one does and how it is controlled
7. Integrations
8. Public API, MCP server and FHIR
9. Patient outreach: voicemail, text, email
10. Security and privacy
11. Compliance map
12. Tech stack and repository layout
13. Testing strategy
14. Observability and operations
15. Kiro build plan
16. Roadmap and milestones
17. Risks and open questions
18. Glossary

---

## 1. Problem and goals

**The gap.** Pharmacy systems count stock by product, not by lot. At fill, the barcode scan confirms the drug code (NDC) but usually does not save the lot. When a recall arrives, nobody can say quickly which shelves, trays or patients have the bad lot. A 2026 UCSF/FDA study (JMIRx Med 2026;7:e68345) could not trace prescriptions to dispensed lot numbers. Recall alerting and "did this site receive it" already exist (Inmar OneRecall, TraceLink Targeted Recalls); **lot-to-patient tracing and outreach do not**.

**Goals**

| # | Goal | Measure |
|---|------|---------|
| G1 | Capture lot, expiry and serial at receiving | ≥ 99% of packages |
| G2 | Link every fill to the exact package and patient | ≥ 99% of fills |
| G3 | Recall number → affected stock and patients | < 60 seconds |
| G4 | Pharmacist-approved patient outreach | 100% of messages approved by a pharmacist |
| G5 | Catch prescription problems before fill | Every new order reviewed by Rx Watcher |
| G6 | Safe sharing with hospitals and AI agents | Scoped, logged, no PHI without a BAA |

**Non-goals:** replacing the pharmacy management system (PMS), claims adjudication, e-prescribing as a prescriber tool, RFID hardware, building an EHR.

---

## 2. Users, roles and permissions

| Role | Main screens | Can do | Cannot do |
|------|--------------|--------|-----------|
| Technician (CPhT) | Receiving, Inventory, Fill | Scan and check in, put away, move stock, scan at fill, print labels | Approve fills, send recall outreach, approve prescriber changes, see full clinical profile |
| Pharmacist (PharmD) | All | Everything a technician can, plus verify fills, accept or reject Rx Watcher findings, send prescriber change requests, run recalls, approve outreach, witness controlled-drug counts | Change integrations or security settings (unless also Admin) |
| Cashier | Pickup step | Confirm ID, record counseling offer and signature, complete sale | Any clinical view, inventory edits |
| Admin | Integrations, users | Create partner and agent accounts, set scopes, rotate keys, export audit logs | Bypass pharmacist approval on clinical actions |
| Partner system (API) | — | Only the scopes granted | Anything outside its scopes |
| AI agent (MCP) | — | Only the tools granted to that agent's account | Patient data unless `patient.read` + BAA + admin approval |

**Rules**
- Role-based access control (RBAC) with per-store assignment; a user may hold several roles.
- "Break-glass" access to a patient profile requires a reason and is flagged in the audit log.
- Every profile view, scan, edit, approval, message and API call is written to the audit log.

---

## 3. End-to-end flows

The clickable prototype in this zip shows each flow. Open `index.html`.

### 3.1 Sign in (`Main.dc.html`)
Store picker → work email + password or badge/SSO → second factor on new workstations → optional 12-hour trusted workstation. Five failed attempts lock the account for 15 minutes.

### 3.2 Today (`Dashboard.dc.html`)
Recall banner when an open recall matches lots this store received; KPIs (deliveries due, fills, lot-capture rate, fridge temperature); "Up next" work queue (recall, Rx Watcher flags, deliveries, verification, expiring stock, refill sync); expiring-lots chart; live lot activity feed.

### 3.3 Receive & put away (`Receive.dc.html`)
1. Scan GS1 DataMatrix → GTIN (01), lot (10), expiry (17), serial (21) → NDC.
2. Automatic checks: invoice line match, DSCSA transaction information (TI/TS), minimum expiry, not on an active recall, cold-chain log for refrigerated items.
3. Put-away suggestion with reason and zone (Shelf, Cold chain, Controlled).
4. Confirm → package saved with location; invoice line ticks off. "Report a problem" quarantines the package.
5. Controlled substances: witness required, perpetual count updated.

### 3.4 Inventory by lot (`Inventory.dc.html`)
One row per lot; filters (recalled, expiring, refrigerated, controlled); lot detail with **history and audit trail** — who did each step, when, on which device.

### 3.5 Fill & pickup (`Dispense.dc.html`)
1. **Review** — Rx Watcher checks the new order (section 6.1). Pharmacist chooses: approve as written, reject, or **ask prescriber to change**.
2. **Prescriber channel** — change request sent as NCPDP SCRIPT `RxChangeRequest` plus a secure message; order on hold; prescriber approves → `RxChangeResponse` → new order (e.g. Rx 0072210-R1) replaces the original.
3. **Scan** — NDC must match; lot, serial, expiry saved on the fill; recalled or expired lots block.
4. **Label → Verify → Pickup** — pharmacist final check; ID, counseling, signature; sale record saved with patient, package and contact.

### 3.6 Patients (`Patients.dc.html`)
Search by name, DOB, phone or Rx #; profile with allergies and contact preference; tabs for **Safety review** (past vs current medicines), **Medication history** (lot per fill) and **Upcoming refills** (with refill-sync suggestion). Every profile view is logged with reason.

### 3.7 Recall (`Recall.dc.html`)
1. **Look up** — enter recall number or upload the fax.
2. **Review impact** — lots read from the notice; units on shelves (auto-quarantined); patients who received the lots; how each can be reached.
3. **Call patients** — pharmacist voicemail (section 9), optional opt-in text/email; pharmacist attestation required.
4. **Done** — call outcomes, callbacks, call list, quarantined stock; next steps (return pickup, manufacturer response, audit PDF).

### 3.8 Integrations (`Integrations.dc.html`)
Connected partners; connect via REST, MCP or FHIR; scope switches; security posture; API activity log.

---

## 4. System architecture

```
                         ┌──────────────────────────────────────────────┐
  Browser (web app)  ──▶ │  API Gateway (WAF, rate limit, mTLS option)  │ ◀── Partner systems (REST / FHIR)
  Scanners / phones      └───────────────┬──────────────────────────────┘ ◀── AI agents (MCP)
                                         │
             ┌───────────────────────────┼────────────────────────────────────┐
             │                    Core services (Node.js / TypeScript)         │
             │  auth · users · inventory · receiving · dispensing · patients   │
             │  recall · outreach · integrations · audit                       │
             └──────┬──────────────┬───────────────┬──────────────┬───────────┘
                    │              │               │              │
             ┌──────▼─────┐ ┌──────▼──────┐ ┌──────▼──────┐ ┌─────▼────────┐
             │ PostgreSQL │ │ Event bus   │ │ Agent       │ │ Object store │
             │ (RLS per   │ │ (SQS/SNS or │ │ runtime     │ │ (faxes, PDFs,│
             │  store)    │ │  EventBridge)│ │ (LLM calls) │ │  recordings) │
             └────────────┘ └──────┬──────┘ └──────┬──────┘ └──────────────┘
                                   │               │
                    ┌──────────────▼───────────────▼───────────────┐
                    │ Connectors: openFDA · wholesaler EDI · SCRIPT │
                    │ (Surescripts) · PMS · EHR FHIR · voice/SMS/   │
                    │ email · fax OCR · NWS/OSRM (optional)         │
                    └──────────────────────────────────────────────┘
```

**Principles**
- **Package ledger is the source of truth.** Every scan appends an immutable event (EPCIS-style: `receiving`, `storing`, `dispensing`, `quarantining`, `returning`). Current state is a projection of events.
- **Event-driven.** Services publish domain events (`PackageReceived`, `FillScanned`, `RecallMatched`, `OutreachSent`); agents and connectors subscribe.
- **Multi-tenant by store**, enforced in the database with Postgres row-level security (RLS), not only in code.
- **Human-in-the-loop** for every clinical or patient-facing action.
- **PHI minimization**: services and agents receive the least data they need.

---

## 5. Data model

| Entity | Key fields | Notes |
|--------|-----------|-------|
| Organization / Store | id, name, NCPDP id, DEA #, timezone | Tenant boundary |
| User | id, name, email, roles[], store_ids[], mfa | SSO subject id |
| Product | NDC-11, GTIN-14, name, strength, form, pack, storage (room/cold/C-II) | From NDC directory |
| Lot | lot_no, ndc, expiry, manufacturer, status | `active · quarantined · recalled · returned` |
| Package | serial, lot_id, gtin, location_id, status, cost | Unit of truth |
| Location | id, zone (shelf/fridge/safe/quarantine/RTV), aisle, bay, shelf, bin | Printable station barcode |
| Delivery | id, wholesaler, invoice_lines[], ti_ts_doc, status | EDI 856 / 810 |
| PackageEvent | id, package_id, type, actor_id, device_id, at, before, after, signature | Append-only, hash-chained |
| Patient | id, name, dob, phone, email, preferred_channel, consents, allergies | PHI, encrypted fields |
| Prescription | rx_no, patient_id, prescriber_id, ndc, qty, sig, days_supply, refills, version | Versioned (R1, R2…) |
| PrescriberMessage | id, rx_no, type (RxChange/secure msg), body, status, timestamps | SCRIPT message ids kept |
| AgentFinding | id, agent, rx_no, rule, severity, text, evidence, decision, decided_by | Every AI output stored |
| Dispense | id, rx_no, package_serials[], filled_by, verified_by, sold_at, register | Links patient ↔ package |
| Recall | fda_no, class, level, reason, firm, raw_code_info | From openFDA |
| RecallLot | recall_id, lot_no, confidence, source (regex/LLM/manual), confirmed_by | |
| Outreach | id, recall_id, patient_id, channel, script_version, status, attempts[] | Voicemail/text/email |
| Integration | id, partner, type (REST/MCP/FHIR/EDI/SCRIPT), scopes[], keys, ip_allowlist | |
| AuditEvent | id, actor (user/partner/agent), action, resource, reason, at, ip, result | Append-only, 6-year retention |

**Integrity rules (enforced and property-tested)**
- On-hand per lot = received − dispensed − returned ± adjustments, never negative.
- A serial is dispensed at most once.
- Every dispensed serial has a receiving event.
- Prescription versions are immutable; changes create a new version.

---

## 6. AI agents

All agents follow the same contract:

- **Advisory only.** Agents suggest; a named human decides. No agent can send a patient message, change an order, or move stock on its own.
- **Grounded.** Agents work from structured data and cite the rule or source behind each finding.
- **Bounded tools.** Each agent has an allow-list of tools and read scopes. No free-form database or internet access.
- **Logged.** Inputs (hashed or redacted), outputs, model version, prompt version, latency and the human decision are stored in `AgentFinding`.
- **Fail safe.** If an agent errors or times out, the workflow continues with a "not checked" banner; it never blocks safety-critical work silently or approves anything by default.
- **Prompt-injection hardening.** Free text from faxes, recall notices, prescriber notes and partner systems is passed as quoted data, never as instructions. Tool calls requested from untrusted text are refused.

### 6.1 Rx Watcher — prescription review
**Trigger:** `PrescriptionReceived` or `PrescriptionChanged`.

**Pipeline**
1. **Deterministic rules first** (no AI): NDC exists; quantity ÷ daily dose vs days supply; duplicate therapy; allergy class match; drug–drug interaction lookup from a licensed database (e.g. First Databank or Medi-Span); dose vs this patient's history; label frequency (e.g. once-daily basal insulin); controlled-substance checks (early refill, MME).
2. **LLM layer (optional, explanatory):** summarizes rule hits in plain language, spots free-text oddities in the sig ("bedtime and morning" vs label), and drafts the prescriber message. The LLM never invents a rule hit; it can only explain or add a "possible issue" flagged as lower confidence.
3. **Output:** list of findings with severity (`pass · monitor · needs review · block`), evidence and a suggested change.
4. **Pharmacist decision:** approve as written (reason required if any "needs review"), reject, or ask prescriber to change.

**Prescriber change loop:** pharmacist edits the draft → sent as `RxChangeRequest` (NCPDP SCRIPT via Surescripts) + secure message → order on hold → `RxChangeResponse` approved/denied → new Rx version enters the queue → Rx Watcher re-runs.

**Guardrails:** clinical content reviewed by a pharmacist advisory group; rule sets versioned; every override stored for quality review.

### 6.2 Coroner — recall lot extractor
**Trigger:** recall number entered, fax uploaded, or Night Watch finds a new openFDA record.
1. Regex pre-pass for lot patterns, expiry dates, NDCs.
2. LLM extraction into a strict JSON schema `{ndc[], lots[{lot, expiry, confidence}]}`.
3. Reconcile: any lot not found verbatim in the source text is dropped (property-tested "never invent a lot").
4. Lots below 0.95 confidence or without expiry need pharmacist confirmation.
5. Match against the ledger → stock to quarantine, patients affected.

### 6.3 Night Watch — recall monitor
Scheduled job (every 2 hours) polls openFDA `/drug/enforcement` by report date; runs Coroner; if any lot matches this store's ledger, raises the Today banner and a work item. Never contacts patients.

### 6.4 Outreach agent — calls and messages
Builds the per-patient call list, merges the approved script, places calls through the voice provider within the calling window, records outcomes, retries per policy, routes callbacks to the pharmacy line with the recall shown, and moves unreachable patients to the pharmacist call list. Only runs after pharmacist attestation.

### 6.5 Refill & safety assistant (Patients screen)
Computes due dates from days supply; suggests refill sync; compares past and current medicines (steroid courses, interacting drugs, late refills). Same advisory contract as Rx Watcher.

### 6.6 Model and data handling
- LLM provider under a BAA (e.g. Anthropic Claude on AWS Bedrock in a HIPAA-eligible account).
- Send the minimum: Rx Watcher gets drug, sig, quantity, allergy classes, active-med list and age band — not name, address or phone.
- No training on customer data; zero-retention settings where offered.
- Prompts and rule sets in version control; changes go through review and an evaluation suite (section 13).

---

## 7. Integrations

Rule: **build an integration only when a paying customer's workflow breaks without it.** Every feature works with file import/export first.

| Integration | Purpose | Phase | Method |
|-------------|---------|-------|--------|
| openFDA | Recalls, shortages, NDC directory | 1 | REST, free API key, cached |
| Wholesalers (McKesson, Cardinal, Cencora, regional) | Invoices, shipments, DSCSA TI/TS | 1 | EDI 856/810 files or portal export; EPCIS where offered |
| Voice / SMS / email | Patient outreach | 1 | Provider under BAA (e.g. Twilio, Amazon Connect/Pinpoint) |
| Fax inbox + OCR | Recall faxes | 1 | eFax provider → OCR (e.g. Textract) → Coroner |
| Surescripts (NCPDP SCRIPT) | RxChange, prescriber messages | 2 | Certified SCRIPT 2017071+ via an intermediary or partner PMS |
| Pharmacy management systems (PioneerRx, EnterpriseRx, others) | Read fills/patients; write lot back | 2 | Vendor APIs or partner programs; CSV fallback |
| EHRs: Meditech, Epic, Oracle Health | Hospital edition: patients, administrations | 3 | FHIR R4 (SMART Backend Services), HL7 v2 |
| BD Pyxis (dispensing cabinets) | Hospital cabinet inventory | Later | Read-only report export → partner API |
| Tray & Kit add-on | Hospital/surgery-center trays | 2 | Same ledger; station barcodes |

**Connector design**
- Each connector is a separate worker with its own credentials and scopes.
- Inbound data is validated against a schema, normalized, and written as ledger events.
- Idempotency keys on every inbound message; dead-letter queue for failures; replay tooling.

---

## 8. Public API, MCP server and FHIR

### 8.1 REST API (`/v1`)
Auth: OAuth 2.0 client credentials (partner systems) or OAuth 2.0 + PKCE (user apps); optional mTLS. JSON, versioned, rate-limited per client.

| Method | Path | Scope | Returns |
|--------|------|-------|---------|
| GET | `/v1/availability?ndc=&qty=` | `availability.check` | in_stock, on_hand, earliest_expiry, storage, recall_status |
| GET | `/v1/inventory?ndc=` | `inventory.read` | stock by product (no lot/patient detail) |
| GET | `/v1/recalls/{fda_no}/status` | `recall.read` | whether this store holds recalled lots |
| POST | `/v1/rx/{rx_no}/change-requests` | `rx.change` | prescriber change request (normally via SCRIPT) |
| GET | `/v1/patients/{id}/medications` | `patient.read` | medication history (BAA + admin approval) |
| Internal | `/v1/receipts`, `/v1/packages`, `/v1/dispenses`, `/v1/recalls`, `/v1/outreach` | user roles | app endpoints |

### 8.2 MCP server (`/mcp`) for AI agents
- **Identity:** each agent is its own service account; OAuth 2.1 with PKCE; tokens expire in 1 hour; refresh tokens bound to the client.
- **Tools (default allow-list):** `check_availability(ndc, qty)`, `get_recall_status(ndc, lot)`, `list_recalled_lots(since)`.
- **Never exposed by default:** patient lookup, dispensing, inventory edits, outreach.
- **Controls:** per-tool scopes, per-agent rate limits, argument validation, output size limits, PHI filter on outputs, full call log (tool, args hash, result, latency).
- **Prompt-injection posture:** tool outputs are data; no tool returns free text that instructs the caller; descriptions are static and reviewed.

### 8.3 FHIR R4 (`/fhir/r4`)
Read-only: `Medication` (with `batch.lotNumber`, `batch.expirationDate`), `MedicationDispense`, `Patient` (BAA only). SMART Backend Services (signed JWT). US Core profiles where applicable.

### 8.4 Webhooks (outbound)
`recall.matched`, `rx.change.responded`, `delivery.checked_in`, `outreach.completed` — signed with HMAC-SHA256, retried with backoff, delivery logged.

---

## 9. Patient outreach

**Default channel: pharmacist voicemail** (patients ignore or distrust unexpected texts and emails).

- One automated call per patient from the pharmacy's own verified number (STIR/SHAKEN attested).
- Message recorded in the pharmacist's own voice, or clear text-to-speech. **No voice cloning.**
- **Privacy:** the message never says the drug name or condition; it asks the patient to call back. Merge fields: `{first_name}`, `{sold_date}`, pharmacy phone.
- If answered live: plays the message, then "press 1 to talk to the pharmacist" (warm transfer).
- If no answer: leave voicemail; if no mailbox, retry once next day; then move to the pharmacist call list.
- Calling window 9 AM–8 PM in the patient's time zone; honors do-not-call and opt-outs.
- Text and email are optional follow-ups, only for patients with recorded opt-in consent; SMS includes STOP.
- Callbacks ring the pharmacy; caller ID lookup shows the open recall on screen.
- Every attempt, outcome and callback is logged against the recall for the manufacturer's effectiveness check.

**Compliance note:** automated and prerecorded calls are regulated under the TCPA; the FCC treats ringless voicemail as a call. Healthcare-related messages have exemptions with conditions. Confirm with counsel before going live.

---

## 10. Security and privacy

### 10.1 Identity and access
- SSO (SAML/OIDC) for organizations; email + password with MFA otherwise; WebAuthn/passkeys and badge tap supported.
- MFA required for pharmacists and admins; step-up MFA for break-glass, exports and key creation.
- Session timeout 15 minutes idle on shared workstations; 12-hour trusted device option.
- RBAC + store scoping; Postgres RLS ensures one store cannot read another's rows.

### 10.2 Data protection
- TLS 1.2+ everywhere (1.3 preferred); HSTS.
- Encryption at rest (AES-256, AWS KMS); field-level encryption for PHI (name, DOB, phone, email, address).
- Keys rotated every 90 days; per-tenant data keys.
- Backups encrypted, tested monthly; point-in-time recovery 35 days.
- Data residency: US regions only.

### 10.3 Audit
- Append-only `AuditEvent` and `PackageEvent` tables; each record hash-chained to the previous one (tamper-evident); daily anchor hash stored separately.
- Logged: who, what, when, where (IP/device), why (reason for PHI access), result.
- Retention: 6 years (DSCSA transaction records and HIPAA documentation).
- Exportable to the customer's SIEM.

### 10.4 Partner and agent security
- One account and key set per partner and per AI agent; least-privilege scopes; IP allowlists; optional mTLS.
- `patient.read` requires a signed BAA, admin approval and a documented purpose.
- Anomaly alerts: unusual volume, off-hours access, scope denials.

### 10.5 AI-specific controls
- PHI minimization in prompts; redaction of identifiers in logs.
- Prompt-injection defenses: untrusted text quoted and labeled; tool calls only from the system plan, never from document text; output schema validation.
- Model and prompt versioning with an evaluation gate before release.
- Human approval for all clinical and patient-facing actions.

### 10.6 Application security
- OWASP ASVS Level 2 target; SAST, dependency scanning, secret scanning in CI.
- Content Security Policy, input validation, parameterized queries, CSRF protection.
- Annual penetration test; bug-bounty after pilot.
- Pre-commit PHI-pattern scanner (blocks real-looking phone numbers, SSNs and emails outside `example` domains in fixtures).

### 10.7 Infrastructure
- AWS HIPAA-eligible services under an AWS BAA; separate accounts for dev/stage/prod.
- Private subnets, no public database endpoints; WAF on the API gateway.
- Infrastructure as code (CDK/Terraform); least-privilege IAM; CloudTrail and GuardDuty on.

### 10.8 Certifications path
HIPAA risk assessment → SOC 2 Type I (pilot) → SOC 2 Type II (12 months) → HITRUST if hospital customers require it.

---

## 11. Compliance map

| Area | Requirement | How Lotergeist supports it |
|------|-------------|----------------------------|
| DSCSA | Trade with authorized partners; keep TI/TS 6 years; quarantine and investigate suspect product; package-level tracing (small dispensers exempt until Nov 27, 2027 per FDA) | TI/TS stored at receiving; serial-level ledger; quarantine workflow; EPCIS-ready events |
| HIPAA | Privacy, Security and Breach rules; BAAs; minimum necessary | Section 10; BAAs with every vendor touching PHI; access logging |
| TCPA | Consent and rules for automated calls/texts | Calling windows, opt-outs, consent records, counsel review |
| DEA | Controlled-substance records, CSOS, biennial inventory | Witnessed receipts, perpetual counts per lot, C-II reports |
| State boards | Recordkeeping, technician ratios, transfer rules | Configurable per state |
| FDA recalls | Recall response and effectiveness checks | Outreach log and manufacturer response report |
| USP <795>/<797> | Compounding records (out of scope v1) | Future add-on |

---

## 12. Tech stack and repository layout

**Stack**
- Frontend: React + TypeScript, Vite, the design tokens from this prototype (light/dark), Playwright tests.
- Backend: Node.js 22 + TypeScript (Fastify), PostgreSQL 16 with RLS, Redis for queues/cache, AWS (Lambda or ECS Fargate, SQS/EventBridge, S3, KMS, Cognito or an OIDC provider).
- Scanning: keyboard-wedge USB/Bluetooth scanners + browser camera (zxing-js); GS1 parser library with check-digit validation.
- AI: Claude via AWS Bedrock (BAA), structured outputs, evaluation harness.
- Voice/SMS/email: provider under BAA.
- IaC: AWS CDK. CI/CD: GitHub Actions.

```
lotergeist/
├─ .kiro/                     # specs, steering, hooks (see section 15)
├─ apps/
│  ├─ web/                    # React app (screens from this prototype)
│  └─ api/                    # Fastify API + MCP server + FHIR facade
├─ services/
│  ├─ ledger/                 # package events, projections
│  ├─ receiving/  dispensing/  patients/  recall/  outreach/  integrations/  audit/
│  └─ agents/                 # rx-watcher, coroner, night-watch, outreach, refill
├─ connectors/                # openfda, wholesaler-edi, surescripts, pms, fhir, voice, fax
├─ packages/
│  ├─ gs1/                    # GTIN/NDC/DataMatrix parsing + PBT
│  ├─ design-tokens/          # light/dark CSS variables
│  └─ schemas/                # zod/JSON schemas shared by API and agents
├─ infra/                     # CDK stacks
└─ fixtures/                  # synthetic recalls, patients, deliveries
```

---

## 13. Testing strategy

- **Property-based tests (fast-check):**
  - GTIN check digit always valid; NDC ↔ GTIN round-trips.
  - Extracted lots always appear verbatim in the source text.
  - On-hand never negative; a serial is dispensed at most once; every dispensed serial has a receipt.
  - Recall impact = distinct patients on dispenses of the recalled lots.
  - RLS: a query as store A never returns store B rows.
- **Agent evaluations:** labeled set of ~300 synthetic prescriptions with known issues (frequency, days supply, interactions, allergies); targets: recall of known issues ≥ 95%, false-positive rate tracked; Coroner on 100+ real openFDA `code_info` strings (public data).
- **Contract tests** for every connector (recorded fixtures).
- **End-to-end (Playwright):** the eight flows in this prototype.
- **Security tests:** auth bypass, IDOR, scope escalation on API/MCP, prompt-injection corpus against Coroner and Rx Watcher.
- **Accessibility:** axe checks in CI; WCAG 2.2 AA.

---

## 14. Observability and operations

- Structured logs (no PHI), traces (OpenTelemetry), metrics (scan latency, recall match time, agent latency and error rate, outreach success).
- SLOs: API availability 99.9%; recall match < 60 s p95; scan-to-save < 300 ms p95.
- Alerts: failed connector syncs, agent error spikes, fridge temperature out of range, unusual PHI access.
- Runbooks: recall surge, voice provider outage (fallback: pharmacist call list), openFDA outage (cached data + manual entry).
- Incident response and breach notification plan per HIPAA (notify within 60 days; faster per contract).

---

## 15. Kiro build plan

**Specs (requirements → design → tasks), one per module:** auth-and-roles, ledger, receiving-putaway, lot-inventory, fill-and-sale, rx-watcher, prescriber-channel, patients, recall-lookup-extract, recall-impact, outreach-voicemail, integrations-api-mcp-fhir, audit, ui-shell-design-system.

**Steering files**
- `pharmacy-safety.md` — synthetic data only; pharmacist approves every clinical and patient-facing action; agents advisory.
- `gs1-standards.md` — AIs 01/10/17/21; NDC↔GTIN rules.
- `security.md` — PHI minimization, RLS, audit, prompt-injection rules.
- `design-system.md` — tokens and components from this prototype.
- `tone.md` — clear clinical copy for patients; light Halloween touches only in the UI.

**Hooks**
- On save of recall fixtures → run Coroner property tests.
- On schema change → regenerate API types and MCP tool schemas.
- Pre-commit → PHI-pattern scanner; fail if `.kiro/` is git-ignored.
- On agent prompt change → run the evaluation suite.

**MCP:** openFDA MCP server; project `lotergeist-mcp` exposing ledger and recall queries for development.

---

## 16. Roadmap and milestones

| Phase | When | Scope | Exit criteria |
|-------|------|-------|---------------|
| Hackathon | by Dec 4, 2026 | This prototype wired to a real ledger, openFDA, Coroner, Rx Watcher rules, voicemail in sandbox | 3-minute demo end to end on synthetic data |
| Phase 1 — Retail pilot | +3 months | Receiving, inventory, fill lot capture, recall + voicemail, audit, wholesaler files | 3–5 pharmacies; lot capture ≥ 99%; recall match < 60 s |
| Phase 2 — Clinical + hospital | +6 months | Rx Watcher with licensed drug database, SCRIPT RxChange, Patients, Tray & Kit add-on | 1 surgery center, 1 dialysis clinic, 1 small hospital; measured restock time |
| Phase 3 — Connect | +9–12 months | PMS connectors, FHIR (Meditech first), MCP partner program, SOC 2 Type II | 2 integrations live with paying customers |

---

## 17. Risks and open questions

| Risk | Mitigation |
|------|-----------|
| Pharmacies won't scan twice (PMS + Lotergeist) | Integrate with PMS scan step; or capture lot in the PMS and sync |
| PMS vendors add lot-to-patient themselves | Partner with them; sell recall outreach as a service |
| AI gives a wrong clinical finding | Rules first, LLM explains only; pharmacist decides; evaluation gate |
| TCPA exposure on automated calls | Counsel review, consent records, calling windows, opt-outs |
| Vials without 2D lot barcodes | Print a 2D label at intake (universal label tool) |
| Hospital security reviews slow sales | SOC 2, HIPAA documentation pack, BAA template ready |

**Open questions**
- [ ] Barcode input for demo: phone camera, webcam or USB scanner?
- [ ] Voice/SMS provider and personal account for the hackathon.
- [ ] Which drug-interaction database for Phase 2 (licensing cost)?
- [ ] Partner PMS for the first integration.
- [ ] Interview 5–10 pharmacists to validate Rx Watcher rules and the voicemail script.

---

## 18. Glossary

- **NDC** — National Drug Code (product identifier). **GTIN** — Global Trade Item Number on the 2D barcode.
- **Lot** — manufacturing batch. **Serial** — unique package number.
- **DSCSA** — Drug Supply Chain Security Act. **TI/TS** — transaction information / statement.
- **EPCIS** — GS1 standard for supply-chain event data.
- **NCPDP SCRIPT / RxChange** — e-prescribing standard / message to request a prescription change.
- **FHIR** — HL7 health-data API standard. **MCP** — Model Context Protocol for AI agents.
- **BAA** — HIPAA business associate agreement. **RLS** — row-level security. **PMS** — pharmacy management system.
- **TCPA** — Telephone Consumer Protection Act.
