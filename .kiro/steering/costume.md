---
inclusion: fileMatch
fileMatchPattern: "apps/web/**"
---

# Costume: "The Apothecary of the Dead"

A Victorian apothecary that doubles as a morgue. Haunted on the surface, a precise pharmacy tool underneath. The source of truth is the uploaded design (four screens: I Death Notice, II Body Trail, III Scan, IV Hearse) and `apps/web/src/styles/app.css`.

## Rules
1. Every costume piece has a job. If removing a spooky element loses no information, remove it.
2. Two voices: spooky labels for theatre, plain-language text and tooltips for the real work. Patient letters are clinical-plain.
3. One hero moment per screen: ectoplasm-green lot, body trail arches, cracking mirror, moving hearse route.
4. Dark but readable. WCAG 2.2 AA contrast for all text. Colour never carries meaning alone: CURSED and CLEAN always pair colour with an icon and the word.

## Tokens (CSS variables in app.css)
| Token | Hex | Use |
| --- | --- | --- |
| `--bg` | #0b0d0b | page |
| `--panel` / `--panel2` | #111411 / #0f120f | cards |
| `--ink` | #ece6d6 | primary text |
| `--dim` / `--dimmer` | #a9a392 / #8f8a7b | secondary text |
| `--accent` | #b8f27c | traced path, active state, links |
| `--hot` / `--hot2` | #ff8a6e / #ff6b4a | recalled lot, CURSED |
| `--paper` | #e9e1cc | notice and toe tags |
| `--cold` | #7cc4ff | cold-chain stops |
| `--crt` | #57ff7a | RxTerm 98 |

Fonts: IM Fell English (display, narration), IM Fell English SC (titles), Inter (UI), JetBrains Mono (lots, NDCs), VT323 (terminal).

## Spooky dictionary
Recall notice = death notice. Extract lots = autopsy. Confidence = toe tag. Supply-chain trace = body trail. Dispense records = exhumation. Quarantine = coffin bins. Approve outreach = seal the letter. Verify package = mirror. Pickup route = hearse run. Needs human review = needs a living witness.

## Motion and sound
All animation sits behind `prefers-reduced-motion`; with reduced motion state changes are instant and sound stays off. Sound is off by default (candle toggle), synthesised with Web Audio. Keyboard path through all four screens with a visible accent focus ring. The verdict panel is `aria-live="polite"`. Layout breakpoints at 640 and 1024 px; Scan works on a phone.
