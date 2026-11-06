#!/usr/bin/env bash
# Kiro PostTaskExec hook: append the finished task and the files it changed to docs/KIRO_USAGE.md.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 0
payload="$(cat 2>/dev/null || true)"
task="$(printf '%s' "$payload" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(d.get("taskTitle") or d.get("task") or d.get("name") or "task")
except Exception:
    print("task")' 2>/dev/null || echo task)"
files="$(git status --porcelain | awk '{print $2}' | grep -v '^docs/KIRO_USAGE.md$' | head -12 | paste -sd ',' - | sed 's/,/, /g')"
log=docs/KIRO_USAGE.md
grep -q '^## Usage log' "$log" 2>/dev/null || printf '\n## Usage log\n\nAppended by the `usage-log` hook after each completed spec task.\n\n| Time (UTC) | Task | Files changed |\n| --- | --- | --- |\n' >> "$log"
printf '| %s | %s | %s |\n' "$(date -u +%FT%TZ)" "$task" "${files:-none}" >> "$log"
