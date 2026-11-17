#!/usr/bin/env bash
# Sets up the approved-set pool on a running local chain: funds the ASP key and deploys a pool naming its root source.
# usage: scripts/setup-asp.sh [base network] [env file]. Defaults: local and ./.env (the devnet). For the local
# hegota-8141 chain: scripts/setup-asp.sh local-hegota .relayless/hegota-stack/keys.env
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=${1:-local}
ENV_FILE=${2:-./.env}
set -a; . "$ENV_FILE"; set +a
RPC=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).rpc)' "config/$BASE.json")
ASP=$(cast wallet address "$ASP_KEY")
cast send "$ASP" --value 1ether --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" --legacy --gas-limit 300000 >/dev/null
node -e '
const fs = require("fs");
const [base, name] = process.argv.slice(1);
const c = JSON.parse(fs.readFileSync(`config/${base}.json`, "utf8"));
fs.writeFileSync(`config/${name}.json`, JSON.stringify({ ...c, name, aspUrl: "http://127.0.0.1:8790" }, null, 2) + "\n");
' "$BASE" "$BASE-asp"
ASP_SOURCE_ID=$(cast keccak "$(cast concat-hex "$ASP" "$(cast keccak relayless.asp)")")
export ASP_SOURCE_ID
npx tsx scripts/deploy.ts "$BASE-asp"
echo "approved-set pool ready: config/$BASE-asp.deployed.json"
