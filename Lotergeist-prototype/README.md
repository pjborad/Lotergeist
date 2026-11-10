# Lotergeist — clickable prototype

Open `index.html` (or `Main.dc.html`) in Chrome, Edge, Firefox or Safari. No install or server needed.

## Screens
| File | Screen |
|------|--------|
| Main.dc.html | Sign in |
| Dashboard.dc.html | Today |
| Receive.dc.html | Receive & put away |
| Inventory.dc.html | Inventory by lot + audit trail |
| Dispense.dc.html | Fill & pickup with Rx Watcher and prescriber change |
| Patients.dc.html | Patient history, safety review, refills |
| Recall.dc.html | Recall: look up → impact → voicemail → done |
| Integrations.dc.html | REST / MCP / FHIR connections, scopes, security |

Use the **Light / Dark** switch at the bottom of the left menu. Buttons such as "Simulate scan" and "Simulate prescriber approval" step through each flow.

## How it runs
`support.js` is a small runtime: it reads each screen's template (`{{holes}}`, `<template data-sc-for>`, `<template data-sc-if>`) and its `Component` class, and re-renders on every state change. It is for demos only; build the real app in React per `plan.md` section 12.

Fonts load from Google Fonts when online; offline the screens fall back to system fonts.

All data is synthetic. Not for clinical use.
