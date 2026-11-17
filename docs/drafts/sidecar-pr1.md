# Draft: sidecar PR 1, replacements must not count as `seen`

**Not sent.** For the author to review, then push and open.

| | |
|---|---|
| Target | `forshtat/mempool-workshop-sidecar`, base `master` (default branch, at `2e22ff0a` on 2026-11-17, unchanged since 2026-10-25) |
| Branch | `fix/replacement-not-seen`, one commit `4184aec` on `master` |
| Local clone | `~/Desktop/relayless-upstream/mempool-workshop-sidecar` (outside our repo) |
| Size | 4 files, +173 −3: 3 source files and 1 new test file |
| License | The repo is MIT. Our patch was MIT-compatible from the start (`NOTICE.md`) |

## Title
`Reputation: a replacement is not a new seen (ERC-8421 REPUTATION-040)`

## Description
In [`sidecar-pr1.body.md`](sidecar-pr1.body.md), ready for `--body-file`.

## Evidence (checked 2026-11-17)
- **The test fails without the fix.** Reverting only `packages/executor/src` and keeping the test: 4 of 7 fail, including `does not count fee-bump replacements` with *"expected "spy" to be called 1 times, but got 9 times"*.
- **The executor suite:** 386 passed on `master`, 393 on the branch. The same 5 test files fail to load on both; they're pre-existing and untouched.
- **It builds:** `bun install --frozen-lockfile && bun run build:all` on the branch.
- **It works end to end:** merged locally with PR 2 (branch `local/integration-pr1-pr2`, not for upstream), run as the sidecar of our devnet with no `precompiles` config, Relayless's `scripts/e2e.ts local` passed 34/34.
- **The before/after numbers** (8 bumps: `seen` 0 → 8 before, 0 → 1 after) are from the Stage 1 measurement with `scripts/grief-experiment.ts`, on the same code. Part D's harness re-measures them.

## Notes for the author
- **CONTRIBUTING.md is out of date:** it says Yarn and Lerna, but the repo builds with bun (`bun.lock`, `bun run build:all`). Not worth mentioning in the PR.
- The commit carries a `Co-Authored-By: Claude` trailer. Keep it, or amend it away before pushing (the branch has never been pushed, so amending rewrites nothing public).
- The alt mempool authors already called this a prototype bug in conversation, so a short PR should be enough.

## Commands
Run from the local clone. `gh repo fork` creates your fork if you don't have one.

```sh
cd ~/Desktop/relayless-upstream/mempool-workshop-sidecar
git fetch origin && git log --oneline -1 origin/master        # still 2e22ff0a? If not: git rebase origin/master fix/replacement-not-seen
gh repo fork forshtat/mempool-workshop-sidecar --remote --remote-name fork
git push fork fix/replacement-not-seen
gh pr create --repo forshtat/mempool-workshop-sidecar --base master \
  --head "$(gh api user --jq .login):fix/replacement-not-seen" \
  --title "Reputation: a replacement is not a new seen (ERC-8421 REPUTATION-040)" \
  --body-file ~/Desktop/relayless-ethglobal/docs/drafts/sidecar-pr1.body.md
```

To re-check before sending:

```sh
export PATH="$HOME/Desktop/relayless-ethglobal/.relayless/stack/tools/node_modules/.bin:$PATH"   # bun
git checkout fix/replacement-not-seen && bun install --frozen-lockfile && bun run build:all
(cd packages/executor && npx vitest --run test/services/MempoolService/replacementSeen.test.ts)
```
