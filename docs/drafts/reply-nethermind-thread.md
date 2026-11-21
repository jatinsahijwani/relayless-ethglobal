# Draft: reply to "A privacy pool on frame transactions: what works, and the case that does not yet"

**Not posted.**

| | |
|---|---|
| **Where** | Reply to the original post, at the bottom of https://ethresear.ch/t/a-privacy-pool-on-frame-transactions-what-works-and-the-case-that-does-not-yet/26223 |
| **Order** | **1st of 5.** Post this first, on day 0 |
| **Then** | The MATCHA reply the next day (day 1), the EIP-8250 post on day 2, the EIP-8272 post on day 3, and the ethresear.ch post on day 5 |
| **Thread state** | Re-read 2026-11-22: 4 posts, the latest on 2026-11-10. Nobody has posted since our first draft |

Two versions follow. Use the full one if the account can post links. Use the short one, with two links, if a new account is link-limited.

## Full version
---

Thanks for the careful numbers. Here's a second data point from a different pool with the same frame shape, running on the Hegotá privacy testnet (chain 8141, ethrex `64b8fc09`): [Relayless](https://github.com/jatinsahijwani/relayless-ethglobal). The pool is the sender, the nullifier hash is the EIP-8250 key, the root arrives in an EIP-8272 frame, and validation reads no storage. The design follows soispoke's pool. What I added is change notes, an optional association set, and a *k*-gate (at least *k* leaves after yours, checked in the proof).

**A withdrawal on chain 8141 used 916,820 gas** ([tx](https://dora.privacy.ethrex.xyz/tx/0x543a9ad335af2202d696d9bdae7c242c30f952f44f06b9eb512dbdfc24236ed8)), against your 679,322:

| Part | Relayless | Your post |
|---|---|---|
| Recent-root frame | 5,579 | 5,515 |
| Pool VERIFY | 207,913 + 97,920 state (one nullifier key) | 210,139 + 195,840 state (two keys) |
| Settlement | SENDER 193,729 + 379,440 state | settle 25,526 + claim 198,338 |
| Refund frame | 9,967 | none |
| Outside the frames | 22,272 | 43,964 |
| **Total** | **916,820** | **679,322** |

The 237,498 difference is almost all settlement (+349,305). A cheaper VERIFY frame (−100,146, of which 97,920 is spending one key instead of two) and less gas outside the frames (−21,692) offset part of it. My refund frame adds 9,967.

Why my settlement costs more:
- **Change notes.** The SENDER frame inserts the change note into a Poseidon tree in the EVM. That's new storage (the leaf, and a tree level when the depth grows) plus the hashing.
- **The *k*-gate.** It needs the root to commit to the tree's size, so the pool publishes `Poseidon(root, leafCount)` as a recent root. That's why the tree lives on chain at all.
- **The fresh recipient.** The other 183,600 of state is the new account, which your claim frame pays too.

A pool without change notes or a *k*-gate needs none of it. The association set isn't part of this figure, because that pool doesn't use one. Measured locally on the same client, one costs little: the root frame carries two roots (8,010 instead of 5,579), and VERIFY uses 208,080 instead of 207,913.

**Validation budget.** I compressed my 7-value statement to 3 public signals with the same hybrid scheme (eprint 2025/1500). On chain 8141 that took the pool's VERIFY frame from 233,383 to 207,913, and the declared validation from 308,100 to **268,100** (8,000 root frame, 260,000 pool VERIFY, 100 signature). 213,492 is used. That's under Nethermind's 300,000 default, and over the 250,000 your re-run found holds one attacker peer at 25 ms. The VERIFY limit sits about 50,000 above use because one limit serves my ragequit too.

**ERC-8421 admission.** Through the ERC-8421 reference sidecar, with per-entity budgets (BUDGET-010), a staked pool is admitted with 227,598 gas of validation against a 1,000,000 staked budget. The public gateway refuses the same transaction, because its 100,000 cap runs before stake is looked up and it treats precompiles as undeployed code. The fixes are up as [PR #9](https://github.com/forshtat/mempool-workshop-sidecar/pull/9) and issues [#10](https://github.com/forshtat/mempool-workshop-sidecar/issues/10) and [#11](https://github.com/forshtat/mempool-workshop-sidecar/issues/11). The shared sender's reputation is the harder part, and the [results](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/research/shared-sender/RESULTS.md) cover conflicts across nodes, replacement spam and draining, on the sidecar and on ethrex with and without MATCHA. Without a replacement-counting fix, ten fee bumps of one note cost the pool ten `seen` for one inclusion; with the fix, one. One note sent in two versions to two nodes still leaves the node that didn't mine it at `seen 3, included 0` for three pairs.

Also on chain 8141: a double spend refused by the node's simulation before broadcast, three withdrawals from the one sender pending at once and mined in one block ([tx](https://dora.privacy.ethrex.xyz/tx/0x7dabc6e6d7d93be1e2a589f1458b0cce291cc8589b9eef7d19daadc134181e1b)), and a public exit to the depositor ([tx](https://dora.privacy.ethrex.xyz/tx/0x7d6d3ffb622f6787e51bcf6c5ea5d7b506db0597caf29e99a365aa0d98e15897)).

On your open case, a pool paying for a call from the user's own address: I don't solve it either, and I agree it doesn't fit the current drafts.

---

## Short version (two links)
---

Thanks for the careful numbers. Here's a second data point from a different pool with the same frame shape, on the Hegotá privacy testnet (chain 8141, ethrex `64b8fc09`). The pool is the sender, the nullifier hash is the EIP-8250 key, the root arrives in an EIP-8272 frame, and validation reads no storage. The design follows soispoke's pool; I added change notes, an optional association set and a *k*-gate (at least *k* leaves after yours, checked in the proof).

**A withdrawal on chain 8141 used 916,820 gas** ([tx](https://dora.privacy.ethrex.xyz/tx/0x543a9ad335af2202d696d9bdae7c242c30f952f44f06b9eb512dbdfc24236ed8)), against your 679,322:

| Part | Mine | Yours |
|---|---|---|
| Recent-root frame | 5,579 | 5,515 |
| Pool VERIFY | 207,913 + 97,920 state (one key) | 210,139 + 195,840 state (two keys) |
| Settlement | 193,729 + 379,440 state | 25,526 + 198,338 |
| Refund frame | 9,967 | none |
| Outside the frames | 22,272 | 43,964 |

The 237,498 difference is settlement (+349,305), offset by VERIFY (−100,146) and outside the frames (−21,692). My SENDER frame inserts the change note into an on-chain Poseidon tree and publishes `Poseidon(root, leafCount)` as a recent root, because the *k*-gate needs the root to commit to the tree's size. The other 183,600 of state is the fresh recipient's account. An association set isn't in this figure; measured locally, one adds 2,431 to the root frame and 167 to VERIFY.

**Validation budget.** Compressing my statement to 3 public signals (eprint 2025/1500) took VERIFY from 233,383 to 207,913, and the declared validation from 308,100 to 268,100, with 213,492 used. That's under Nethermind's 300,000 default, and over the 250,000 your re-run found holds one attacker peer at 25 ms.

**ERC-8421 admission.** Through the reference sidecar with per-entity budgets, a staked pool is admitted with 227,598 gas of validation against a 1,000,000 budget; the public gateway refuses it (a 100,000 cap applied before stake, and precompiles counted as undeployed). On reputation, ten fee bumps of one note cost the pool ten `seen` for one inclusion until the counting is fixed, and a note sent to two nodes leaves the non-mining one at `seen 3, included 0` for three pairs. Full results, with the chain 8141 links: [RESULTS.md](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/research/shared-sender/RESULTS.md).

On your open case, a pool paying for a call from the user's own address: I don't solve it either, and I agree it doesn't fit the current drafts.

---

## Notes
- **Deleted:** the sentence about a 235,000 VERIFY limit for `hegota-8141`. It was calculated, never measured, and isn't a change I'm making.
- **Every number is measured.** Mine are from the chain 8141 receipt (`docs/testnet-runs/2026-11-17-v2.json`, `hegota-8141`), except:
  - the association-set deltas, which are local `hegota-8141` runs on ethrex `64b8fc09` (`docs/gas-report.md`);
  - the ERC-8421 figures, which are `devnet-8421` (ethrex `9aa3645d` plus the reference sidecar, `research/shared-sender/RESULTS.md`).

  Theirs are from the post, re-read on 2026-11-22. The breakdown sums exactly to 237,498: settlement +349,305, VERIFY −100,146, outside the frames −21,692, refund frame +9,967, root frame +64.
- **The short version's "2,431" and "167"** are subtractions of measured values (8,010 − 5,579 and 208,080 − 207,913).
- **Links:** the full version has 8 (the repo, three chain 8141 transactions, the PR, two issues, RESULTS.md). The short version has two: the withdrawal and RESULTS.md, which links everything else.
- **The author asked readers** whether the own-address flows match what we see from pool users. Relayless has no users, so don't answer that.
