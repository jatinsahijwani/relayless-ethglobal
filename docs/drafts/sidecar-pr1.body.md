## What
`MempoolService.addFrameTx` calls `updateSeenStatus` after both of its branches, so admitting a replacement counts as a new `seen` for every entity of the transaction. ERC-8421's REPUTATION-040 says:

> Admitting a replacement is not a new occurrence of `seen` for any unchanged entity. If the replacement changes the `payer`, the `factory`, or both, the node decrements each changed role's old address's `seen` by 1 and increments its new address's `seen` by 1, atomically with the replacement.

## Why it matters
`seen` drives throttling and banning. With the current code, one sender can raise its own `seen`, or a shared sender's, with fee bumps while only one transaction is ever mined. For a sender shared by many users, such as a privacy pool, one note holder can throttle everyone.

## The change
- `service.ts`: a replacement of an entry that still holds its slot (status below `OnChain`) calls `updateSeenOnReplacement`. Everything else calls `updateSeenStatus` as before, so resubmitting after `Cancelled` or `Reverted` still counts as new.
- `reputation.ts`: `updateSeenOnReplacement` does nothing for an unchanged entity. If the payer or factory changed, the old address loses one `seen` and the new one gains one. The sender can't change: it's part of the slot's identity.
- `ReputationService.ts`: adds `removeSeenStatus`, which never goes below zero.

## Tests
`test/services/MempoolService/replacementSeen.test.ts`, 7 tests:
- a new admission counts once;
- a burst of fee-bump replacements leaves `seen` at 1 (**fails without the fix:** `updateSeenStatus` is called 9 times instead of once);
- different nonce keys count separately, since they aren't replacements;
- a resubmission after the old entry was cancelled counts as new;
- `updateSeenOnReplacement` with no role change (address case ignored), with a payer change, and with a factory added or removed.

Without the fix, 4 of the 7 fail: the fee-bump test, and the three `updateSeenOnReplacement` tests, which need the new method.

Executor suite (`npx vitest --run` in `packages/executor`) on `2e22ff0a`: 386 passed before, 393 after (the 7 new ones). The same 5 test files fail to load on both, `test/unit/{modules/skandha,services/MempoolService,services/ReputationService,services/UserOpValidationService,utils/client}.test.ts`. They fail before any test runs, for example on `@skandha/types/src/contracts/EPv7/factories/core/EntryPoint__factory`, which isn't in the tree; this PR doesn't touch them.

## Measured on a local devnet
ethrex `9aa3645d`, this sidecar, one note, 8 replacements sent in a burst to one node:

| | Accepted | `seen` | `included` once landed |
|---|---|---|---|
| Before | 8 of 8 | 0 → 8 | 1 |
| After | 8 of 8 | 0 → 1 | 1 |

Fee bumps still work. With this change and the per-entity budgets PR together, our project's end-to-end suite (34 checks, including a fee bump and three concurrent transactions from one sender) passes through the sidecar on a local devnet.

Found while building [Relayless](https://github.com/jatinsahijwani/relayless-ethglobal), a privacy pool that is a shared sender on this mempool.
