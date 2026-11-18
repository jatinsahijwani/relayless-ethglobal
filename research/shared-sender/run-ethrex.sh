#!/usr/bin/env bash
# One command per ethrex target: research/shared-sender/run-ethrex.sh 64b8fc09|247e2dd2
#
#   64b8fc09: the local hegota-8141 chain (scripts/local-stack-hegota.sh), chain 8141's client revision. No width budget.
#   247e2dd2: a second local chain on ethrex 247e2dd2, which has MATCHA on by default, built with
#             patches/ethrex-dev-hegota-247e2dd2.patch (dev producer only). Its dev producer lets finality trail the
#             head by FINALITY_LAG blocks (default 64, about two epochs), because MATCHA credits width only at
#             finality, and dev mode would otherwise finalize every block at once. A fresh pool is deployed for every
#             run, so the pool starts with no width.
set -euo pipefail
REV="${1:?usage: run-ethrex.sh 64b8fc09|247e2dd2}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

case "$REV" in
  64b8fc09)
    scripts/local-stack-hegota.sh >/dev/null
    set -a; . .relayless/hegota-stack/keys.env; set +a
    FINALITY_LAG=0 npx tsx research/shared-sender/run.ts ethrex-64b8fc09
    ;;
  247e2dd2)
    LAG="${FINALITY_LAG:-64}"
    W="$ROOT/.relayless/matcha-stack"
    if [ ! -x "$W/ethrex/target/release/ethrex" ]; then
      mkdir -p "$W"
      GIT_CONFIG_GLOBAL=/dev/null git clone --quiet --filter=blob:none https://github.com/lambdaclass/ethrex.git "$W/ethrex"
      git -C "$W/ethrex" checkout --quiet 247e2dd2c4d4c526dcc64ac1c025bd2319e7a10e
      git -C "$W/ethrex" apply "$ROOT/patches/ethrex-dev-hegota-247e2dd2.patch"
      (cd "$W/ethrex" && GIT_CONFIG_GLOBAL=/dev/null CARGO_NET_GIT_FETCH_WITH_CLI=true cargo build --release --bin ethrex)
    fi
    # Restart the node so it picks up the finality lag.
    pkill -f "ethrex.*matcha-stack" 2>/dev/null || true
    while pgrep -f "ethrex.*matcha-stack" >/dev/null; do sleep 1; done
    export ETHREX_DEV_FINALITY_LAG="$LAG"
    RELAYLESS_HEGOTA_DIR="$W" RELAYLESS_HEGOTA_NAME=local-matcha RELAYLESS_HEGOTA_PORT=18745 RELAYLESS_HEGOTA_AUTH_PORT=18751 \
      RELAYLESS_HEGOTA_CHAIN_ID=81411 ETHREX_COMMIT=247e2dd2c4d4c526dcc64ac1c025bd2319e7a10e scripts/local-stack-hegota.sh >/dev/null
    set -a; . "$W/keys.env"; set +a
    FINALITY_LAG="$LAG" npx tsx research/shared-sender/run.ts ethrex-247e2dd2
    ;;
  *) echo "64b8fc09 or 247e2dd2"; exit 1 ;;
esac
