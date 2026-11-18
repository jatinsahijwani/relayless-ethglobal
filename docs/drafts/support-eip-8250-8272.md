# Drafts: support for EIP-8250 and EIP-8272 in Hegotá

**Not posted.** Two short posts for the author to review and send, one per Ethereum Magicians thread. Both EIPs are listed as "Considered for Inclusion" in EIP-8081 (checked 2026-11-17); EIP-8141 is "Scheduled".

Every number below is from our own runs on chain 8141 (`hegota-8141` profile) or our local chains, with links. Update them if a newer run replaces them.

---

## 1. EIP-8250 (Keyed Nonces for Frame Transactions)
Thread: https://ethereum-magicians.org/t/eip-8250-keyed-nonces-for-frame-transactions/28437

> **Support for Hegotá, from a working user on chain 8141**
>
> [Relayless](https://github.com/jatinsahijwani/relayless-ethglobal) is a privacy pool on frame transactions where the pool is the sender and pays gas from the note being withdrawn, so a wallet holding 0 ETH can receive a private payment with no relayer. Keyed nonces are what make that design possible. Each withdrawal's nullifier hash *is* its EIP-8250 nonce key, at sequence 0:
>
> - **Double spends are refused by the protocol, before broadcast.** On chain 8141, a second withdrawal of a spent note was refused by the node's own simulation with `Nonce mismatch: expected 1, got 0`, and nothing was sent ([run](https://github.com/jatinsahijwani/relayless-ethglobal#public-testnet)). The pool needs no nullifier storage read in validation for this.
> - **Many users share one sender without waiting for each other.** Three withdrawals from the one pool sender, on three keys, were pending at once on chain 8141 and mined in the same block ([`0x7dabc6e6…`](https://dora.privacy.ethrex.xyz/tx/0x7dabc6e6d7d93be1e2a589f1458b0cce291cc8589b9eef7d19daadc134181e1b), [`0x1d02aa24…`](https://dora.privacy.ethrex.xyz/tx/0x1d02aa2465ea150ef9dded3c163d8515efb359d10a779ae604b0aaa39d9e62d4), [`0x8e87a405…`](https://dora.privacy.ethrex.xyz/tx/0x8e87a40519350a210841ea1c2c6c56f2914b92da6411c2807819f5d121ad5f7f)). Without keyed nonces, a shared sender is one pending transaction at a time.
> - **The cost is visible and reasonable:** 97,920 state gas for the key's first use, inside a 916,820-gas withdrawal.
>
> Without EIP-8250, a pool either keeps nullifiers in its own storage (which validation can't read without breaking concurrency) or needs a relayer. We'd like to see it scheduled with EIP-8141.
>
> One data point for the discussion of shared senders: a key consumed on chain also proves that the sender *did* get a transaction included, which matters for how mempools account for evicted conflicts. We've written that up for the ERC-8421 sidecar and will link it.

---

## 2. EIP-8272 (Recent Roots for Frame Transactions)
Thread: https://ethereum-magicians.org/t/eip-8272-recent-roots-for-frame-transactions/28621

> **Support for Hegotá, from a working user on chain 8141**
>
> [Relayless](https://github.com/jatinsahijwani/relayless-ethglobal), a privacy pool on frame transactions, takes its Merkle root from an EIP-8272 recent-root frame on chain 8141, and its validation reads no storage at all. That's what lets one pool sender serve many users at once:
>
> - **The root frame is cheap:** 5,579 gas for one root, 8,010 for two (the second is an association set's root), measured on chain 8141 and on a local ethrex `64b8fc09` chain.
> - **Pending withdrawals survive new deposits.** On local ethrex `64b8fc09` and `247e2dd2` chains, six prepared withdrawals all stayed valid after a deposit (a new root), after another withdrawal landed (a new root, a balance change and a consumed key), and after 20 more blocks. A static check of our validator finds no reachable `SLOAD`, `BALANCE`, `EXTCODE*`, `TIMESTAMP` or `NUMBER`: only calls to the pure BN254 precompiles. Mass invalidation through the pool's state isn't possible, because validation doesn't read it. [Results](https://github.com/jatinsahijwani/relayless-ethglobal/tree/main/research/shared-sender).
> - **It composes with compliance.** Our association-set pools carry a second tuple for the approved set's root, from the same contract, so the set's provider never touches the pool's validation.
>
> Without recent roots, a privacy pool has to read its root from its own storage in validation, which ties every pending withdrawal to the next deposit. We'd like to see EIP-8272 scheduled with EIP-8141.

---

## Notes for the author
- **The README link** to the `research/shared-sender` results works only once that branch is merged to `main`. Until then, link the PR instead.
- **Tone check:** both posts state what we built and measured, and ask only for scheduling. Neither claims the pool design is ours: it follows soispoke's minimal-shielded-pool, which already uses both EIPs. If you want to say so explicitly, add: "The pool design follows soispoke's minimal-shielded-pool; we add an association-set layer and the alt mempool path."
- If either thread has moved on to a specific open question (for example the recent-root window length, or key scoping to the payer), answer that instead of posting general support.
