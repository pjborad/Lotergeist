# Lotergeist (live demo)

A pharmacy lot ledger: receive and put away stock by scanning, track every package by lot and serial, record the lot on each fill, and turn an FDA recall into held stock and a patient notification list.

Run it: `pnpm install`, `pnpm lg:fax` (once, makes the demo fax image), then `pnpm dev` and open http://localhost:5173. Sign in with a demo account (all share the password `moonlight-rx-2026`): `j.rivera@elmstreetrx.example` (pharmacist), `k.patel@…` (technician), `m.diaz@…` (cashier).

- Scanning: webcam GS1 DataMatrix (BarcodeDetector, zxing fallback), USB scanner or typing. "Print test labels" shows real DataMatrix codes for the demo stock.
- OCR: tesseract.js runs in the browser from `apps/lg-web/public/ocr` (run `pnpm --filter @bsrx/lg-web run ocr:assets` once to download it). Used for labels without a barcode and for the recall fax.
- Data: SQLite (`data/lotergeist.sqlite`), synthetic only. The pharmacist can reset it via `POST /api/demo/reset`.
- Tests: `pnpm test` (API incl. property test of ledger invariants), `pnpm e2e:lg` (fake webcam + OCR in Chromium, needs the stack running).

Not real, on purpose: SMS and email go to a sandbox outbox, SSO is a demo stand-in, there is no second factor, the fridge temperature is simulated. Not verified: a physical webcam, OCR accuracy on curved labels. The Body Snatcher Rx code (`apps/api`, `apps/web`, `packages/*`) is kept as legacy; `pnpm dev:legacy` starts it.

---

# Body Snatcher Rx

> Somewhere out there, a cursed lot is still walking.

Body Snatcher Rx turns a vague FDA drug recall into an exact list of affected patients, shelf bottles and a pickup route. Kiroween 2026 entry (Frankenstein category).

**Synthetic data only. Not for clinical use. Not HIPAA-compliant. A pharmacist approves every message and nothing is ever sent.** See [docs/SAFETY.md](docs/SAFETY.md).

## The gap
A pharmacy knows who received a drug, but the lot number is lost between the supply chain (which tracks lots) and the dispensing system (which tracks patients). So pharmacies warn everyone or no one. This app stitches six systems that were never meant to talk:

1. **openFDA** recall notices (free text)
2. **Coroner**: regex plus optional LLM lift NDC, lots and expiry, never inventing a lot
3. **GS1 EPCIS 2.0** chain of custody (DuckDB, ~40,000 synthetic packages)
4. **Grave Robber**: a Playwright bot reads a 1998 pharmacy terminal (RxTerm 98) and a fax inbox
5. **GS1 DataMatrix** scan in the browser: cursed or clean
6. **Hearse**: pickup route with NWS weather and cold-chain checks

**New: the Soul Catcher (page V).** Most pharmacy systems never record the lot at fill time, yet the lot is printed in the DataMatrix on every prescription package. Hold a package to the webcam while filling: the app reads the real code, names the drug from openFDA, **flags it against every active recall by lot number** (CURSED, fill blocked), catches wrong or expired packages, and for good scans the bot types `LOT ... EXP ... SN ...` into the 1998 terminal and checks it landed.

## Run it
Needs Node 22.5+ (built on 26) and pnpm.

```bash
pnpm install
cd packages/grave-robber && pnpm exec playwright install chromium && cd ../..
pnpm seed        # synthetic crypt + fax PDFs (about a second)
pnpm dev         # RxTerm 98 :4100, API :4000, web :5173
```

Open http://localhost:5173 and click **Enter as a judge**. Full script: [docs/DEMO.md](docs/DEMO.md).

One-box mode (the API serves the built web app): `pnpm build:web`, start RxTerm 98 (`pnpm dev:rxterm`) and the API (`pnpm dev:api`), then open http://localhost:4000.

Optional: copy `.env.example` to `.env`. With no LLM configured the Coroner runs regex-only (a tested mode). Set `LLM_PROVIDER=bedrock` or `anthropic` to enable the LLM pass.

## Judge mode
- **Enter as a judge** resets the demo and opens the first death notice. No login.
- **Skip to a finished hunt** runs two hunts end to end so Scan and Hearse have data.
- Test labels for the webcam: `/labels/labels.pdf` (Mirror) and `/labels/labels-fill.pdf` (Soul Catcher, one per verdict). No webcam? Paste the code into "Speak the code" or use a USB scanner.
- Live webcam script: [docs/DEMO.md](docs/DEMO.md#live-webcam-demo-the-soul-catcher-page-v). Rehearse with a fake camera: `pnpm e2e:fill`.

## Tests
```bash
pnpm test        # property tests, API end to end, Playwright bot against RxTerm 98
pnpm e2e:fill    # with the stack running: UI + fake webcam + all six fill verdicts
pnpm typecheck
```

## Layout
```
apps/web        React + Vite, four screens from the design
apps/api        Fastify API, event bus, SSE, SQLite state
apps/rxterm98   Express mock of a 1998 pharmacy terminal
packages/       gs1, summoner, coroner, crypt-seed, tracker, grave-robber, undertaker, hearse, dead-registry-mcp
fixtures/       recalls (3 synthetic + 50 real 2025), fax PDFs, weather, shortages
.kiro/          steering, specs, hooks, agents, MCP config
docs/           ARCHITECTURE, SAFETY, DEMO, KIRO_USAGE
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the diagram, events and API. [docs/KIRO_USAGE.md](docs/KIRO_USAGE.md) says how Kiro was used, including what failed.

## Limits
Serials on past fills are inferred (the terminal and fax print none); lots scanned at fill are exact. Lot inference for past fills (INF-1 to INF-6) is not built. The webcam path is proven with a fake camera and generated labels, not yet with a physical webcam. No fax OCR. Straight-line routes unless `OSRM_URL` is set. The LLM pass has only been run with test doubles. Not deployed.

MIT licensed.
