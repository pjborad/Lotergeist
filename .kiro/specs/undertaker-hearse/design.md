# Undertaker and Hearse design

## Undertaker
- Quarantine = packages whose last event is `receiving` at a pharmacy. Bins `Q-1..Q-n` are one per pharmacy, ordered A, B, C ...
- Letters: fixed template, three wordings from formal to plain, first one with Flesch-Kincaid grade at or under 6 wins. An optional LLM rewrite is accepted only if it keeps both placeholders, has no patient ID and passes the grade check.
- Approve only sets `status = approved`. There is no send code in the repo.
- Shortage: openFDA `/drug/shortages` by generic name, with a fixture for the demo drugs (sole-source flag, substitute, synthetic NADAC prices).

## Hearse
- Order: nearest neighbour + 2-opt on haversine distance, depot to depot.
- Router: straight-line by default, `OsrmRouter` when `OSRM_URL` is set (falls back to straight on error).
- Weather: `fixtures/weather/heat-advisory.json` by default (`WEATHER_MODE=fixture`), real `api.weather.gov` hourly forecast and alerts with `WEATHER_MODE=nws` (custom User-Agent).
- Avoidance: if a leg crosses a hazard circle, add a waypoint on the shorter side, checked against all hazards.
- Cold chain: a stop is flagged if its temperature at ETA is above 25 C or below 0 C; refrigerated stock crossing a hazard raises a transit warning.
