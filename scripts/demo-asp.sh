#!/usr/bin/env bash
# The demo pool's ASP: allowlist.asp.relayless.eth, whose stated policy is that its operator approves deposits. It runs
# beside the World ID ASP on 8790 and leaves it alone. World ID is switched off here, and the /allow route is on.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${ASP2_KEY:?set ASP2_KEY in .env}"
export RELAYLESS_NETWORK=local-asp2 ASP_KEY="$ASP2_KEY" ASP_ALLOWLIST=1 ASP_PORT=8791 ASP_ENS_LABEL=allowlist WORLD_APP_ID= WORLD_RP_ID= WORLD_SIGNING_KEY=
exec pnpm --filter @relayless/asp start
