# Shared senders: ERC-8421 reputation, MATCHA width, and a privacy pool

**What this is:** the same attacks, by users of one shared sender, run against four mempools. The shared sender is a Relayless pool: every user's withdrawal is the pool's own frame transaction on its own EIP-8250 nonce key, and its validation reads no storage. How to rerun: [README.md](README.md). Raw results: [`results/`](results/).

**Measured vs calculated.** Every number in a table is **measured**, from a run on 2026-11-17, unless it's marked *calc.* (worked out from measured inputs). Throttle and ban thresholds were never reached in a run.

## Setup
| Target | What exactly | Chain |
|---|---|---|
| `sidecar-nofix` | ERC-8421 sidecar, upstream [`2e22ff0a`](https://github.com/forshtat/mempool-workshop-sidecar/commit/2e22ff0a2898e69ea4bf5275bce1be8581a8582a), plus per-entity budgets and the pure-precompile default (`sidecar-patches/2-…`). **Without** the replacement-counting fix | `devnet-8421`: ethrex `9aa3645d`, Lighthouse, 12 s slots. Pool staked (0.012 ETH) |
| `sidecar-fix` | The same, **with** the fix (`sidecar-patches/1-…` too) | The same |
| `ethrex-64b8fc09` | ethrex `64b8fc09d47d`, chain 8141's revision. Relaxed one-pending-per-sender for disjoint keys, no width budget. `--mempool.max-verify-gas 500000` | `hegota-8141` profile, dev mode, about 1 s blocks |
| `ethrex-247e2dd2` | ethrex `247e2dd2c4d4`, MATCHA on with its default policy (cap 30,000,000, safety factor 3/2, no fee floor), plus a dev-producer patch so finality trails the head by **64 blocks** | `hegota-8141` profile, dev mode, about 1 s blocks |

Common to all: a fresh wallet, 52 deposits of 0.05 ETH, withdrawals of 0.03 ETH. Sidecar targets run two instances with no gossip: **A** mines, **B** is in manual mode and never mines. Every sidecar run starts with fresh data, so reputation starts at zero. The MATCHA run deploys a fresh pool, so width starts at zero.

**Limits of the setup.** Dev-mode blocks are never full, so a transaction at an includable price lands in the next block; nothing stays pending for long unless it's parked on a node that doesn't mine. The ethrex targets are single nodes, so the cross-node case reduces to a same-fee conflict on one node. The devnet is two sidecars without gossip, which is a worst case for cross-node conflicts.

## Results

### 1. Conflicting withdrawals of one note, sent to different nodes
Three notes, each withdrawn twice to different recipients: one version to each node (sidecar), or both to the one node at the same fee (ethrex).

| | `sidecar-nofix` | `sidecar-fix` | `ethrex-64b8fc09` | `ethrex-247e2dd2` |
|---|---|---|---|---|
| Admitted | A: 3 of 3, B: 3 of 3 | A: 3 of 3, B: 3 of 3 | First: 3 of 3. Second: 0 of 3, *"Attempted to replace a pooled transaction with an underpriced transaction"* | Same as `64b8fc09` |
| Each note spent once | Yes | Yes | Yes | Yes |
| Mining node A | `seen` +3, `included` +5 (two earlier ones landed too) | `seen` +3, `included` +5 | n/a | Width unchanged (465,956): each was the free baseline |
| **Never-mining node B** | **`seen` 0 → 3, `included` 0** | **`seen` 0 → 3, `included` 0** | n/a | n/a |

**Reading:** on a node that didn't mine it, the evicted conflict counts against the shared sender as a transaction that never landed, though one transaction for that key *did* land. The replacement fix doesn't change this: it's the eviction rule ([draft issue](../../docs/drafts/sidecar-issue-eviction.md)).

### 2. Fee-bump replacement spam on one node
One note, ten versions with fees raised 15% each, sent in a burst to one node. On MATCHA, a baseline withdrawal was sent first, so the bumped one is an additional transaction.

| | `sidecar-nofix` | `sidecar-fix` | `ethrex-64b8fc09` | `ethrex-247e2dd2` |
|---|---|---|---|---|
| Accepted | 10 of 10 in 430 ms | 10 of 10 in 985 ms | 10 of 10 in 46 ms | **1 of 10.** The other 9: *"sender has 27380 MATCHA width, needs 438576"* |
| Lands | Once | Once | Once | Once |
| Cost to the shared sender | **`seen` +10, `included` +1** | **`seen` +1**, `included` +1 | Nothing tracked | 1 charge (438,576), and the pool left with 27,380 width: **no one else** gets a second pending withdrawal until finality |

### 3. Width draining
- **Below the base fee, to sit pending:** refused at admission on all three clients (*"Insufficient max fee per gas"*). It can't be parked.
- **At the cheapest includable price (1-wei tip), ten withdrawals:** all admitted and landed everywhere, and the honest withdrawal right after landed in the next block (2.0 s on ethrex, 20.2 s on the 12 s devnet).
- **What this step did not test:** the harness sends these one at a time, and each lands before the next is sent, so on MATCHA each is the free baseline and width didn't move (9,684,006 throughout). The burst case is 3b.

### 3b. Replacement draining: several holders bump at once
A baseline withdrawal pending, then four note holders each send five fee-bumped versions of one withdrawal in a single burst (20 transactions), then an honest withdrawal.

| | `sidecar-nofix` | `sidecar-fix` | `ethrex-64b8fc09` | `ethrex-247e2dd2` |
|---|---|---|---|---|
| Attack accepted | 20 of 20 | 20 of 20 | 20 of 20 | 20 of 20 |
| Honest withdrawal | Admitted at once | Admitted at once | Admitted at once | Admitted at once |
| Cost to the shared sender | **`seen` +22, `included` +6** | **`seen` +6** (the baseline, four holders, the honest one), `included` +4 when read, the rest landing after | Nothing tracked | **Width 20,507,996 → 11,298,098: 9,209,898 spent, 21 charges,** never returned |

On MATCHA, the 16 replaced versions never land, so they earn no width and cost their senders no gas. The four holders paid for four withdrawals and spent 7.0M of the pool's width (*calc.*: 16 × 438,550). A pool holding 20.5M is emptied by about 47 free replacements (*calc.*), after which every honest withdrawal beyond the one baseline waits for finality: 64 blocks here, about 13 minutes at mainnet's 12 s slots (*calc.*).

### 4. Mass invalidation
Six withdrawals prepared, then re-simulated by the target chain after each change. On the sidecar they were also parked on node B, and B's own revalidation was watched.

| After | `sidecar-nofix` | `sidecar-fix` | `ethrex-64b8fc09` | `ethrex-247e2dd2` |
|---|---|---|---|---|
| A deposit (new leaf, new root published, pool balance up) | 6 of 6 valid; on B: 6 `New` | 6 of 6; on B: 6 `New` | 6 of 6 | 6 of 6 |
| Another withdrawal landed (new root, balance down, a key consumed) | 6 of 6; on B: 6 `New` | 6 of 6; on B: 6 `New` | 6 of 6 | 6 of 6 |
| 20 more blocks | 6 of 6; on B: 6 `New` | 6 of 6; on B: 6 `New` | 6 of 6 | 6 of 6 |

**Static check** ([`results/static-check.json`](results/static-check.json)): walking the validator's reachable bytecode on both profiles finds no `SLOAD`, `SSTORE`, `TLOAD`, `BALANCE`, `SELFBALANCE`, `EXTCODE*`, `BLOCKHASH`, `TIMESTAMP` or `NUMBER`. The only calls are 18 `STATICCALL`s to the BN254 precompiles (`0x06`–`0x08`), plus one `GASPRICE` and one `CALL` in `refund()`, which runs after validation. The pool's VERIFY entry reads only immutables. A withdrawal's validity depends on its own nonce key, the recent-root window and the pool's balance covering its `maxCost`, so no single transaction can invalidate the pending set.

### 5. Honest throughput
Six honest withdrawals sent at once, before and after the attacks.

| | `sidecar-nofix` | `sidecar-fix` | `ethrex-64b8fc09` | `ethrex-247e2dd2` |
|---|---|---|---|---|
| Admitted at once, before | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| All landed, before | 25.7 s (blocks 1019–1022) | 26.5 s (blocks 1219–1221) | 2.0 s (one block) | 2.0 s (two blocks) |
| Admitted at once, after | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| All landed, after | 25.6 s | 18.2 s | 3.1 s | 2.1 s |
| Sender standing at the end | A: `seen 59, included 32`, `ok`. B: `seen 9, included 0`, `ok` | A: **`seen 34, included 32`**, `ok`. B: `seen 9, included 0`, `ok` | n/a | Width 11,948,624 |

**MATCHA's bootstrap and calibration** (`ethrex-247e2dd2` only):

| | |
|---|---|
| A fresh pool, three withdrawals at once | 1 admitted (the baseline). 2 refused: *"sender has 0 MATCHA width, needs 438558 for an additional frame transaction"* |
| Charge per additional withdrawal | 438,504–438,594 (`matchaCharge`, 12 samples) |
| Credit per landed withdrawal | Its total gas, about 994,000 (993,557 / 993,581 / 1,013,568), visible only once finalized: width 0 → 1,967,139 → 2,960,720 → 3,974,288, each 66 blocks after landing |
| Six honest withdrawals at once, from 3,974,288 | All admitted. Width fell to 465,956: **8 charges for 5 additional transactions**, because 3 were still pending at the next forkchoice and were charged again for revalidation |
| Concurrent additional withdrawals at the width cap | About 68 (*calc.*: 30,000,000 / 438,550) |
| Steady state | Each landed withdrawal pays for about two more concurrent ones (*calc.*: 994,000 / 438,550) |

## What each mechanism protects against, and what it doesn't

| Attack by a user of a shared sender | ERC-8421 reputation (sidecar) | MATCHA width (ethrex `247e2dd2`) |
|---|---|---|
| Fee-bump spam on one node | **Without the fix, it's the attack:** each bump is a new `seen` (10 bumps, `seen` +10). With the fix, a burst of 10 counts once (`seen` +1) | **Bounded:** once width runs out, bumps are refused (1 of 10 accepted). But the bound is the pool's shared width, so the spammer exhausts it for everyone |
| Several holders bumping at once | Without the fix, `seen` +22 against `included` +6 per burst. With the fix, `seen` +6: one per distinct withdrawal | **Drains width for free:** 21 charges for a burst that paid for four withdrawals. Honest concurrency stops until finality |
| The same note to two nodes | **Charges the sender on every node that didn't mine it** (`seen 3, included 0`), with or without the fix | Not tested across nodes (one node). On one node it's a refused same-fee replacement, at no cost |
| Parking valid low-fee transactions | Refused at admission (below base fee) | Refused at admission |
| Mass invalidation by one state change | Not applicable to this sender: validation reads no state another transaction can change (measured and static) | The same. MATCHA still charges this sender for revalidation, which is where 3 of 8 charges in an honest burst went |
| Honest throughput | Unaffected so far: 6 of 6 at once before and after, status `ok` | **Bootstrap:** one pending withdrawal until the first finalizes. Then about two concurrent per landed withdrawal, recovering only at finality |

## How they interact for a privacy pool
- **They price different things.** ERC-8421 counts transactions (`seen` against `included`); MATCHA counts admission work (gas). A privacy pool's withdrawals are expensive to admit (about 292,000 gas of admission work each), so MATCHA makes each concurrent one costly, while ERC-8421 treats a withdrawal like any other transaction.
- **Both make every user's misbehaviour everyone's problem.** That's inherent in a shared sender: neither mechanism can tell one note holder from another, because the pool can't either.
- **On ERC-8421, a staked pool gets stake-sized budgets** but its reputation is shared; the replacement fix closes the cheapest way to spend it, and the eviction rule would close the cross-node one.
- **On MATCHA, the scarce resource is earned,** so a new pool, exactly when it's trying to attract users, gets one pending withdrawal at a time. The cheapest attack is replacement, which spends width without earning any.
- **Neither needs the protection it charges for against mass invalidation,** for a sender whose validation reads no storage: that cost falls on honest users.

## Recommendations
1. **ERC-8421 sidecar: merge the replacement-counting fix** (REPUTATION-040). Measured here: 10 bumps go from `seen` +10 to +1, a 20-bump burst from +22 to +6, and the same run ends at `seen 34` instead of `59` for the same 32 inclusions. [PR draft](../../docs/drafts/sidecar-pr1.md).
2. **ERC-8421: don't count an eviction caused by the sender's own consumed nonce key.** Measured here: B ends at `seen 3, included 0` for three pairs that each landed once on A. ERC-8421's PROPAGATION-040 already says a received conflict with a recently included transaction "causes no reputation change"; the pending case is the same race one block later. [Issue draft](../../docs/drafts/sidecar-issue-eviction.md).
3. **MATCHA: a lower (or zero) revalidation charge for a sender whose validation reads no state another transaction can change,** keeping the full charge for admissions and replacements. A node can check this from the validation trace it already records. In the honest burst above, that would have saved 3 of 8 charges (*calc.*: 1.3M width) and weakened nothing, since a new head can't change such a transaction's result.
4. **MATCHA: price replacements of additional transactions above a fresh admission,** or rate-limit replacements per nonce key, because a replaced version never lands and never earns width back. Today a burst of 20 bumps cost its senders four withdrawals' gas and the pool 9.2M width.
5. **For pools, until mempools change:** keep the free baseline for withdrawals that matter, re-prove rather than bump where possible, and send each withdrawal to one node (the SDK already never sends a second transaction for a pending nullifier).

## Not done
- Gossip between sidecars, and more than one ethrex node.
- Full blocks, so that low-tip transactions stay pending.
- Throttle and ban thresholds on the sidecar, reached in a run (only calculated, in `docs/reputation-analysis.md`).
- Nethermind.
