#!/usr/bin/env bash
# Pull 50 messy real 2025 openFDA enforcement records into fixtures/recalls/real-2025.json.
# Optional: OPENFDA_API_KEY for a higher rate limit.
set -euo pipefail
cd "$(dirname "$0")/../packages/summoner"
pnpm exec tsx scripts/refresh-fixtures.ts
