# Gas report

**This file is the source of truth for these numbers.** Other docs quote it.

Measured from receipts on the local stack (ethrex `9aa3645d`, patched sidecar). **Not measured on the public devnet, which can't admit these transactions yet.** Regenerate with `pnpm e2e`, which also writes the latest figures to `.relayless-e2e-local.json`.

## A withdrawal
| Part | Gas | Notes |
|---|---|---|
| VERIFY frame | **253,176** | 7 public inputs, including the 20k first-use nonce key. See "How much it varies" |
| SENDER frame, execution | 183,773–245,929 | Tree insert and root publish; grows with tree depth |
| SENDER frame, state | 379,440–477,360 | New storage slots, new account for a fresh recipient |
| Refund frame | 9,945 | |
| **Total, fresh recipient** | **about 900,000** | 898,730 and 906,432 in the last two full e2e runs. Grows when the tree needs new storage |

### How much it varies
253,176 is the figure quoted everywhere. Individual runs differ by a few hundred gas, and the cause hasn't been pinned down:

| Pool | VERIFY frame, seen across runs |
|---|---|
| No association set | 253,068–253,176 |
| With an association set | 253,236–253,344 |

So the live panel in the app, which reads real receipts and simulations, can show a slightly different number. Say "about 253,000" out loud.

## Against the budgets
| Budget | Gas | Fits? |
|---|---|---|
| Canonical `MAX_VERIFY_GAS` | 100,000 | No: rejected |
| ERC-8421 draft, unstaked | 100,000 | No |
| Landing page, unstaked | 250,000 | **No, by about 3,300** |
| ERC-8421 draft, staked | 1,000,000 | Yes |
| Landing page, staked | 2,500,000 | Yes |

The research post's floor is 211,828 gas with a single public input. Ours is higher because each extra input costs about 6,645 gas, a delegatecall to the validator costs 2,600, and the shape checks add a little. See `DECISIONS.md` for why inputs aren't compressed.

## Other operations
| Operation | Gas |
|---|---|
| Deposit | 592,503–919,596 |
| Ragequit | 293,871–293,907 |
| Deploy: Poseidon T3 / T4 / validator / pool | 25.7M / 19.5M / 6.7M / 7.1M |

State gas makes storage and code far more expensive on this devnet than on mainnet today, which is why deploys and deposits look large.

## Limits declared by a withdrawal
These set `maxCost`, which must fit inside the note's fee and is mostly refunded.

| Frame | Execution | State |
|---|---|---|
| VERIFY | 300,000 | 0 |
| SENDER | 1,500,000 | 1,000,000 |
| Refund | 150,000 | 0 |

At the default 1 gwei max fee, about 0.003 ETH is held and the unused part returns. Worst case for the SENDER frame, under Foundry's gas costs: 812,701 execution at full tree depth with a gas-burning recipient.

## Proving
About 2 s for the 24,965-constraint withdrawal circuit on this laptop, against the 10 s target: 1.8–2.2 s in a Chrome Web Worker, and 1.6–2.6 s across runs including Node, with the highest while other work was running. Ragequit is 12,516 constraints. Not measured on a phone.
