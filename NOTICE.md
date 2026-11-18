# Notices

Relayless is licensed under GPL-3.0 (see `LICENSE`). Versions before this change were published under MIT.

The Apache-2.0 and MIT code listed below is included under those licenses' terms, which are compatible with GPL-3.0.

## Adapted code
**0xbow Privacy Pools** (Apache-2.0): https://github.com/0xbow-io/privacy-pools-core

Adapted, with headers kept and changes noted in each file:
- `packages/circuits/circuits/commitment.circom`
- `packages/circuits/circuits/leanImt.circom`: positional constraints added, unused `actualDepth` input removed
- `packages/circuits/circuits/withdraw.circom`: `context` replaced by the frame sigHash, root bound to leaf count, k-gate added, ASP check made conditional
- `packages/circuits/circuits/ragequit.circom`

The pool's label scheme and public-exit design also follow theirs.

**soispoke's minimal-shielded-pool** (Apache-2.0): https://github.com/soispoke/minimal-shielded-pool, studied at `eb1bc0e7`

The withdrawal's public-input compression follows its use of the hybrid scheme from [eprint 2025/1500](https://eprint.iacr.org/2025/1500): `alpha = keccak256(statement) mod r` computed by the pool, `beta = Poseidon(statement)` as a circuit output, and `gamma`, the statement as a polynomial at `alpha + beta`, with the verifier's order `[beta, gamma, alpha]` and every statement value range-checked by the pool. Adapted, not copied: our statement is seven values rather than eleven, `beta` travels after the proof in the frame transaction's signature rather than in the VERIFY frame's data, and the code is our own:
- `packages/circuits/circuits/withdraw.circom` (the compression block)
- `packages/contracts/script/gen-validator.mjs` (the validator's `alpha`, `beta` and `gamma`)
- `packages/sdk/src/compression.ts`

## Dependencies with licenses to note
- **circomlib** (**GPL-3.0**): its templates are compiled into the circuits, which is why this project is GPL-3.0.
- **@forshtat/hegota-support** (MIT): frame transaction codec and wire format.
- **@zk-kit/lean-imt.sol** (MIT): the on-chain tree.
- **poseidon-solidity**, **poseidon-lite** (MIT): Poseidon hashing.
- **snarkjs** (GPL-3.0): the prover, used as a runtime dependency. Its own GPL-3.0 dependencies stay packages too: **ffjavascript**, **fastfile**, **r1csfile**, **wasmcurves**, **wasmbuilder**, **@iden3/binfileutils** and **@iden3/bigarray**.
- **viem** (MIT).
- **@noble/hashes** (MIT): key derivation.

## GPL code in this repository
No GPL source is copied in. `circomlib` and `snarkjs` are installed as packages, circuits include `circomlib` from `node_modules` at build time, and the on-chain verifier is hand-written Yul rather than the snarkjs Solidity template.

`packages/circuits/build/` holds generated files: the compiled circuits (which contain `circomlib` templates), proving and verifying keys, and the witness helpers circom emits. They are build outputs, committed so a fresh clone skips the trusted setup, and they're distributed under this project's GPL-3.0.

## Changes to third-party software
`patches/sidecar-budget-010.patch` modifies `forshtat/mempool-workshop-sidecar` (MIT). It isn't part of this project's own code.

## Studied, not copied
`forshtat/mempool-workshop` has no license file, so its code was read and run but not copied. Its opcode numbers and helper patterns come from `@forshtat/hegota-support` and the EIPs.
