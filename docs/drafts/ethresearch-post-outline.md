# Draft: ethresear.ch post

**Not posted.** Outline, then a first draft. Every number is from `research/shared-sender/RESULTS.md` or our chain 8141 runs; re-check them before posting.

**Title:** Shared senders in alternative mempools: reputation, MATCHA and griefing, from a working privacy pool

## Outline
1. **The question.** EIP-8250 lets one sender serve many independent users: a privacy pool is the clearest case. Mempool protections were designed for senders acting for themselves. What happens when one user of a shared sender misbehaves?
2. **The sender we measured.** Relayless on chain 8141: pool as sender, nullifier as nonce key, EIP-8272 roots, validation reads no storage. 916,820 gas per withdrawal, 268,100 declared validation. Credit the design to soispoke's pool.
3. **The harness and its limits.** Four targets, the same attacks, one command each. Dev mode, single ethrex nodes, two sidecars without gossip, finality lag patched in.
4. **ERC-8421 reputation:** replacement spam (the bug, and the fix), conflicts across nodes (the eviction gap).
5. **MATCHA width:** calibration for a privacy withdrawal, bootstrap, honest bursts and revalidation charges, replacement draining.
6. **Mass invalidation doesn't apply** to a sender that reads no state, measured and static, and what that means for both mechanisms.
7. **Comparison table** and how the two interact.
8. **Recommendations:** the four concrete changes.
9. **Open questions** for the authors.
10. **Credits and links.**

## First draft

### Shared senders in alternative mempools: reputation, MATCHA and griefing, from a working privacy pool

*Thanks to soispoke for minimal-shielded-pool and MATCHA, to the Nethermind team (Daniil Ankushin, Manuel Arto) for their privacy-pool measurements, to mmjahanara for the validation-budget work, to namnc for the frame layout we started from, and to nero_eth for the three gates. Errors are ours.*

**TL;DR.** We attacked one shared sender, a privacy pool on chain 8141's frame-transaction stack, the way its own users could, against an ERC-8421 sidecar (with and without a replacement-counting fix), ethrex `64b8fc09` (chain 8141's client, no width budget) and ethrex `247e2dd2` (MATCHA). Neither mechanism can tell one user of a shared sender from another, so each user's misbehaviour lands on everyone. On an unfixed ERC-8421 sidecar, 10 fee bumps cost the pool 10 `seen` for 1 inclusion. On MATCHA, four users bumping 20 times spent 9.2M of the pool's width (21 charges) for the price of four withdrawals. Neither defends against mass invalidation for this sender, because there's nothing to defend: its validation reads no state another transaction can change. We propose four changes.

**The sender.** [Relayless](https://github.com/jatinsahijwani/relayless-ethglobal) follows soispoke's [minimal-shielded-pool](https://github.com/soispoke/minimal-shielded-pool): the pool is the frame transaction's sender and pays gas from the note, the nullifier hash is the EIP-8250 nonce key at sequence 0, and the root arrives in an EIP-8272 frame. On chain 8141 a withdrawal to a fresh 0-ETH address costs 916,820 gas and declares 268,100 of validation; three withdrawals from the one sender were pending at once and landed in one block. Validation reads no storage: walking the validator's reachable bytecode finds only calls to the BN254 precompiles.

**Setup.** *(the setup table from RESULTS.md, shortened)* and its limits: dev mode, blocks never full, single ethrex nodes, two sidecars without gossip. MATCHA credits width at finality and dev mode finalizes every block, so we patched the dev producer to trail by 64 blocks.

**ERC-8421: the shared sender's reputation.**
- *Replacement spam.* Without the fix, 10 bumps of one note: `seen` +10, `included` +1. Four holders bumping 5 times each: `seen` +22, `included` +6. This contradicts the ERC's REPUTATION-040 and the sidecar's authors agreed it's a prototype bug. With our fix, the same 10 bumps count once (`seen` +1), the 20-bump burst counts +6, and a full run ends at `seen 34` instead of `59` for the same 32 inclusions.
- *Conflicts across nodes.* The same note sent in two versions to two nodes: the node that mined ends `seen +3, included +5`; the node that didn't ends **`seen 3, included 0`**, with or without the fix. Each of those three keys was in fact consumed by a transaction from this sender. ERC-8421's PROPAGATION-040 already says a received transaction that conflicts with a recently included one "causes no reputation change"; we propose the same for a pending one evicted for that reason.

**MATCHA: the shared sender's width.**
- *Calibration.* One additional pending withdrawal is charged about 438,550 width (1.5 × about 292,000 of admission work). One landed withdrawal credits about 994,000 at finality. So a pool earns about two concurrent withdrawals per landed one, and the 30M cap allows about 68.
- *Bootstrap.* A new pool: 1 of 3 concurrent withdrawals admitted. Width appeared only 66 blocks after each landing.
- *Honest bursts pay revalidation.* Six honest withdrawals at once cost 8 charges, not 5: three were still pending at the next forkchoice.
- *Replacement draining.* A baseline pending, then four holders bumping five times each in one burst: all 20 accepted; width 20.5M → 11.3M, 21 charges. The 16 replaced versions never land, so they never earn width back and cost their senders nothing. About 47 free replacements would empty a 20.5M pool (*calc.*), and every honest withdrawal beyond the baseline then waits for finality.
- *Spam is bounded, but by the shared budget.* 10 bumps of one note with a baseline pending: 1 accepted, 9 refused at 27,380 width, which also left no width for anyone else.

**Mass invalidation.** Six prepared withdrawals stayed valid through a deposit, another withdrawal landing and 20 blocks, on all four targets, and parked on the non-mining sidecar they stayed `New`. Statically, nothing in validation reads state another transaction can change. For such a sender MATCHA's revalidation charge pays for an attack that can't happen.

**Comparison.** *(the "what each protects against" table from RESULTS.md)*

**Recommendations.**
1. Sidecar: merge the REPUTATION-040 fix. [draft PR]
2. ERC-8421: no reputation change for an eviction caused by the sender's own consumed nonce key. [draft issue]
3. MATCHA: no (or a reduced) revalidation charge for a sender whose validation reads no state another transaction can change; the node can tell from the trace it already records.
4. MATCHA: price replacements of additional transactions above a fresh admission, or limit replacements per key, since a replaced version never earns width back.

**Open questions.**
- Is recommendation 3 safe against a sender whose validation is state-free today but upgradeable? (Ours is immutable.)
- Should a shared sender's reputation and width be partitioned by nonce key or by payer? Ankushin's contention-indexed width asks a version of this.
- What happens with real gossip between sidecars: does propagation make the cross-node conflict worse or better?

**Reproduce.** `research/shared-sender/` — one command per target. Raw JSON in `results/`.

## Notes for the author
- Don't post before the reply-thread drafts have gone out: this post cites both conversations.
- The `RESULTS.md` link needs the research branch merged; until then, link the PR.
- Keep the credits line. Check each handle's spelling on the forum before posting (they're forum handles, not GitHub logins).
