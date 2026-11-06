# Demo script (about 3 minutes)

Run `pnpm install && pnpm seed && pnpm dev`, then open http://localhost:5173. Use Chrome; allow the camera only if you want the live scan.

| Time | Act | Do this |
| --- | --- | --- |
| 0:00 | Cold open | Landing page, fog and bell (turn the candle sound on first). "When a drug is recalled, pharmacies know who got the drug. They don't know who got the bad lot." |
| 0:20 | Death notice | Click **Enter as a judge**. Show the parchment notice with highlighted spans and the two toe tags. |
| 0:40 | Confirm | Click **Confirm & follow the trail**. |
| 0:50 | Exhumation | Body Trail: arches fill in, the CRT shows the bot typing into RxTerm 98, then the fax sheet. About 15 seconds. 17 dispenses appear. |
| 1:30 | Mirror | Scan page. Package A: the mirror cracks, CURSED, bin Q-1 and the trail. Package B: CLEAN. Optional: hold the printed label (`/labels/labels.pdf`) to the webcam. |
| 2:00 | Hearse | Hearse page. Flip **Avoid NWS heat advisory** and show the detour and the zero heat exposure. |
| 2:20 | Afterlife | Approve a letter ("ready, not sent"), show the quarantine bins and the shortage omen. |
| 2:40 | Built with Kiro | `.kiro/` folder, property-test run, `dead-registry-mcp` answering inside Kiro. |

## Fallbacks
- Slow bot: **Skip to a finished hunt** on page I runs two hunts instantly (replay if recorded).
- No camera: paste `(01)00370004417051(21)000214(10)PRORX050925-1(17)251104` into "Speak the code".
- Reset between takes: **Enter as a judge** again (calls `POST /api/demo/reset`).
- Offline: openFDA falls back to fixtures; weather uses the fixture advisory by default.

## Live webcam demo: the Soul Catcher (page V)

Print `/labels/labels-fill.pdf` (Letter, 100%, **matte** paper) and stick each 22 mm label on an empty bottle. Put a lamp beside the laptop and hold a bottle 15 to 20 cm from the webcam. Use Chrome on `http://localhost` (a camera needs localhost or HTTPS).

Before the take: page I, **Enter as a judge**, then confirm **D-0417-2026** and the real recall **D-0526-2026** (or press **Skip to a finished hunt**, which confirms both).

| Open Rx | Hold up | Expect | Why |
| --- | --- | --- | --- |
| 0099101 | `fill-methyl-clean` | CAPTURED, then "Written to RxTerm 98, verified" | clean lot; the bot types `LOT PRORX051125-2 EXP 2027-12 SN 000522` into F6 NOTES |
| 0099102 | `fill-methyl-cursed` | CURSED, recall D-0417-2026, fill blocked | lot is in an active recall |
| 0099104 | `fill-alendronate-cursed` | CURSED, recall D-0526-2026, drug named live by openFDA | real Hikma recall, lot AC2040A |
| 0099104 | `fill-alendronate-clean` | CAPTURED + written back | same real drug, other lot (AC2105B) |
| 0099105 | `fill-ondansetron-wrong` | WRONG VESSEL | NDC does not match the prescription |
| 0099105 | `fill-methyl-expired` | DEPARTED | expiry in the past |

Real carton: hold an empty prescription carton from a manufacturer (not an OTC box or a pharmacy vial; those rarely carry the DataMatrix). The drug name comes back live from openFDA. If its NDC is not the one on the open Rx you will get WRONG VESSEL, which still proves the read.

No webcam or poor light: use **Use USB scanner** (a keyboard-wedge 2D scanner types into the focused box) or paste a code into **Speak the code**.

Rehearse without a camera: `pnpm e2e:fill` drives the real UI with a fake webcam that shows each label and asserts all six verdicts and both write-backs.
