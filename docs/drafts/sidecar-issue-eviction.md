# Draft: sidecar issue, don't count an eviction caused by the sender's own consumed nonce key

**Not sent.** For the author to review and open as an issue on `forshtat/mempool-workshop-sidecar`. It's an issue, not a PR, because it reads ERC-8421 in a way the authors may not share, and the right fix may belong in the ERC.

## Title
`Reputation: a pending transaction evicted because its own nonce key was consumed on chain shouldn't count against the sender`

## Body

**The situation.** A sender's transaction is pending on node B. A conflicting transaction from the same sender (same `nonce_keys`, same `nonce_seq`) reaches a different node A and is mined. B never admitted the mined one. On the next block, B revalidates its pending transaction, which now fails on the nonce, and marks it `Cancelled` (`BundlingService/reconciliation.ts`, `reconcileNew`). Its `seen` stays and `included` never comes, so on B the sender looks like it sent a transaction that never landed.

**Why that's wrong for the sender.** The key's consumption proves the sender *did* get a transaction for that key included: exactly one of the two conflicting transactions could ever land (LIFECYCLE-020), and one did. ERC-8421 already says this for the propagation case:

> **[PROPAGATION-040]** A node silently drops a transaction that conflicts ([LIFECYCLE-020]) with a transaction recently included in a block. This is almost certainly a network race. It causes no reputation change.

The pending case is the same race, seen one block later. REPUTATION-310 is in the same spirit: an entity shouldn't lose reputation for something that isn't its failure.

**Why it matters most for shared senders.** With EIP-8250 keyed nonces one sender can serve many independent users. A privacy pool is the example: every user's withdrawal is the pool's transaction, under a fresh nonce key. Any one user can send two versions of the same withdrawal to two nodes. Without gossip between them, every node that didn't mine it charges the pool one `seen` with no `included`, and that `seen` stands for a transaction that was in fact included elsewhere.

**Measured.** Local devnet, ethrex `9aa3645d`, two sidecar instances with no gossip between them, with the replacement-counting fix applied. Two notes, each sent as conflicting transactions to both nodes:

| | `seen` | `included` |
|---|---|---|
| Mining node | +2 | +2 |
| Non-mining node | **2** | **0** |

At ERC-8421's thresholds, a sender is throttled at about 110 such conflicting pairs and banned at about 510, per non-mining node (calculated, not run to completion). Each pair costs the attacker one real withdrawal's fee.

**Proposed change.** When revalidation fails, check whether the entry's own nonce key was consumed: for any key in `entry.tx.nonceKeys`, `current_nonce_seq(sender, key) > entry.tx.nonceSeq`. If so, drop the entry without a reputation change, as PROPAGATION-040 does: undo the `seen` its admission added for each entity (`removeSeenStatus`, from the replacement-counting PR). A sketch:

```ts
// reconcileNew, in both the "no longer compliant" branch and the catch
if (await this.ownNonceKeyConsumed(entry)) {
  await this.reputationCheck.undoSeen(entry);            // inverse of updateSeenStatus, never below zero
  await this.mempoolService.updateStatus([entry], MempoolEntryStatus.Cancelled, {
    revertReason: "a conflicting transaction from the same sender was included (PROPAGATION-040)",
  });
  continue;
}

private async ownNonceKeyConsumed(entry: FrameTxMempoolEntry): Promise<boolean> {
  for (const key of entry.tx.nonceKeys) {
    if ((await this.nonceManager.currentSeq(entry.tx.sender, key)) > entry.tx.nonceSeq) return true;
  }
  return false;
}
```

The check reads one storage slot per key, only for entries that already failed revalidation.

**What it doesn't let through.** An entry that fails for any other reason (a bad proof, an expired root, a changed balance) is charged exactly as today. A sender can't use this to hide failures: the exemption applies only when one of its own transactions for that key was included, which is the outcome the reputation system wants to reward. A replacement on the *same* node is already covered by REPUTATION-040.

**Alternative.** Credit `included` instead of undoing `seen`. It's the same for `inclusionRate`, but it inflates `included` for transactions the node never admitted. Undoing `seen` matches PROPAGATION-040's "no reputation change" more closely.

**Questions for the authors.** Is this the intended reading of PROPAGATION-040 for pending transactions? If yes, should the ERC say it in LIFECYCLE-040 or the REPUTATION rules too?

## Notes for the author
- The measurement is from Stage 1 (`scripts/grief-experiment.ts`, two sidecars, no gossip). The Part D harness re-runs it, so check `research/shared-sender/RESULTS.md` for current numbers before sending, and update the table if they differ.
- The throttle and ban counts come from `docs/reputation-analysis.md`, and are calculated.
- `nonceManager.currentSeq` in the sketch is illustrative. The sidecar reads keyed nonces through its existing frame-transaction code, which the real change should reuse.

## Command
```sh
gh issue create --repo forshtat/mempool-workshop-sidecar \
  --title "Reputation: a pending transaction evicted because its own nonce key was consumed on chain shouldn't count against the sender" \
  --body-file <the Body section above, saved to a file>
```
