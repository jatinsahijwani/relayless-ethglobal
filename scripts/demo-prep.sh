#!/usr/bin/env bash
# Checks everything the demo needs and prints a green or red line for each. It never restarts the chain.
# usage: scripts/demo-prep.sh [--fix]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env: run scripts/local-stack.sh first"; exit 1; }
set -a; . ./.env; set +a
exec npx tsx scripts/demo-prep.ts "$@"
