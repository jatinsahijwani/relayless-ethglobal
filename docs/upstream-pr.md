# Upstream fix: replacements must not count as `seen`

For the alt mempool team. The alt mempool authors have confirmed this is a prototype bug, not ERC-8421 behaviour.

## The bug
`MempoolService.addFrameTx` calls `updateSeenStatus` after both of its branches, so every replacement counts as a new admission. ERC-8421's REPUTATION-040 says: *"Admitting a replacement is not a new occurrence of `seen` for any unchanged entity."*

**Why it matters:** `seen` drives throttling and banning. One sender can inflate its own, or a shared sender's, count with fee bumps while only one transaction is ever mined. For a pool where many users share a sender, one note owner can throttle everyone.

## The fix
- **`service.ts`:** a live replacement calls `updateSeenOnReplacement`; everything else calls `updateSeenStatus` as before. An entry already `Cancelled` or `Reverted` no longer holds its slot, so resubmitting after one still counts as new.
- **`reputation.ts`:** `updateSeenOnReplacement` does nothing for an unchanged entity. If the payer or factory changes, the old address loses 1 and the new one gains 1, as the rule requires.
- **`ReputationService.ts`:** adds `removeSeenStatus`, which never goes below zero.

## Measured
Local stack, ethrex `9aa3645d`, on a fresh pool. One note, 8 replacements sent in a burst to one node:

| | Accepted | `seen` | `included` once landed |
|---|---|---|---|
| Before | 8 of 8, in 278 ms | 0 → **8** | 1 |
| After | 8 of 8, in 221 ms | 0 → **1** | 1 |

Fee bumps themselves still work.

## Tests
- New: `test/services/MempoolService/replacementSeen.test.ts`, 7 tests. With the fix disabled, the fee-bump test fails.
- The mempool, validation and `eth` suites pass: 213 of 213. The sidecar's full suite wasn't run.

## The patch
[`patches/sidecar-budget-010.patch`](../patches/sidecar-budget-010.patch), against `2e22ff0a`. **It combines two changes:** this fix and per-entity budgets (BUDGET-010, see [repro-gateway.md](repro-gateway.md)). They touch different code, and I'd split them into two PRs.

## Not fixed by this
A pending transaction evicted because its own nonce key was consumed on chain still counts against the sender on nodes that didn't see it mined. Measured with the same conflicting transaction sent to two nodes (no gossip between them): the mining node ended at `seen 3, included 3`, the other at `seen 2, included 0`. **Proposal:** don't count it, because a consumed key proves that sender did get a transaction included. Details: [reputation-analysis.md](reputation-analysis.md).

## Separate issue: ethrex loses block numbers
This one is for ethrex, not the sidecar, and **I don't know the cause**.

- **Seen:** on 2 of 2 fresh chains from `deploy/devnet/docker-compose.yml`, blocks from about 149 lost their number lookup (149–155, then 149–154).
- **Symptoms:** `eth_getBlockByNumber` returns `null` for those heights, and `eth_getLogs` over any range touching them errors with `Could not get header for block 149`. Ranges on either side work.
- **What's normal:** the blocks executed normally according to the logs, and slots continue in sequence across the gap. One run also logged `Block body for block number 154 is missing but is below the latest known block`.
- **Timing:** about 15 minutes after genesis, at nearly the same height both times.
- **Repro:** bring up the stack, wait about 15 minutes, then scan block numbers for `null`.
