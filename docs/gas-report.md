# Gas report

Measured from receipts on the local stack (ethrex `9aa3645d`, patched sidecar), small trees of about 5–13 leaves. **Not measured on the public devnet, which can't admit these transactions yet.** Regenerate with `pnpm e2e`.

## A withdrawal
| Part | Gas | Notes |
|---|---|---|
| VERIFY frame | **253,176** | 7 public inputs, including the 20k first-use nonce key |
| SENDER frame, execution | 183,773–245,929 | Tree insert and root publish; grows with tree depth |
| SENDER frame, state | 379,440–477,360 | New storage slots, new account for a fresh recipient |
| Refund frame | 9,945 | |
| **Total, fresh recipient** | **about 950,000** | |

With an association set, the VERIFY frame is 253,344 gas.

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
About 1.6–2 s for the 24,965-constraint withdrawal circuit, in Node and in a Chrome Web Worker on this machine, against the 10 s target. Ragequit is 12,516 constraints. Not measured on a phone.
