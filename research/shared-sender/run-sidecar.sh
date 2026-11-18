#!/usr/bin/env bash
# One command per sidecar target: research/shared-sender/run-sidecar.sh nofix|fix
#
# Builds the ERC-8421 sidecar from upstream 2e22ff0a with our patches applied:
#   nofix: 2-per-entity-budgets-precompiles.patch only (needed for the pool's withdrawals to be admitted at all)
#   fix:   1-replacement-not-seen.patch + 2-per-entity-budgets-precompiles.patch
# then runs two fresh instances against the running devnet-8421 chain (scripts/local-stack.sh): A on :14347 mines,
# B on :14348 is in manual mode and never mines. No gossip between them. The config has no `precompiles` entry, so
# the patched default applies. Then it runs the harness and stops both instances.
set -euo pipefail
VARIANT="${1:?usage: run-sidecar.sh nofix|fix}"
case "$VARIANT" in nofix) PATCHES="2-per-entity-budgets-precompiles.patch" ;; fix) PATCHES="1-replacement-not-seen.patch 2-per-entity-budgets-precompiles.patch" ;; *) echo "nofix or fix"; exit 1 ;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/research/shared-sender"
STACK="$ROOT/.relayless/stack"
WORK="$ROOT/.relayless/shared-sender/sidecar-$VARIANT"
UPSTREAM_COMMIT=2e22ff0a2898e69ea4bf5275bce1be8581a8582a
export PATH="$STACK/tools/node_modules/.bin:$PATH" # bun, as scripts/local-stack.sh installs it

[ -f "$STACK/sidecar-config.json" ] || { echo "start the devnet first: scripts/local-stack.sh"; exit 1; }
cast block-number --rpc-url http://127.0.0.1:18545 >/dev/null || { echo "the devnet isn't answering on :18545"; exit 1; }

if [ ! -d "$WORK/src" ]; then
  mkdir -p "$WORK"
  GIT_CONFIG_GLOBAL=/dev/null git clone --quiet https://github.com/forshtat/mempool-workshop-sidecar.git "$WORK/src"
  git -C "$WORK/src" checkout --quiet "$UPSTREAM_COMMIT"
  for p in $PATCHES; do git -C "$WORK/src" apply "$HERE/sidecar-patches/$p"; done
  (cd "$WORK/src" && GIT_CONFIG_GLOBAL=/dev/null bun install --frozen-lockfile >/dev/null && bun run build:all >/dev/null)
fi

node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); delete c.precompiles; require("fs").writeFileSync(process.argv[2], JSON.stringify(c, null, 2));' "$STACK/sidecar-config.json" "$WORK/config.json"
chmod 600 "$WORK/config.json"

stop() { pkill -f "configFile $WORK/config.json" 2>/dev/null || true; }
stop
trap stop EXIT
RUN="$(date +%s)"
# Each instance needs its own WebSocket port too: it defaults to 14337, the stack's own sidecar.
for spec in "A 14347 14447 auto" "B 14348 14448 manual"; do
  set -- $spec
  (cd "$WORK/src" && SKANDHA_FAUCET_KEY="$(cat "$STACK/faucet.key")" nohup ./skandha standalone --configFile "$WORK/config.json" \
    --dataDir "$WORK/data-$1-$RUN" --api.address 127.0.0.1 --api.port "$2" --api.wsPort "$3" --redirectRpc --explorer.enable \
    --executor.bundlingMode "$4" > "$WORK/node-$1.log" 2>&1 &)
done
for n in "A 14347" "B 14348"; do
  set -- $n
  for i in $(seq 1 90); do
    curl -s -m 2 -o /dev/null -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "http://127.0.0.1:$2/rpc/" && break
    if [ "$i" = 90 ]; then echo "sidecar $1 didn't start:"; tail -20 "$WORK/node-$1.log"; exit 1; fi
    sleep 2
  done
done

cd "$ROOT"
set -a; . ./.env; set +a
npx tsx research/shared-sender/run.ts "sidecar-$VARIANT"
