# Undertaker and Hearse: actions

## Requirements (EARS)
- **UND-1** THE system SHALL list every affected serial still on a shelf as a quarantine item.
- **UND-2** THE system SHALL draft one plain-language outreach message per affected patient at grade 6 reading level.
- **UND-3** THE system SHALL never send a message; a pharmacist SHALL approve each draft, and approval only marks it "ready".
- **UND-4** WHERE a recalled drug appears in openFDA `/drug/shortages`, THE system SHALL show a shortage-risk badge.
- **HRS-1** THE system SHALL plan a pickup route from the distributor depot through every pharmacy holding quarantined stock and back.
- **HRS-2** THE route SHALL start and end at the depot and visit each stop exactly once.
- **HRS-3** WHERE a drug requires refrigeration, THE system SHALL check NWS alerts and hourly forecasts along the route and flag any stop above 25 C or below 0 C.

## Properties (fast-check)
| Property | Requirement |
| --- | --- |
| A letter never contains another patient's ID and is grade 6 or lower | UND-2 |
| Route visits every stop once and starts and ends at the depot (1 to 12 stops) | HRS-2 |
| 2-opt is never longer than nearest neighbour | HRS-1 |
