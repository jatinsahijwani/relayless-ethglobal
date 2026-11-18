# Draft: reply to "A privacy pool on frame transactions: what works, and the case that does not yet"

**Not posted.** For the author to review and post at https://ethresear.ch/t/a-privacy-pool-on-frame-transactions-what-works-and-the-case-that-does-not-yet/26223

Their figures are quoted from the post as read on 2026-11-17. Ours are from chain 8141 and our local chains, linked. **Check the ERC-8421 numbers against `research/shared-sender/RESULTS.md` before posting.**

---

> Thanks for the careful numbers. Here's a second data point from a different pool on the same frame shape, now running on the Hegotá privacy testnet (chain 8141, ethrex `64b8fc09`): [Relayless](https://github.com/jatinsahijwani/relayless-ethglobal). The pool is the sender, the nullifier hash is the EIP-8250 key, the root arrives in an EIP-8272 frame, and validation reads no storage. The design follows soispoke's pool; what differs is change notes, an optional association set and a *k*-gate (at least *k* leaves after yours, checked in the proof).
>
> **A withdrawal on chain 8141: 916,820 gas** ([tx](https://dora.privacy.ethrex.xyz/tx/0x543a9ad335af2202d696d9bdae7c242c30f952f44f06b9eb512dbdfc24236ed8)), next to your 679,322:
>
> | Part | Relayless | Your post |
> |---|---|---|
> | Recent-root frame | 5,579 | 5,515 |
> | Pool VERIFY | 207,913 + 97,920 state (one nullifier key) | 210,139 + 195,840 state (two keys) |
> | Settlement | SENDER 193,729 + 379,440 state | settle 25,526 + claim 198,338 |
> | Refund frame | 9,967 | none |
> | Outside the frames | 22,272 | 43,964 |
> | **Total** | **916,820** | **679,322** |
>
> The 237,498 difference is almost all settlement (+349,305), partly offset by a cheaper VERIFY frame (−100,146, of which 97,920 is spending one key instead of two) and less outside the frames (−21,692). Our refund frame adds 9,967. Our SENDER frame keeps the Merkle tree on chain: it inserts the change note into a Poseidon tree in the EVM and publishes `Poseidon(root, leafCount)` as a recent root, because the *k*-gate needs the root to commit to the tree's size. That's two new storage slots (195,840 state) plus the Poseidon hashing; the other 183,600 state is the fresh recipient's account, which your claim frame pays too. A pool without change notes or a *k*-gate doesn't need any of it. An association set costs little on top: with one, the root frame carries two roots (8,010 instead of 5,579) and VERIFY uses 208,080 instead of 207,913, measured locally on the same client.
>
> **Validation budget.** We compressed our 7-value statement to 3 public signals with the same hybrid scheme (eprint 2025/1500), which saved 25,470 gas of verification on chain 8141 (pool VERIFY 233,383 → 207,913). We now declare 268,100 (8,000 root frame, 260,000 pool VERIFY, 100 signature) and use 213,492. That's under Nethermind's 300,000 default. **It's over the 250,000 your re-run found holds one attacker peer at 25 ms**, where your 233,000 fits. Our declared VERIFY limit has about 50,000 of headroom over use, because one limit serves our ragequit too (239,512 on our devnet profile); a limit of 235,000 for this profile would bring us to 243,100. We'll measure whether that holds before changing it.
>
> **ERC-8421 admission.** On the alternative-mempool path the picture is different again. Through the ERC-8421 sidecar with per-entity budgets (BUDGET-010), a staked pool is admitted with 227,598 gas of validation against a 1,000,000 staked budget. The public gateway refuses the same transaction, because its 100,000 cap runs before stake is looked up, and precompiles count as undeployed code. We have fixes ready for both. The shared sender's reputation is the harder part: [results](https://github.com/jatinsahijwani/relayless-ethglobal/tree/main/research/shared-sender/RESULTS.md) for conflicts across nodes, replacement spam and draining, on the sidecar and on ethrex with and without MATCHA. Without a replacement-counting fix, ten fee bumps of one note cost the pool ten `seen` for one inclusion; with it, one. A note sent in two versions to two nodes still leaves the node that didn't mine it at `seen 3, included 0` for three pairs, which is why we're proposing an eviction rule.
>
> On your open case, a pool paying for a call from the user's own address: we don't solve it either, and agree it doesn't fit the current drafts.

---

## Notes for the author
- **Every number in the table is measured:** ours from the chain 8141 receipt (`docs/testnet-runs/2026-11-17-v2.json`), theirs from the post. The breakdown sums exactly to the 237,498 difference: settlement +349,305, VERIFY −100,146, outside the frames −21,692, our refund frame +9,967, root frame +64.
- **The 235,000 limit is calculated, not measured on chain 8141.** It's flagged in `DECISIONS.md` as your decision.
- **The RESULTS link** works once the research branch is merged; until then, link the PR.
- Don't post before the sidecar results are in, so the ERC-8421 sentence carries real numbers.
