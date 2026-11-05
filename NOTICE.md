# Notices

## Adapted code
**0xbow Privacy Pools** (Apache-2.0): https://github.com/0xbow-io/privacy-pools-core

Adapted, with headers kept and changes noted in each file:
- `packages/circuits/circuits/commitment.circom`
- `packages/circuits/circuits/leanImt.circom`: positional constraints added, unused `actualDepth` input removed
- `packages/circuits/circuits/withdraw.circom`: `context` replaced by the frame sigHash, root bound to leaf count, k-gate added, ASP check made conditional
- `packages/circuits/circuits/ragequit.circom`

The pool's label scheme and public-exit design also follow theirs.

## Dependencies with licenses to note
- **circomlib** (**GPL-3.0**): its templates are compiled into the circuits. This may affect how the compiled circuits can be licensed, so decide this before choosing a final project license.
- **@forshtat/hegota-support** (MIT): frame transaction codec and wire format.
- **@zk-kit/lean-imt.sol** (MIT): the on-chain tree.
- **poseidon-solidity**, **poseidon-lite** (MIT): Poseidon hashing.
- **snarkjs** (GPL-3.0): the prover, used as a runtime dependency.
- **viem** (MIT).

## Changes to third-party software
`patches/sidecar-budget-010.patch` modifies `forshtat/mempool-workshop-sidecar` (MIT). It isn't part of this project's own code.

## Studied, not copied
`forshtat/mempool-workshop` has no license file, so its code was read and run but not copied. Its opcode numbers and helper patterns come from `@forshtat/hegota-support` and the EIPs.
