# Draft: sidecar PR 2, per-entity budgets and a pure-precompile allowlist

**Not sent.** For the author to review, then push and open. **Consider opening the issue below first.**

| | |
|---|---|
| Target | `forshtat/mempool-workshop-sidecar`, base `master` (at `2e22ff0a` on 2026-11-17) |
| Branch | `feat/per-entity-budgets-precompiles`, one commit `2d4018f` on `master`, independent of PR 1 |
| Local clone | `~/Desktop/relayless-upstream/mempool-workshop-sidecar` (outside our repo) |
| Size | 6 files, +234 −7: 4 source files, 2 test files |

## Title
`Validation: per-entity gas budgets (ERC-8421 BUDGET-010) and pure precompiles allowed by default (CALLING-040)`

## Description
In [`sidecar-pr2.body.md`](sidecar-pr2.body.md), ready for `--body-file`.

## Evidence (checked 2026-11-17)
- **The tests fail without the change:** reverting only `packages/executor/src`, 10 of the 42 tests in the two files fail.
- **The executor suite:** 386 passed on `master`, 396 on the branch. The same 5 pre-existing test files fail to load on both.
- **It builds:** `bun run build:all`, and `tsc -p tsconfig.build.json` in `packages/executor`.
- **End to end:** with PR 1 merged locally and **no `precompiles` in the config**, our devnet's sidecar admitted the pool's withdrawals: `scripts/e2e.ts local` passed 34/34, including "the alt mempool would admit the same bytes (227598 of 1000000 gas)".

## What changed from our local patch
`patches/sidecar-budget-010.patch` in our repo was written against an earlier reading of BUDGET-010. Checked against the ERC's text in [ethereum/ERCs#2028](https://github.com/ethereum/ERCs/pull/2028) (head `493ba8ac`, updated 2026-10-01), the branch differs in three places:
1. **`expiry_verify` counts toward no entity.** The patch charged it to the sender. The ERC says an `expiry_verify` frame "is attributed to no entity as its code is protocol-defined".
2. **`pre_verify` counts toward its approving frame's entity,** as BUDGET-010 now says. The sidecar's prefix matcher already gives it that role, so this is now explicit and tested.
3. **The precompile allowlist is a code default,** not only a config value as on our devnet, and the budget check is a pure, tested function.

## Should become an issue first
Two points change the gateway's default policy, so a maintainer may want to discuss them before reviewing code:
1. **Default-on precompiles.** CALLING-040 allows them, so defaulting to the list is the spec's behaviour. But it changes what the public gateway admits. If the maintainers prefer config-only, the PR shrinks to the budgets and a README line.
2. **CPU cost at a 1,000,000 staked budget.** Gas doesn't price CPU evenly (Nethermind's follow-up to the validation-budget research measured block-building slowdown per attacker peer). Whether 1M is the right default for staked entities, or whether pairing-heavy validation needs a lower one, is a policy question the ERC leaves to nodes.

Suggested issue text, if the author wants one:

> **Default precompile allowlist and the staked budget.** ERC-8421 CALLING-040 allows `0x01`–`0x11` and P256VERIFY in validation, and BUDGET-010 gives staked entities their own budget (1,000,000 by default). The sidecar currently defaults `precompiles` to `[]` and applies EIP-8141's single 100,000 cap to the whole prefix, so a staked sender verifying a Groth16 proof (about 230k gas) can't be admitted. I have a branch implementing both, with tests. Before opening it: would you take precompiles on by default, or config-only? And is 1M the default you want for staked entities?

## Notes for the author
- PR 1 and PR 2 are independent and can be reviewed in either order. They don't conflict: `local/integration-pr1-pr2` merges them cleanly.
- The commit carries a `Co-Authored-By: Claude` trailer. Keep it or amend it away before pushing.
- `local/integration-pr1-pr2` is a local test branch. Don't push it.

## Commands
```sh
cd ~/Desktop/relayless-upstream/mempool-workshop-sidecar
git fetch origin && git log --oneline -1 origin/master        # still 2e22ff0a? If not: git rebase origin/master feat/per-entity-budgets-precompiles
gh repo fork forshtat/mempool-workshop-sidecar --remote --remote-name fork   # skip if done for PR 1
git push fork feat/per-entity-budgets-precompiles
gh pr create --repo forshtat/mempool-workshop-sidecar --base master \
  --head "$(gh api user --jq .login):feat/per-entity-budgets-precompiles" \
  --title "Validation: per-entity gas budgets (ERC-8421 BUDGET-010) and pure precompiles allowed by default (CALLING-040)" \
  --body-file ~/Desktop/relayless-ethglobal/docs/drafts/sidecar-pr2.body.md
```

To open the issue instead, first:

```sh
gh issue create --repo forshtat/mempool-workshop-sidecar \
  --title "Default precompile allowlist and the staked validation budget (ERC-8421 CALLING-040, BUDGET-010)" \
  --body "<the suggested issue text above>"
```
