#!/usr/bin/env bash
# Deploys a second association-set pool on the running local stack, for a second ASP in the directory. A pool's ASP is
# immutable, so a second provider needs a second pool. Doesn't touch the chain or any existing pool.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a
: "${ASP2_KEY:?set ASP2_KEY in .env}"
if [ -f config/local-asp2.deployed.json ] && [ "$(cast code --rpc-url http://127.0.0.1:18545 "$(node -p 'require("./config/local-asp2.deployed.json").pool')")" != "0x" ]; then
  echo "already deployed"; exit 0
fi
RPC=http://127.0.0.1:18545
ASP=$(cast wallet address --private-key "$ASP2_KEY")
cast send "$ASP" --value 1ether --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" --legacy --gas-limit 300000 >/dev/null
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync("config/local.json", "utf8"));
fs.writeFileSync("config/local-asp2.json", JSON.stringify({ ...c, name: "local-asp2" }, null, 2) + "\n");
'
ASP_SOURCE_ID=$(cast keccak "$(cast concat-hex "$ASP" "$(cast keccak relayless.asp)")")
export ASP_SOURCE_ID
npx tsx scripts/deploy.ts local-asp2
