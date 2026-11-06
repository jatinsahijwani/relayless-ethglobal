#!/usr/bin/env bash
# Runs the whole ENS setup and end-to-end test on a throwaway fork of Sepolia, against the real ENSv2 contracts, with
# free gas. Nothing is sent to Sepolia. The money side still uses the running local chain, as it does for real.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

PORT=18999
FORK_FROM=${FORK_FROM:-https://ethereum-sepolia-rpc.publicnode.com}
WORK=$(mktemp -d)
# A few blocks back: public nodes can report a head they can't yet serve state for.
FORK_BLOCK=$(($(cast block-number --rpc-url "$FORK_FROM") - 8))
anvil --fork-url "$FORK_FROM" --fork-block-number "$FORK_BLOCK" --block-time 2 --port "$PORT" --silent &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true; rm -rf "$WORK"' EXIT
until cast block-number --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1; do
  kill -0 "$ANVIL" 2>/dev/null || { echo "anvil exited: try another FORK_FROM"; exit 1; }
  sleep 1
done

export ENS_CONFIG_PATH="$WORK/ens.json" ENS_STATE_PATH="$WORK/state.json"
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync("config/ens.sepolia.json", "utf8"));
Object.assign(c, { rpc: "http://127.0.0.1:'"$PORT"'", rpcFallbacks: [], deployBlock: null, claimer: null });
fs.writeFileSync(process.env.ENS_CONFIG_PATH, JSON.stringify(c, null, 2));
'
cast rpc --rpc-url "http://127.0.0.1:$PORT" anvil_setBalance "$(cast wallet address --private-key "$SEPOLIA_DEPLOYER_KEY")" 0x56BC75E2D63100000 >/dev/null

(cd packages/ens && forge build >/dev/null)
npx tsx scripts/ens/setup.ts
npx tsx scripts/ens/add-asp.ts --label "$(node -p 'JSON.parse(require("fs").readFileSync(process.env.ENS_CONFIG_PATH)).names.worldAspLabel')" --network local-asp --operator-env ASP_KEY --policy "World ID: one unique human"
npx tsx scripts/ens/add-asp.ts --label allowlist --network local-asp2 --operator-env ASP2_KEY --policy "Allowlist: deposits the operator approves by hand"
npx tsx scripts/ens/add-asp.ts --label forged-demo --network local-asp2 --operator-env ASP2_KEY --policy "Deliberately wrong root, to show the warning"
[ -n "${REHEARSE_SKIP_E2E:-}" ] || npx tsx scripts/e2e-ens.ts
# Leaves the fork running, so the web app can be tried against it.
if [ -n "${REHEARSE_KEEP_CONFIG:-}" ]; then
  cp "$ENS_CONFIG_PATH" "$REHEARSE_KEEP_CONFIG"
  echo "fork ready, config in $REHEARSE_KEEP_CONFIG"
  wait "$ANVIL"
fi
