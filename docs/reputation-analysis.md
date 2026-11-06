# Reputation analysis: how a Relayless tx can be admitted but not mined

**Why this matters.** Every withdrawal uses one shared sender and payer: the pool. A mempool node raises the pool's `seen` count when it admits a transaction and `included` when it sees it mined. If the pool falls too far behind, it gets throttled or banned, and that hits **every user at once**. So a Relayless transaction that is admitted must then get mined, and its validity must not depend on fast-changing state.

Unless marked otherwise, the numbers come from the sidecar source and from runs on a private local stack (ethrex `9aa3645d` plus patched sidecar). See [How this was measured](#how-this-was-measured).

## The rules as implemented
Reputation is **per node**. `floor(seen / 10)` is compared against `included`:

| Status | Condition | Effect |
|---|---|---|
| `ok` | otherwise | normal |
| `THROTTLED` | `floor(seen/10) > included + 10` | at most 4 entries in the mempool |
| `BANNED` | `floor(seen/10) > included + 50` | refused, and the error text can be misleading |

From a clean start with nothing included, that means `seen ≥ 110` to throttle and `seen ≥ 510` to ban. `seen` and `included` decay linearly over 24 hours.

## Every way it can happen

| # | Cause | Who triggers it | Status | Mitigation |
|---|---|---|---|---|
| 1 | **Note owner sprays conflicting withdrawals across nodes** | Note owner | **Open; bounded** | See [Griefing](#griefing-by-a-note-owner) |
| 2 | **Note owner sprays fee bumps at one node** | Note owner | **Open; bounded** | See [Griefing](#griefing-by-a-note-owner) |
| 3 | Same seed on two devices spends one note on each | Honest user | Reduced | The in-flight ledger is per device, and the on-chain spent check runs first. A race remains possible, and behaves like #1 with one extra `seen` |
| 4 | App retries after a failed request or a reload | Honest user | Prevented | One nullifier, one pending tx. `submit` never retries, and only `bumpFee` can resend |
| 5 | Impatient fee bumps | Honest user | Reduced | `bumpFee` refuses during the first 120 s. Generous fees should make bumps rare |
| 6 | Base fee rises above the max fee | Network | Reduced | Default max fee is 10× base fee, at least 1 gwei, refunded when unused. If the optional fee range is on, a spike above its ceiling stalls withdrawals |
| 7 | Pool balance can't cover pending obligations (`enforceBalances` cancels newest first) | Anyone | Prevented in normal operation | Fees come out of the note, and `maxCost ≤ fee ≤ amount`, so pending obligations stay below what notes hold. Gas reserve as a buffer. The SDK checks solvency before sending |
| 8 | Referenced root expires | Time | Prevented in normal operation | Always proves against the latest root, so about 13.6 hours of life. `republishRoot()` keeps a quiet pool usable. Entries near expiry aren't relayed |
| 9 | Another withdrawal changes state this one depends on | Other users | **Prevented by design** | Validation reads no storage. The root is a reference, and the verifying keys are in code. 4 of 4 pending landed together |
| 10 | Proof or tx is invalid | Buggy client | Prevented for the SDK | Simulated before broadcast. A failing tx is never sent |
| 11 | Stake is withdrawn, dropping staked status | Operator | **Prevented by design** | The pool has no function that can unlock its stake |
| 12 | Pool code changes | Operator | **Prevented by design** | No proxy, no owner, no `SELFDESTRUCT` |
| 13 | Node gives up relaying (3 attempts, then `Cancelled`), or the 300 s TTL ends | Node, congestion | **Open** | Not ours to control. Each one counts. Keep the tx small enough to fit in blocks: about 3M declared gas against a 60M block limit |
| 14 | Node restarts and loses its mempool | Node | **Unknown** | Whether `seen` survives without the tx hasn't been tested |
| 15 | Reorg removes a referenced root | Chain | Unlikely on this devnet | The node evicts on revalidation. Using a root a few slots older would reduce this, at the cost of slightly less life |
| 16 | Second node never learns the tx was mined | Node topology | **Measured** | See below. A non-mining node ended at `seen 2, included 0`, and the experiment's nodes weren't gossiping |

**A failed SENDER frame is a separate problem:** it's still mined, so reputation is fine, but the user loses the note. That's why the SENDER frame cannot revert after APPROVE:
- A refused payment becomes a claim.
- A bad change leaf is skipped.
- A failed root write is logged and doesn't stop the withdrawal.
- The recipient gets bounded gas, with no return data copied.
- Minimum frame gas is enforced by the validator: 1.5M execution against a measured worst case of 812k under Foundry's gas costs.

Fuzz tests and adversarial-recipient tests cover this in `packages/contracts/test/`.

## Griefing by a note owner
**The attacker** holds a valid note and doesn't care about losing the fee. A proof takes about 2 seconds and can be prepared in advance. Nobody can tell a griefer from a user with bad luck, since every transaction carries a valid proof.

### Measured
| Experiment | Result |
|---|---|
| One note, 8 replacements, one node, **before the fix** | Accepted 8 of 8 in **278 ms**: `seen` 0 → 8, then `included` 1 once one landed |
| Same attack, **after the fix** | Accepted 8 of 8 in 221 ms: `seen` 0 → **1**, then `included` 1 |
| Same note to two nodes (2 notes), after the fix | Both nodes admitted both. Mining node: `seen +2, included +2`. Non-mining node: **`seen 2, included 0`** |
| Honest full e2e, one deliberate bump, before the fix | Settled at `seen 9, included 8` |

**Confirmed prototype bug, fixed in our patch:** `addFrameTx` called `updateSeenStatus` for replacements as well, while ERC-8421's REPUTATION-040 says *"Admitting a replacement is not a new occurrence of `seen`."* The alt mempool authors confirmed this is a bug in the prototype, not ERC-8421 behaviour. **With our fix, the same 8-bump attack moves `seen` from 0 to 1**, not 8. The public gateway doesn't have this fix. See [upstream-pr.md](upstream-pr.md).

### How much it takes
Calculated from the formulas above, **not run to completion**. Gas: a deposit is about 0.6–0.9M, a withdrawal about 0.9M.

| Scenario | Seen per note | To throttle | To ban |
|---|---|---|---|
| Bumps on a node with the bug (the public gateway), no fee range, 0.5 ETH note, max fee starting at 8 wei | ~248 | 1 note | 3 notes |
| Bumps on a node with the bug, optional 1–8 gwei fee range on, non-mining node | 23 | 5 notes | 23 notes |
| Bumps on a node with the bug, optional 1–8 gwei fee range on, mining node (each note adds 1 `included`) | 23 | 8 notes | 39 notes |
| **With our fix: across nodes only**, per non-mining node | 1 | **110 notes** | **510 notes** |

Since `seen` decays over 24 hours, an attacker has to sustain this. On a chain with real fees, 510 notes is about 800M gas. At the devnet's 7 wei base fee, the economic cost is close to nothing. **Today's mitigations raise the effort but don't make griefing uneconomic**, and honest `included` traffic only helps on nodes that observe it.

### What we did
- **Minimum deposit of 0.01 ETH**, so each spray note needs capital and gas.
- **The SDK refuses to do any of this.** A modified client isn't bound by that.

### The optional fee-bump limit
Off by default. Build the validator with `RELAYLESS_FEE_RANGE=<min wei>:<max wei>` to reject max fees outside a fixed range. A replacement must raise the fee by 10%, so 1–8 gwei allows at most about 22 replacements per note, down from about 248.

| | Off (default) | On |
|---|---|---|
| Griefing with the replacement bug | Throttle in 1 note, ban in 3 | Throttle in 5, ban in 23 (non-mining node) |
| Griefing once the bug is fixed | No effect | Little benefit |
| Base fee above the ceiling | Withdrawals still land | **All withdrawals stall until it falls** |
| Fee policy | Set by the market | Fixed in the validator's code; changing it means a new pool |

It's off because our patch fixes the bug it works around, while its cost is a liveness risk for every user. Turn it on only for a pool running against a node that still has the bug, and that can't tolerate griefing.

### What can't be fixed from the pool
The pool can't see the mempool, and validation can't read anything that would reveal a spray without losing concurrency. These need rule or node changes, proposed for the authors:

1. **Fix the replacement bug upstream.** Done in our patch, and it removes attack #2. [Write-up](upstream-pr.md).
2. **Don't blame the sender when a pending tx is evicted because its own nonce key was consumed on chain.** The key's consumption proves the sender *did* get a transaction included. Decrement `seen` in that case, or credit `included`. This removes most of attack #1, in the spirit of REPUTATION-310.
3. **Credit `included` across nodes.** A node that sees the pool's transactions mined could count them even when it didn't admit those particular ones, so `included` reflects the pool's real activity.
4. **Consider a shared-sender allowance:** a pool's many independent users make it unlike a single misbehaving entity. Whether this is safe is an open question for the authors.

### If the pool does get throttled
Withdrawals still work at up to 4 pending per node. Users can try another node. **If banned, ragequit goes through the same pool sender, so it's blocked at that node too**, and funds are only delayed: `seen` decays within 24 hours, and a different node has its own counters.

## Known limits of this analysis
- Local stack only: the public gateway can't admit these transactions yet.
- Two nodes, not gossiping. Real gossip could change #1 and #16 in either direction.
- Throttle and ban thresholds were calculated, not reached in a run.
- Cases #13 and #14 weren't reproduced.

## How this was measured
- `scripts/grief-experiment.ts` (attacker's view, SDK safeguards bypassed; refuses to run against anything but localhost)
- `scripts/e2e.ts`
- Sidecar source: `MempoolService/service.ts`, `MempoolService/reputation.ts`, `entities/ReputationEntry.ts`
