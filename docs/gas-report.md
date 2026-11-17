# Gas report

**This file is the source of truth for these numbers.** Other docs quote it.

Measured from receipts on two local chains, one per spec profile (see `docs/spec-port.md`):

- **`devnet-8421`:** ethrex `9aa3645d` with the patched ERC-8421 sidecar (`scripts/local-stack.sh`). Regenerate with `pnpm e2e local`.
- **`hegota-8141`:** ethrex `64b8fc09`, the revision chain 8141 runs, in dev mode with chain 8141's 500,000 verify budget (`scripts/local-stack-hegota.sh`). Regenerate with `pnpm e2e local-hegota`.

Each run writes its figures to `.relayless-e2e-<network>.json`. **On the public chain 8141** (2026-11-16), a withdrawal to a fresh address used 941,778 gas: root frame 5,579, pool VERIFY 233,383 + 97,920 state, SENDER 193,729 + 379,440 state, refund 9,967. The root and VERIFY frames match the local `hegota-8141` chain exactly.

## A withdrawal
| Part | `devnet-8421` | `hegota-8141` | Notes |
|---|---|---|---|
| Recent-root frame | none | **5,579** (one root), 8,010 (two) | EIP-8272's verifier frame. On the devnet, roots travel in the envelope |
| Pool VERIFY frame, execution | **253,068–253,176** | **233,383** | 7 public inputs. The devnet charges the nullifier key's first use (20,000) here |
| Pool VERIFY frame, state | 0 | **97,920** | The nullifier key's first use: one new slot, 64 bytes at 1,530 a byte |
| SENDER frame, execution | 183,803–258,221 | 183,810–230,515 | Tree insert and root publish. Grows with tree depth |
| SENDER frame, state | 379,440–477,360 | 379,440–477,360 | 97,920 a new slot, 183,600 a new account (a fresh recipient) |
| Refund frame | 9,945 | 9,967 | |
| Intrinsic | | 21,772 | Total minus the frames |
| **Total, fresh recipient** | **about 900,000–950,000** | **about 980,000–1,030,000** | 978,552 and 1,029,791 in the last two `hegota-8141` runs |

The `hegota-8141` total is higher because state gas now pays for the nullifier slot and the root frame is separate. The pool VERIFY frame is cheaper there, for the same reason.

### How much it varies
On `devnet-8421`, VERIFY varies by a few hundred gas between runs and the cause hasn't been pinned down: 253,068–253,176 without an association set, 253,236–253,344 with one. Say "about 253,000" out loud. `hegota-8141` showed 233,383 in every run so far.

## The validation budget
What a node's mempool counts against its verify budget: the validation frames' declared execution limits and the signature.

| | `devnet-8421` | `hegota-8141` |
|---|---|---|
| Declared | 300,000 | 308,100 (8,000 root frame, 300,000 pool VERIFY, 100 signature) |
| Used | about 253,000 | 238,962 (5,579 root frame, 233,383 pool VERIFY) |

| Budget | Gas | `devnet-8421` | `hegota-8141` |
|---|---|---|---|
| EIP-8141 `MAX_VERIFY_GAS` | 100,000 | No | No |
| ERC-8421 draft, unstaked | 100,000 | No | n/a |
| ERC-8421 draft, staked | 1,000,000 | Yes | n/a |
| Chain 8141 (`--mempool.max-verify-gas`) | 500,000 | n/a | **Yes** |
| Nethermind's default | 300,000 | n/a | Used yes, declared no. Would need the pool VERIFY limit lowered to about 250,000 |

The research post's floor is 211,828 gas with a single public input. Ours is higher because each extra input costs about 6,645 gas, a delegatecall to the validator costs 2,600, and the shape checks add a little. Compressing to 3 inputs is planned after the spec port, and saves about 25,000: see `DECISIONS.md`.

## The SENDER frame can't run out after APPROVE
A note is burned the moment APPROVE runs, so the SENDER frame must never fail. The validator pins its minimum limits. They were re-measured on both profiles before any testnet deployment:

| | Pinned minimum | Worst case measured | How |
|---|---|---|---|
| Execution | 1,500,000 | **861,786** (`hegota-8141`), 861,779 (`devnet-8421`) | `scripts/gas-floors.ts`: the pool's code staged at depth 20 (19 of 20 levels hash), a recipient that burns its whole 100,000, so the payment is deferred and a claim written. On the client's own gas schedule. Foundry's older pricing says 812,731 |
| State | 1,000,000 | **566,100** (a recipient that keeps 2 new accounts) | `scripts/adversarial.ts` |

**Why state can't run out.** Before the payment, settlement creates at most 3 slots: the leaf, a new tree level when the depth grows, and a fresh recent-root ring slot. That's 293,760. The payment then adds a new account (183,600) or, if it fails, a claim (97,920), but never both, because a failed call's state is rolled back. ethrex does restore a reverted call's state gas: a recipient that creates 7 slots and then refuses leaves the frame at 293,760. A recipient that keeps what it creates can use the rest of the budget, but the payment is the last thing settlement does, and the withdrawer chose that recipient and pays for it out of the note's fee.

**Hostile recipients,** all settled on both profiles with the note spent and the change kept (`scripts/adversarial.ts`, 10/10 on each):

| Recipient | SENDER, `hegota-8141` | Outcome |
|---|---|---|
| Creates 4 slots, then refuses | 354,094 + 293,760 state | Kept as a claim |
| Creates 7 slots, then refuses | 411,016 + 293,760 state | Kept as a claim |
| Tries to create 12 slots, more than the budget | 349,295 + 391,680 state | Kept as a claim |
| Keeps 3 new slots | 279,821 + 489,600 state | Paid |
| Creates 3 accounts, then refuses | 293,397 + 293,760 state | Kept as a claim |
| Keeps 2 new accounts | 287,052 + 566,100 state | Paid |
| Burns all its gas | 359,214 + 293,760 state | Kept as a claim |
| Returns 60 KB | 275,285 + 195,840 state | Paid |
| Re-enters the pool | 365,055 + 195,840 state | Paid |
| Self-destructs | 299,788 + 379,440 state | Paid |

Foundry's fuzz tests pass 10,000 runs each, with `withdraw` and `ragequit` never reverting for any input.

## The refund overhead
The refund frame hands back the fee gas didn't use. It can't see intrinsic gas or its own execution, so the validator adds a fixed overhead, rounded up, because an underestimate would be paid by the other depositors.

**Re-derived:** intrinsic 21,772, plus the refund frame's worst case, which is the 100,000 cap on its call to the recipient plus about 10,000 of its own. That's about 132,000. **The pin stays at 150,000 on both profiles.** Every e2e run checks that the reserve doesn't fall.

## Other operations
| Operation | `devnet-8421` | `hegota-8141` |
|---|---|---|
| Deposit | 592,503–919,596 | |
| Ragequit | 293,871–293,907 | 373,699 |
| Deploy: Poseidon T3 / T4 / validator / pool | 25.7M / 19.5M / 6.7M / 7.3M | 25.7M / 19.5M / 6.9M / 7.1M |

State gas makes storage and code far more expensive on these chains than on mainnet today, which is why deploys and deposits look large.

## Limits declared by a withdrawal
These set `maxCost`, which must fit inside the note's fee and is mostly refunded.

| Frame | Execution | State |
|---|---|---|
| Recent-root (`hegota-8141` only) | 8,000, or 12,000 with two roots | 0 (EIP-8272 requires it) |
| Pool VERIFY | 300,000 | 0 on `devnet-8421`, 97,920 on `hegota-8141` |
| SENDER | 1,500,000 | 1,000,000 |
| Refund | 150,000 | 0 |

At the default 1 gwei max fee, about 0.003 ETH is held and the unused part returns.

## Proving
About 2 s for the 24,965-constraint withdrawal circuit on this laptop, against the 10 s target: 1.8–2.2 s in a Chrome Web Worker, and 1.6–2.6 s across runs including Node, with the highest while other work was running. Ragequit is 12,516 constraints. Not measured on a phone.
