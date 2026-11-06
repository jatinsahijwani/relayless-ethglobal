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

## Dependencies with licenses to note
- **circomlib** (**GPL-3.0**): its templates are compiled into the circuits, which is why this project is GPL-3.0.
- **@forshtat/hegota-support** (MIT): frame transaction codec and wire format.
- **@zk-kit/lean-imt.sol** (MIT): the on-chain tree.
- **poseidon-solidity**, **poseidon-lite** (MIT): Poseidon hashing.
- **snarkjs** (GPL-3.0): the prover, used as a runtime dependency.
- **viem** (MIT).
- **@scopelift/stealth-address-sdk** (MIT): ERC-5564 scheme 1 derivation, checking and key recovery. Only its crypto functions are imported, and it's used as a dependency, not copied.
- **@noble/secp256k1**, **@noble/hashes** (MIT): curve operations and key derivation.

## Standards and interfaces
- `packages/ens/src/ERC5564Announcer.sol` implements the interface from [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) (CC0).
- `packages/ens` declares minimal interfaces for ENS [contracts-v2](https://github.com/ensdomains/contracts-v2) (MIT) and calls the contracts deployed on Sepolia. No ENS code is copied.

## Changes to third-party software
`patches/sidecar-budget-010.patch` modifies `forshtat/mempool-workshop-sidecar` (MIT). It isn't part of this project's own code.

## Studied, not copied
`forshtat/mempool-workshop` has no license file, so its code was read and run but not copied. Its opcode numbers and helper patterns come from `@forshtat/hegota-support` and the EIPs.
