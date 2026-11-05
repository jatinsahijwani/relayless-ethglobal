#!/usr/bin/env bash
# Compiles both circuits and runs a Groth16 setup. DEVNET ONLY: the phase-2 contribution is a single local one.
set -euo pipefail
cd "$(dirname "$0")/.."
PTAU_NAME=ppot_0080_15.ptau
SNARKJS=node_modules/.bin/snarkjs
mkdir -p build
[ -f "build/$PTAU_NAME" ] || curl -fsSL -o "build/$PTAU_NAME" "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/$PTAU_NAME"
for c in withdraw ragequit; do
  circom "circuits/$c.circom" --r1cs --wasm -l node_modules/circomlib/circuits -l circuits -o build
  "$SNARKJS" r1cs info "build/$c.r1cs" | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Constraints|Public Inputs|Private Inputs'
  "$SNARKJS" groth16 setup "build/$c.r1cs" "build/$PTAU_NAME" "build/${c}_0.zkey" >/dev/null
  "$SNARKJS" zkey contribute "build/${c}_0.zkey" "build/$c.zkey" -e="relayless devnet $(date +%s) $RANDOM" >/dev/null
  rm "build/${c}_0.zkey"
  "$SNARKJS" zkey export verificationkey "build/$c.zkey" "build/$c.vk.json" >/dev/null
done
