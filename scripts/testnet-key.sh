#!/usr/bin/env bash
# Makes a fresh throwaway key for the public testnet, in .env.hegota-8141 (git-ignored, mode 600), and prints only its
# address, which is what gets funded. Refuses to overwrite an existing key: it may hold funds.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE=.env.hegota-8141
if [ -f "$FILE" ]; then
  echo "$FILE already exists, for $(set -a; . "./$FILE"; cast wallet address "$DEPLOYER_KEY"). Not overwriting it."
  exit 0
fi
git check-ignore -q "$FILE" || { echo "$FILE isn't git-ignored: refusing to write a key there"; exit 1; }
umask 077
printf 'DEPLOYER_KEY=0x%s\n' "$(openssl rand -hex 32)" > "$FILE"
echo "fund this address on chain 8141: $(set -a; . "./$FILE"; cast wallet address "$DEPLOYER_KEY")"
