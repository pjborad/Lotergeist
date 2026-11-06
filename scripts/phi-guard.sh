#!/usr/bin/env bash
# SAFE-2: block commits that contain PHI-looking data (SSNs, DOB next to a label).
# Usage:  scripts/phi-guard.sh            scan staged files (git pre-commit)
#         scripts/phi-guard.sh --all      scan every tracked + untracked file
#         scripts/phi-guard.sh --hook     Kiro PreToolUse hook: reads the tool call JSON on stdin and
#                                         only scans when the command is a `git commit`
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [[ "${1:-}" == "--hook" ]]; then
  payload="$(cat)"
  if ! grep -Eq 'git[[:space:]]+commit' <<<"$payload"; then exit 0; fi
fi

if [[ "${1:-}" == "--all" ]]; then
  files="$(git ls-files --cached --others --exclude-standard)"
else
  files="$(git diff --cached --name-only --diff-filter=ACM)"
fi
[[ -z "$files" ]] && exit 0

SSN='(^|[^0-9-])[0-9]{3}-[0-9]{2}-[0-9]{4}([^0-9-]|$)'
DOB='(DOB|D\.O\.B\.|date of birth|birth ?date)[^0-9A-Za-z]{0,6}[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}'
hits=0
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  case "$f" in
    scripts/phi-guard.sh|pnpm-lock.yaml|*.png|*.pdf|*.zip|*.duckdb|*.sqlite) continue ;;
  esac
  if [[ "${1:-}" != "--all" ]]; then content="$(git show ":$f" 2>/dev/null || true)"; else content="$(cat "$f")"; fi
  if grep -Eiq -e "$SSN" -e "$DOB" <<<"$content"; then
    echo "phi-guard: $f looks like it contains PHI (SSN or labelled date of birth)." >&2
    grep -Ein -e "$SSN" -e "$DOB" <<<"$content" | head -3 | sed 's/^/    /' >&2
    hits=$((hits + 1))
  fi
done <<<"$files"

if (( hits > 0 )); then
  echo "phi-guard: blocked. This repo is synthetic-data only (see .kiro/steering/pharmacy-safety.md)." >&2
  exit 2
fi
