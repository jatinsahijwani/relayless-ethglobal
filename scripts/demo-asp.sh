#!/usr/bin/env bash
# The demo pool's ASP: the reference allowlist ASP, whose stated policy is that its operator approves deposits.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export RELAYLESS_NETWORK=local-asp ASP_PORT=8790 ASP_ALLOWED_ORIGIN=${ASP_ALLOWED_ORIGIN:-http://127.0.0.1:5199}
exec pnpm --filter @relayless/asp start
