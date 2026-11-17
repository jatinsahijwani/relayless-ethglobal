Two changes that let a staked sender use the validation budget ERC-8421 gives it. They're separate concerns in one PR because neither is useful to a proof-verifying sender without the other; happy to split them.

## 1. Per-entity validation budgets (BUDGET-010)
ERC-8421:

> **[BUDGET-010]** A node MUST track the sum of `limits.execution` **separately per entity**, over that entity's own validation frames. The `pre_verify` frame counts toward the entity of the approving frame it immediately precedes. The intrinsic cost of validating `tx.signatures` counts toward the `tx.sender`. For **unstaked entities**, that sum MUST NOT exceed `MAX_VERIFY_GAS_PER_ENTITY`. For **staked entities**, that sum MUST NOT exceed `MAX_VERIFY_GAS_STAKED_ENTITY`.

Today `validateStructuralRules` applies EIP-8141's single `MAX_VERIFY_GAS` (100,000) to the whole prefix, before stake is looked up, so a staked sender is held to 100,000 too. On the public gateway a staked sender's 250,000-gas validation is refused with `250000 exceeds MAX_VERIFY_GAS 100000`.

**The change:**
- `verifyGasByEntity` (`validationPrefix.ts`) sums `limits.execution` per entity over `prefix.frames`, which already carries each frame's role. A `pre_verify` frame carries its approving frame's role, so it counts toward that entity. A leading `expiry_verify` frame isn't in `prefix.frames`, and the ERC attributes it to no entity, so it counts toward none. The signatures' cost counts toward the sender.
- `findEntityOverBudget` checks each sum against `maxVerifyGasPerEntity` (default 100,000), or `maxVerifyGasStakedEntity` (default 1,000,000) if the entity is staked. Stake is only looked up for an entity over the unstaked budget. Both are configurable (`MAX_VERIFY_GAS_PER_ENTITY`, `MAX_VERIFY_GAS_STAKED_ENTITY`).
- `validateStructuralRules` takes `{ perEntityBudgets: true }` from the frame-transaction validator, which then skips the single cap and enforces the per-entity budgets instead. Without the option, its behaviour is unchanged.
- When ethrex's simulation reports its own canonical `prefix gas budget exceeded`, that message no longer masks the real reason a prefix failed, since that cap doesn't bind here.

## 2. Pure precompiles allowed by default (CALLING-040)
ERC-8421:

> **[CALLING-040]** Precompiles that access nothing in the blockchain state or environment are allowed. These include the core precompiles `0x01` to `0x11` and the `P256VERIFY` precompile.

`precompiles` defaults to `[]`, so the code-access check treats a call to any of them as a call to an undeployed address (`accesses un-deployed contract address`). On the public gateway, a VERIFY frame calling `0x06` (BN254 addition, the first step of Groth16 verification) was refused at 60,000 gas, far under any cap.

**The change:** `DEFAULT_PRECOMPILES` is `0x01`–`0x11` and `0x100` (P256VERIFY, EIP-7951). An operator can still narrow it with `precompiles` in the config or `PRECOMPILES`.

**Why they're safe to allow in validation:**
- **Pure:** the output is a function of the input alone.
- **Stateless:** they read no storage, balance, code, block or transaction field. No other transaction or new block can change their result, so a pending transaction can't be mass-invalidated through one, and nothing extra needs revalidating.
- **Deterministic:** every node computes the same result.
- **Gas-bounded:** each call is priced from its input and counts against the calling entity's budget, so a transaction can't make a node do more work than it declared.

The one caveat is cost, not correctness: gas doesn't price CPU evenly across precompiles, which matters for how large an operator sets the staked budget. That's a budget question, not an allowlist one.

## Tests
- `validationPrefix.test.ts`: per-entity sums for a self-relay and a paymaster; a `pre_verify` frame counted toward its approving entity; a leading `expiry_verify` counted toward none; the single cap skipped only when the caller asks; `findEntityOverBudget` admitting without a stake lookup, rejecting an unstaked entity, and giving the staked budget only to the staked entity.
- `config.test.ts`: the default list is the 18 addresses, lowercase (the check compares `addr.toLowerCase()`), excluding `0x00` and `0x12`.

Without the change, the 10 new tests fail. Executor suite on `2e22ff0a`: 386 passed before, 396 after. The same 5 test files fail to load on both, and this PR doesn't touch them.

## End to end
On a local devnet (ethrex `9aa3645d`), this branch merged with the replacement-counting PR and configured with **no** `precompiles` entry admitted a staked privacy pool's withdrawal, whose VERIFY frame uses 227,598 gas against the 1,000,000 staked budget. Our project's end-to-end suite passed 34/34 through it.

Found while building [Relayless](https://github.com/jatinsahijwani/relayless-ethglobal), a privacy pool that is a shared, staked sender on this mempool.
