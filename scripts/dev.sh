#!/usr/bin/env bash
# Starts RxTerm 98 (4100), the API (4000) and the Vite dev server (5173). Ctrl-C stops all three.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f data/crypt.duckdb ]] || pnpm seed
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
pnpm --filter @bsrx/rxterm98 run start & pids+=($!)
pnpm --filter @bsrx/api run start & pids+=($!)
pnpm --filter @bsrx/web run dev & pids+=($!)
wait
