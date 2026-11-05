#!/usr/bin/env bash
# Sets up the approved-set pool on a running local stack: funds the ASP key and deploys a pool naming its root source.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
RPC=http://127.0.0.1:18545
ASP=$(cast wallet address "$ASP_KEY")
cast send "$ASP" --value 1ether --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" --legacy --gas-limit 300000 >/dev/null
REGISTRY=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("config/local.json","utf8")).stakingRegistry)')
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync("config/local.json", "utf8"));
fs.writeFileSync("config/local-asp.json", JSON.stringify({ ...c, name: "local-asp", aspUrl: "http://127.0.0.1:8790" }, null, 2) + "\n");
'
ASP_SOURCE_ID=$(cast keccak "$(cast concat-hex "$ASP" "$(cast keccak relayless.asp)")")
export ASP_SOURCE_ID
npx tsx scripts/deploy.ts local-asp
echo "approved-set pool ready, staking registry $REGISTRY"
