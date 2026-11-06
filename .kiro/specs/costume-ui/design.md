# Costume UI design

Follows the uploaded design for the four screens. See `.kiro/steering/costume.md` for tokens and rules.

- **I Death Notice**: tabs for recalls, summon box, parchment notice with highlighted spans, Coroner toe tags with confidence bars, "needs a living witness" confirm per tag, five-incisions strip.
- **II Body Trail**: five arch cards (commissioning, shipping, receiving, dispensing, still on shelf), CRT terminal showing the bot's live screen text, fax sheet, filterable dispense table.
- **III Scan**: real GS1 DataMatrix labels (bwip-js) or webcam (`@zxing/browser`), verdict panel with AI table and trail, paste fallback. Printable test labels at `/labels/labels.pdf`.
- **IV Hearse**: SVG route map in the design's 800x520 canvas, manifest, heat toggle, quarantine bins, letter approval, shortage omen.
- State: TanStack Query, SSE for live events, hash router. Sound is Web Audio and off by default.
- Safety: persistent synthetic-data banner; judge mode through "Enter as a judge" or "Skip to a finished hunt".
