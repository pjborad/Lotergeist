#!/usr/bin/env bash
# Installs the PHI-guard pre-commit hook into .git/hooks (no git config changes).
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
install -m 0755 "$root/.githooks/pre-commit" "$root/.git/hooks/pre-commit"
echo "pre-commit hook installed: $root/.git/hooks/pre-commit"
