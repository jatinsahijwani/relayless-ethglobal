#!/usr/bin/env bash
# One command for a local chain and alt mempool: clones the sidecar, applies our patch, starts everything, deploys.
# Everything binds to localhost. Needs Docker, Node, pnpm, Foundry, circom. First run takes about 15 minutes, because
# frame transactions activate about 11 minutes after genesis.
# Pool setup is idempotent on the sidecar and registry, and deploys a fresh pool on every run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${RELAYLESS_STACK_DIR:-$ROOT/.relayless/stack}"
SIDECAR="$WORK/mempool-workshop-sidecar"
TOOLS="$WORK/tools"
RPC=http://127.0.0.1:18545
SIDECAR_COMMIT=2e22ff0a2898e69ea4bf5275bce1be8581a8582a
mkdir -p "$WORK"

if [ ! -d "$SIDECAR" ]; then
  GIT_CONFIG_GLOBAL=/dev/null git clone --quiet https://github.com/forshtat/mempool-workshop-sidecar.git "$SIDECAR"
  git -C "$SIDECAR" checkout --quiet "$SIDECAR_COMMIT"
  git -C "$SIDECAR" apply "$ROOT/patches/sidecar-budget-010.patch"
  cp "$ROOT/patches/devnet-compose.override.yml" "$SIDECAR/deploy/devnet/docker-compose.override.yml"
fi
mkdir -p "$TOOLS"
if [ ! -x "$TOOLS/node_modules/.bin/bun" ]; then (cd "$TOOLS" && npm init -y >/dev/null && npm i --silent --no-audit --no-fund bun@1.2.23); fi
export PATH="$TOOLS/node_modules/.bin:$PATH"
if [ ! -d "$SIDECAR/packages/executor/lib" ]; then (cd "$SIDECAR" && bun install --frozen-lockfile && bun run build:all); fi

cd "$SIDECAR/deploy/devnet"
if ! cast block-number --rpc-url "$RPC" >/dev/null 2>&1; then
  export GENESIS_TIMESTAMP LIGHTHOUSE_BEACON_1_ENR=pending LIGHTHOUSE_BEACON_1_IP=0.0.0.0
  GENESIS_TIMESTAMP=$(date +%s)
  docker compose up genesis validator-keys
  docker compose up -d --no-deps ethrex
  NET=$(docker network inspect eip8141-devnet_default --format '{{(index .IPAM.Config 0).Subnet}}' | cut -d. -f1-3)
  export LIGHTHOUSE_BEACON_1_IP="$NET.3"
  docker compose up -d --no-deps lighthouse-beacon
  until [ -s data/lighthouse-beacon/beacon/network/enr.dat ] || [ -n "$(find data/lighthouse-beacon -name enr.dat -size +0 2>/dev/null)" ]; do sleep 2; done
  LIGHTHOUSE_BEACON_1_ENR=$(cat "$(find data/lighthouse-beacon -name enr.dat | head -1)")
  export LIGHTHOUSE_BEACON_1_ENR
  docker compose up -d --no-deps lighthouse-beacon-2 lighthouse-validator
fi
echo "waiting for frame transactions to activate (up to about 11 minutes after genesis)..."
until [ "$(cast code 0x0000000000000000000000000000000000008272 --rpc-url "$RPC" 2>/dev/null || echo 0x)" != "0x" ]; do sleep 5; done

cd "$ROOT"
if [ ! -f .env ]; then
  # The genesis account's key, published in the sidecar's devnet docs. Only funded on this private chain.
  GENESIS_KEY=$(grep -m1 'private key:' "$SIDECAR/deploy/devnet/devnet-readme.md" | awk '{print $3}')
  printf 'DEPLOYER_KEY=%s\nASP_KEY=0x%s\n' "$GENESIS_KEY" "$(openssl rand -hex 32)" > .env
  chmod 600 .env
fi
set -a; . ./.env; set +a

CONFIG="$WORK/sidecar-config.json"
if [ ! -f "$WORK/registry" ]; then
  node scripts/deploy-registry.mjs "$SIDECAR/deploy/predeploy/src/contracts/NaiveStakingRegistry.sol" > "$WORK/registry"
fi
REGISTRY=$(cat "$WORK/registry")
FAUCET_KEY=$(cat "$WORK/faucet.key" 2>/dev/null || true)
if [ -z "$FAUCET_KEY" ]; then
  FAUCET_KEY=0x$(openssl rand -hex 32); echo "$FAUCET_KEY" > "$WORK/faucet.key"; chmod 600 "$WORK/faucet.key"
  cast send "$(cast wallet address "$FAUCET_KEY")" --value 100ether --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" --legacy --gas-limit 300000 >/dev/null
fi
node -e '
const [reg, key, out] = process.argv.slice(1);
const ep = "0x00000000000000000000000000000000000000aa", id = "QmcFZKUX9qoo3StwVycJTAhwdiqbEjcwNvQVK246p3z1rk";
const precompiles = [...Array(17).keys()].map((i) => "0x" + (i + 1).toString(16).padStart(40, "0")).concat("0x" + (256).toString(16).padStart(40, "0"));
require("fs").writeFileSync(out, JSON.stringify({ entryPoints: [ep], relayers: [key], rpcEndpoint: "http://127.0.0.1:18545", rpcEndpointSubmit: "http://127.0.0.1:18545", standardMempoolId: id, canonicalEntryPoint: ep, supportedMempools: [{ mempoolId: id, entryPoint: ep }], stakingRegistryAddress: reg, precompiles }, null, 2));
' "$REGISTRY" "$DEPLOYER_KEY" "$CONFIG"
chmod 600 "$CONFIG"

if ! pgrep -f 'skandha.js standalone' >/dev/null; then
  (cd "$SIDECAR" && SKANDHA_FAUCET_KEY="$FAUCET_KEY" nohup ./skandha standalone --configFile "$CONFIG" --dataDir "$WORK/skandha-data" --api.address 127.0.0.1 --api.port 14337 --redirectRpc --explorer.enable > "$WORK/sidecar.log" 2>&1 &)
fi
until curl -s -m 2 -o /dev/null -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:14337/rpc/; do sleep 2; done

printf '{\n  "name": "local",\n  "chainId": 1337,\n  "rpc": "http://127.0.0.1:18545",\n  "mempool": "http://127.0.0.1:14337/rpc/",\n  "stakingRegistry": "%s",\n  "stakeEth": "0.012",\n  "reserveEth": "1",\n  "unstakeDelaySec": 86400\n}\n' "$REGISTRY" > config/local.json
[ -f packages/circuits/build/withdraw.zkey ] || pnpm build:circuits
pnpm build:contracts
npx tsx scripts/deploy.ts local
echo
echo "Ready. Run the app with: pnpm web"
echo "Stop with: pkill -f 'skandha.js standalone'; (cd '$SIDECAR/deploy/devnet' && docker compose stop)"
