#!/usr/bin/env bash
# A local hegota-8141 chain: ethrex at the revision chain 8141 runs (64b8fc09), in dev mode, which produces its own
# blocks and supplies the EIP-7843 slot, so no consensus client is needed. Then deploys a pool built for hegota-8141.
#
# Same client, same EIP revisions and the same mempool budget (500,000 verify gas) as the public testnet; a different
# chain id (81410), so nothing signed here is valid there. There is no alt mempool on this profile: withdrawals go to
# the node's own public mempool, as they do on chain 8141.
#
# Needs Rust (rustup), Node, pnpm, Foundry, git. The first run builds ethrex from source, about 10-20 minutes.
# Everything binds to localhost. Stop with: pkill -f 'ethrex.*hegota-stack'
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Overridable so a second chain can run beside this one (research/shared-sender runs ethrex 247e2dd2 this way).
WORK="${RELAYLESS_HEGOTA_DIR:-$ROOT/.relayless/hegota-stack}"
NAME="${RELAYLESS_HEGOTA_NAME:-local-hegota}"
ETHREX_REPO=https://github.com/lambdaclass/ethrex.git
ETHREX_COMMIT="${ETHREX_COMMIT:-64b8fc09d47d7787eb1a4e3f082aa9e831dc5f8c}" # web3_clientVersion on rpc1.privacy.ethrex.xyz, 2026-11-16
CHAIN_ID="${RELAYLESS_HEGOTA_CHAIN_ID:-81410}"
PORT="${RELAYLESS_HEGOTA_PORT:-18645}"
AUTH_PORT="${RELAYLESS_HEGOTA_AUTH_PORT:-18651}"
RPC=http://127.0.0.1:$PORT
mkdir -p "$WORK"

for tool in cargo node pnpm forge cast git curl openssl; do
  command -v "$tool" >/dev/null || { echo "missing: $tool"; exit 1; }
done
(cd "$ROOT" && pnpm install --silent)

# Build the pinned ethrex unless ETHREX_BIN points at one. Git settings are isolated so a global URL rewrite can't
# turn the public HTTPS clone into an SSH one.
ETHREX_BIN="${ETHREX_BIN:-$WORK/ethrex/target/release/ethrex}"
if [ ! -x "$ETHREX_BIN" ]; then
  export GIT_CONFIG_GLOBAL=/dev/null CARGO_NET_GIT_FETCH_WITH_CLI=true
  [ -d "$WORK/ethrex" ] || git clone --quiet --filter=blob:none "$ETHREX_REPO" "$WORK/ethrex"
  git -C "$WORK/ethrex" checkout --quiet "$ETHREX_COMMIT"
  # At this commit the dev block producer still drives Hegotá with Amsterdam's engine calls, which the node refuses
  # ("engine_forkchoiceUpdatedV4 cannot accept Hegotá payload attributes"). The patch sends forkchoiceUpdatedV5 and
  # newPayloadV6 with an empty inclusion list. It touches only the dev producer and its engine client, never block
  # validation, the EVM or the mempool.
  git -C "$WORK/ethrex" apply "$ROOT/patches/ethrex-dev-hegota.patch"
  (cd "$WORK/ethrex" && cargo build --release --bin ethrex)
fi
"$ETHREX_BIN" --version | grep -q "${ETHREX_COMMIT:0:9}" || echo "warning: $ETHREX_BIN is not ethrex ${ETHREX_COMMIT:0:9}"

cd "$ROOT"
# Keys for this private chain only: the deployer and the ASP operator, funded at genesis.
if [ ! -f "$WORK/keys.env" ]; then
  printf 'DEPLOYER_KEY=0x%s\nASP_KEY=0x%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$WORK/keys.env"
  chmod 600 "$WORK/keys.env"
fi
set -a; . "$WORK/keys.env"; set +a

if ! cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
  if [ ! -f "$WORK/genesis.json" ]; then
    # ethrex's own Hegotá dev genesis (every fork from genesis, system contracts in place), with our chain id, chain
    # 8141's 200M block gas limit, a current timestamp and our two keys funded.
    DEPLOYER=$(cast wallet address "$DEPLOYER_KEY") ASP=$(cast wallet address "$ASP_KEY") \
    node -e '
      const fs = require("fs");
      const [src, out, chainId] = process.argv.slice(1);
      const g = JSON.parse(fs.readFileSync(src, "utf8"));
      g.config.chainId = Number(chainId);
      g.gasLimit = "0xbebc200";
      g.timestamp = "0x" + Math.floor(Date.now() / 1000).toString(16);
      for (const a of [process.env.DEPLOYER, process.env.ASP]) g.alloc[a.toLowerCase().slice(2)] = { balance: "0x" + (10n ** 24n).toString(16) };
      fs.writeFileSync(out, JSON.stringify(g, null, 2));
    ' "$(dirname "$ETHREX_BIN")/../../fixtures/genesis/l1-hegota.json" "$WORK/genesis.json" "$CHAIN_ID"
  fi
  nohup "$ETHREX_BIN" --dev --network "$WORK/genesis.json" --datadir "$WORK/data" \
    --http.addr 127.0.0.1 --http.port "$PORT" --http.api eth,net,web3,txpool,debug,ethrex \
    --authrpc.addr 127.0.0.1 --authrpc.port "$AUTH_PORT" --authrpc.jwtsecret "$WORK/jwt.hex" \
    --p2p.disabled --mempool.max-verify-gas 500000 --log.level info ${ETHREX_EXTRA_ARGS:-} > "$WORK/ethrex.log" 2>&1 &
  until cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; do sleep 1; done
fi
echo "waiting for the Hegotá predeploys..."
until [ "$(cast code 0x0000000000000000000000000000000000008272 --rpc-url "$RPC" 2>/dev/null || echo 0x)" != "0x" ]; do sleep 1; done

printf '{\n  "name": "%s",\n  "profile": "hegota-8141",\n  "chainId": %s,\n  "rpc": "%s",\n  "reserveEth": "1"\n}\n' "$NAME" "$CHAIN_ID" "$RPC" > "config/$NAME.json"
[ -f packages/circuits/build/withdraw.zkey ] || pnpm build:circuits
pnpm build:contracts
npx tsx scripts/deploy.ts "$NAME"
echo
echo "Ready: pool in config/$NAME.deployed.json. Keys for this chain: $WORK/keys.env"
echo "Run the end-to-end suite with: set -a; . $WORK/keys.env; set +a; pnpm e2e $NAME"
