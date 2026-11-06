#!/usr/bin/env bash
# Starts Lotergeist: API on 4000 and web app on 5173. Ctrl-C stops both.
set -e
cd "$(dirname "$0")/.."
pnpm --filter @bsrx/lg-api run dev &
API=$!
pnpm --filter @bsrx/lg-web run dev &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' EXIT INT TERM
wait
