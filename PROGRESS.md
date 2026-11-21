# Progress

## Stage 4: frame-tx-sdk, a Kohaku prototype, final drafts, the grant proposal (2026-11-22)
Nothing was posted, published or pushed outside our own repository. Decisions and live-source differences are in `DECISIONS.md` under Stage 4.

### Part 1: frame-tx-sdk 0.1, and Relayless on it
**The SDK:** `frame-tx-sdk`, MIT, its own git repository at **`~/Desktop/frame-tx-sdk`**. There's no GitHub repository and nothing is on npm; the name was free on 2026-11-22. Design decisions are in [`docs/sdk-design.md`](docs/sdk-design.md).

| Covers | How |
|---|---|
| Frames, APPROVE scopes, sigHash | `verifyFrame`, `senderFrame`, `defaultFrame`, `buildFrameTransaction` (pure), `signFrameTransaction`, `arbitrary`, per-profile codecs |
| Profiles | `devnet-8421` and `hegota-8141` in one table, `eips-current` listed and refused |
| Keyed nonces (EIP-8250) | `{ keys, seq }`, `{ legacy }`, `{ keys, singleUse: true }` only where the profile has it. The live client refuses `nonce_seq = 2^64 − 1` on `hegota-8141` |
| Recent roots (EIP-8272) | A VERIFY frame on `hegota-8141`, the envelope field on `devnet-8421`, and `checkRecentRoot` against storage |
| Admission | `ethrex_simulateFrameTransaction`, the sidecar's `eth_estimateFrameTransactionGas`, and a fallback labelled "unverified preflight" |
| The broadcast guard | `sendFrameTransaction` refuses a failed, unverified or mismatched admission unless `force: true` |
| Fee bumps | `bumpFrameTransaction` re-commits through a callback and checks the nonce is unchanged |
| Readouts | Sidecar reputation and MATCHA width, `null` where the endpoint doesn't exist |
| API and docs | `frameActions(profile)` for viem; TSDoc on exports; README with a quickstart; four examples (quickstart, plain, keyed nonce, a pool as sender) |

**SDK tests, 2026-11-22:**

| Suite | Result |
|---|---|
| Unit (`npm test`) | **46/46**: ethrex `64b8fc09`'s golden vector, byte equality with hegota-support's devnet builder, profile rules, admission routes, the guard, bumps, readouts, the viem extension |
| Integration, local `hegota-8141` (ethrex `64b8fc09`) | **8/8**: plain EOA transaction, keyed nonce (consumed, resend refused), single-use refused by the client, a recent-root frame with a root written in the test, a pool as sender (three drips to 0-ETH addresses pending at once, one block), a fee bump, the unverified preflight refused then forced, readouts `null` |
| Integration, local `devnet-8421` (ethrex `9aa3645d` plus the sidecar) | **5/5**: keyed transaction through the sidecar, the sidecar's estimate route with a re-signed placeholder copy, **a real fee-bump replacement through the sidecar with exactly one version landing**, a pool as sender with the pool's reputation read back, no MATCHA readout |
| Quickstart from a clean clone | **Worked:** clone, `npm install`, 46/46, the offline example, a read-only simulation against chain 8141's public RPC (refused, nothing sent), then `example:plain` and `example:pool` against the local chain. 9 s to the read-only step, with a warm npm cache |

**Relayless on the SDK** (branch `sdk`): `packages/sdk` depends on `file:../../../frame-tx-sdk`. Profiles come from the SDK's table, `codec-hegota.ts` is deleted, the builders use the SDK's, and preflight, sending, the spent check, fee bumps and the mempool comparison go through it. The bytes sent are unchanged: the golden-vector and byte-equality tests still pass.

| Suite | `devnet-8421` | `hegota-8141` | Before |
|---|---|---|---|
| Circuits | 16/16 (shared) | | 16/16 |
| Contracts | 29/29 (shared) | | 29/29 |
| SDK unit | 43/43 (shared) | | 43/43 |
| ASP | 15/15 (shared) | | 15/15 |
| `scripts/e2e.ts` | **34/34** | **32/32** (a first run was 31/32: the concurrency check saw the three withdrawals mined in three consecutive one-second blocks; the rerun passed) | 34/34, 32/32 |
| `scripts/e2e-asp.ts` | **10/10** | **10/10** | 10/10, 10/10 |
| `scripts/adversarial.ts` | **10/10** | **10/10** | 10/10, 10/10 |
| `scripts/alias.ts` | **6/6** | **6/6** | 6/6, 6/6 |
| `pnpm typecheck`, `pnpm build` | clean | | clean |

**PR:** [#10](https://github.com/jatinsahijwani/relayless-ethglobal/pull/10). **CI will fail at install on GitHub,** because it can't see `../frame-tx-sdk`. That's expected until the SDK is published; see `DECISIONS.md`.

**Things I noticed:**
- **The devnet had stalled again** (head at slot 2,912, wall clock past 65,000), as in Stage 3. I restarted it from a new genesis with the script's own recipe; the old data was moved to `data.old.<time>`, not deleted.
- **Starting Docker brought back `my-app-indexer` again,** which I stopped (not removed).
- **Keyed concurrency on ethrex `64b8fc09` is for contract senders only:** an EOA's second keyed transaction is refused while one is pending. The keyed-nonce example sends one at a time; the pool example shows concurrency.
- **ethrex `9aa3645d` needs about 200,000 gas for the drip's SENDER frame,** though it uses 12,196. Not investigated further.

### Part 2: a Kohaku frame-transaction withdrawal prototype
**Studied:** `ethereum/kohaku` master `b6a67fa` (2026-11-21), cloned to **`~/Desktop/kohaku-fork`**. I read `packages/plugins` (the plugin interface, `Broadcaster`, `Host`, `scopeKeystore`), `packages/privacy-pools` (its relayer and paymaster unshields, keys, tests) and `docs/pages/host.mdx`. **The design:** [`docs/kohaku-design.md`](docs/kohaku-design.md), covering:
- how the unshield fits `prepareUnshield` and `Broadcaster`;
- what changes against the paymaster path;
- keys under `m/29292'/1'`;
- admission and broadcasting through `host.provider` and `host.network`;
- what upstreaming needs, and seven questions for the Kohaku team.

**PRs:** [#11](https://github.com/jatinsahijwani/relayless-ethglobal/pull/11) (this part), [#12](https://github.com/jatinsahijwani/relayless-ethglobal/pull/12) (Parts 3–4), stacked on #10.

**The prototype:** branch `relayless-frame-unshield` in the fork, 5 commits, **not pushed**. It's a new package, `@kohaku-eth/relayless`:
- `createRelaylessPlugin`, with `prepareShield`, `prepareUnshield`, `balance` and `notes`;
- `RelaylessBroadcaster implements Broadcaster`;
- frame-tx-sdk for building, simulation and sending; Relayless's client for notes and proofs.

| Test | Result |
|---|---|
| Unit (`pnpm test`) | **9/9**: keys stay in their subtree, are stable and never send; the broadcaster sends once through `host.network`, refuses unadmitted, unverified and in-flight operations without touching the network, and re-simulates stale ones through `host.provider` |
| **A real withdrawal through the plugin interface** (`pnpm test:e2e:local-hegota`), local `hegota-8141` (ethrex `64b8fc09`) | **1/1, twice.** Shield 0.05 ETH, then unshield 0.02 ETH to a fresh address holding 0 ETH. Run 1: 973,582 gas, recipient 0 → 0.019998908637360515 ETH, proving 1,776 ms. Run 2: 993,581 gas, 0.019998888650220606 ETH, 1,816 ms. The node admitted it (268,100 validation declared), the change note (0.03 ETH) was recovered from the seed, and replaying the operation was refused before broadcast |
| Kohaku's ESLint config | Clean |
| Kohaku's own `plugins` tests, untouched | 36/36 |

**Live sources that differed from the brief:** Kohaku's code has no `broadcastPrivateOperation` (only its README does); broadcasting is a separate `Broadcaster`. There's no CONTRIBUTING guide. Both are in `DECISIONS.md`.

**Things I noticed:** Kohaku's viem provider throws for a receipt that doesn't exist yet, where its interface says `null`; the prototype handles both. The prototype links Relayless's client as TypeScript source, so it relaxes `noUncheckedIndexedAccess` for that package only.

### Part 3: final posts, drafted, nothing posted
All in `docs/drafts/`. Each opens with where to post it and its place in the order. The threads were re-read on 2026-11-22: Nethermind's latest post is 2026-11-10, MATCHA's 2026-10-07, EIP-8250's 2026-10-23, EIP-8272's 2026-07-17.

| Order | Draft | Where |
|---|---|---|
| 1 (day 0) | [`reply-nethermind-thread.md`](docs/drafts/reply-nethermind-thread.md): full and two-link versions | ethresear.ch topic 26223 |
| 2 (day 1) | [`reply-matcha-thread.md`](docs/drafts/reply-matcha-thread.md): full and two-link versions | ethresear.ch topic 25949 |
| 3 (day 2) | EIP-8250 post in [`support-eip-8250-8272.md`](docs/drafts/support-eip-8250-8272.md), 179 words | Ethereum Magicians topic 28437 |
| 4 (day 3) | EIP-8272 post, same file, 195 words. It answers the sidecar author's July question on the frame form | Ethereum Magicians topic 28621 |
| 5 (day 5) | [`ethresearch-post.md`](docs/drafts/ethresearch-post.md), with [`img/frame-layout.svg`](docs/drafts/img/frame-layout.svg) and [`img/shared-sender-attack.svg`](docs/drafts/img/shared-sender-attack.svg) (Mermaid sources beside them) | New ethresear.ch topic, Networking |

- **The Nethermind reply:** the 235,000 sentence is gone. Every figure is from the chain 8141 receipt (`hegota-8141`), apart from two marked exceptions: the association-set deltas (local `hegota-8141`) and the ERC-8421 admission figures (`devnet-8421`). The breakdown sums exactly to the 237,498 difference.
- **The MATCHA reply** says plainly that chain 8141 (`64b8fc09`) doesn't run MATCHA and that the runs used `247e2dd2` locally. It answers four of the post's next steps, makes the two proposals, and ends with one question.
- **Calculated figures are marked** in each draft's notes.

### Part 4: the grant proposal
[`docs/drafts/grant/proposal.md`](docs/drafts/grant/proposal.md), "Privacy-ready frame transactions for Hegotá", complete apart from the team, EF interest and budget amounts, which are placeholders. It covers:
- the summary, problem and why now;
- what exists, linked, with "to be published" and "local branch" where true;
- six workstreams with milestones, the sidecar one optional pending its author's confirmation;
- core (about 6 months) and extended (9–12 months) scopes, and a timeline;
- the budget table and how to size it;
- the open-source commitment, CROPS, risks, success measures and AI usage.

[`evidence.md`](docs/drafts/grant/evidence.md) has a Stage 4 table. `proposal-skeleton.md` is kept, marked superseded.

**What needs the author:**
- Review and post the five drafts, in order.
- Fill in the team, EF interest and budget.
- Decide when to publish frame-tx-sdk; its links in the drafts and the proposal wait for that.
- Decide whether to show the Kohaku design to its maintainers.

## Stage 3: upstream contributions, research data, grant prep (started 2026-11-17)

### Part G: upstream contributions opened (2026-11-18)
On `forshtat/mempool-workshop-sidecar`, from the fork `jatinsahijwani/mempool-workshop-sidecar`. Upstream `master` was still `2e22ff0a`, so no rebase was needed. The co-author trailer was removed from the commits before pushing.

| What | Link | Branch | Checked before posting |
|---|---|---|---|
| PR: a replacement is not a new `seen` | [#9](https://github.com/forshtat/mempool-workshop-sidecar/pull/9) | `fix/replacement-not-seen` (`8e8cda1`) | Builds. 7 of 7 pass; 4 of 7 fail with `src` reverted. Applies cleanly with upstream #6 |
| Issue: eviction by the sender's own consumed key | [#10](https://github.com/forshtat/mempool-workshop-sidecar/issues/10) | none | Numbers from RESULTS.md |
| Issue: pure precompiles by default | [#11](https://github.com/forshtat/mempool-workshop-sidecar/issues/11) | [`feat/pure-precompiles-default`](https://github.com/jatinsahijwani/mempool-workshop-sidecar/tree/feat/pure-precompiles-default) (`a506601`) | Builds. 6 of 6 pass; 2 fail without it. Executor suite 388 passed (386 on `master`) |

**Changed from the plan:** per-entity budgets (BUDGET-010) weren't proposed, because three open upstream PRs (#2, #3, #4) already implement them and #3 asked for the precompile default as a separate PR. Issue #11 covers only that, from a precompile-only branch split out of `feat/per-entity-budgets-precompiles`, which stays local. Email drafts for follow-up: `docs/drafts/emails/`, not sent.

### Part A: post-merge check and small fixes
| Step | State |
|---|---|
| PR #5 merged | Yes, 2026-11-17 05:44 UTC, merge commit `9e9536c`. `main`'s README has `## Public testnet` at line 156, and the status table's `#public-testnet` link resolves to it |
| Plain-text mentions linked | `docs/testnet-run.md` (2), `PROGRESS.md` (2) |
| `docs/landscape.md` | Corrected: chain 8141 runs ethrex `64b8fc09`, which relaxes one-pending-per-sender for disjoint nonce keys and has no width budget. MATCHA is in `247e2dd2`, on by default. Both checked against minimal-shielded-pool's SECURITY.md on 2026-11-17. Chain 8141 results added to "Where Relayless is different", and the out-of-date "catch up" bullets fixed |
| CI on `main` | Green on `9e9536c` (`unit` passed; `e2e` runs on dispatch and nightly only). The `relayless-ens` Vercel project still fails, as expected; that's a Vercel setting |

**Noticed in the live SECURITY.md:** `247e2dd2` panics when a top-level frame calls a precompile after an earlier frame emitted logs, which can stop a node producing blocks. No Relayless frame targets a precompile (the validator calls the pairing precompile from inside the pool's VERIFY frame), but the Part D harness on `247e2dd2` has to watch for it.

### Part B: statement compression
Done on branch `compression` (stacked on `post-merge-fixes`). The withdrawal statement is compressed to 3 public signals with the hybrid scheme of eprint 2025/1500, adapted from minimal-shielded-pool and credited in `NOTICE.md`. Reasons and choices are in `DECISIONS.md` under Stage 3.

**Results, 2026-11-17:**

| | `devnet-8421` | `hegota-8141` |
|---|---|---|
| Pool VERIFY frame used | **227,598** (was about 253,100) | **207,913** (was 233,383): −25,470 |
| Validation declared | **260,100** (was 300,000) | **268,100** (was 308,100): under Nethermind's 300,000 |
| Validation used | 227,598 | 213,492 |
| Withdrawal total, fresh recipient | 924,937 (local) | **916,820 on chain 8141** (was 941,778) |
| Circuit | 26,052 constraints (was 24,965). Proving 2.0–2.1 s in Node | |

**Test results, both profiles, on fresh deployments of the compressed build:**

| Suite | `devnet-8421` | `hegota-8141` |
|---|---|---|
| Circuits | 16/16 (shared; 3 new: compressed signals, binding, aliasing, plus a vector shared with the SDK) | |
| Contracts (Foundry, fuzz at 10,000 runs) | 29/29 (shared) | |
| SDK | 43/43 (shared; 4 new compression tests) | |
| ASP server | 15/15 (shared) | |
| `scripts/e2e.ts` | **34/34** | **32/32** |
| `scripts/e2e-asp.ts` | **10/10** | **10/10** |
| `scripts/adversarial.ts` | **10/10** | **10/10**. State ceiling 566,100 of 1,000,000 |
| `scripts/gas-floors.ts` | 861,779 of 1,500,000 | 861,786 of 1,500,000 |
| `scripts/alias.ts` (new) | **6/6** | **6/6**. Aliased amount, change, k and nullifier hash: each proof verifies off-chain, and the node refuses each transaction |
| `scripts/testnet-run.ts` (five steps) | | **5/5 locally, then 5/5 on chain 8141** |
| `pnpm typecheck`, `pnpm build` | clean | |

**Chain 8141, new pool:** `0xab5d3d27d192af9bcb1eafc953ba695baea0c7be`, validator `0x7c8566920a28bbb8c149916eb67624c3b723e316`. Links in the README's [Public testnet](README.md#public-testnet) section; the first pool stays there as history. Spent 0.1179 ETH of testnet ETH (0.8820 to 0.7641), of which 0.0729 stays in the new pool. Total spent in Stage 3: 0.1179 ETH, under the 0.2 ETH limit.

**Things I noticed:**
- Docker had quit, taking the devnet down. After a restart its two beacons found no peers and stopped producing, so the devnet was restarted from a new genesis. Its old data was moved aside to `data.old.<time>` in the sidecar's `deploy/devnet`, not deleted. `scripts/local-stack.sh` now handles a stale registry. Starting Docker brought back one unrelated container (`my-app-indexer`), which I stopped again.
- My first version of `alias.ts` judged the devnet's simulation by a field only `64b8fc09` returns, so its devnet "refusals" were meaningless. It now uses the SDK's own preflight rule, and the devnet refuses each aliased transaction at the pool's VERIFY frame.
- `scripts/alias.ts` wasn't run against chain 8141. It sends nothing, but it needs a deposit and a funded throwaway key, and the local runs on the same client revision cover it.

### Part C: upstream contributions, prepared (opened in Part G)
Nothing was pushed or opened in this part. The branches are in a local clone outside our repo: **`~/Desktop/relayless-upstream/mempool-workshop-sidecar`**, from upstream `master` at `2e22ff0a` (the default branch, unchanged since 2026-10-25).

| Draft | Branch | Checked |
|---|---|---|
| [PR 1: replacements aren't a new `seen`](docs/drafts/sidecar-pr1.md) | `fix/replacement-not-seen` (`4184aec`, 4 files) | Builds. New test fails without the fix (4 of 7, `seen` called 9 times instead of 1). Executor suite 393 passed, against 386 on `master` |
| [PR 2: per-entity budgets, pure-precompile allowlist](docs/drafts/sidecar-pr2.md) | `feat/per-entity-budgets-precompiles` (`2d4018f`, 6 files) | Builds. 10 new tests fail without the change. Executor suite 396 passed. Suggests an issue first, with text |
| [Issue: eviction by the sender's own consumed key](docs/drafts/sidecar-issue-eviction.md) | none | Grounded in ERC-8421's PROPAGATION-040, with a code sketch |

**End to end:** both branches merged locally (`local/integration-pr1-pr2`, not for upstream) and run as our devnet's sidecar with **no `precompiles` config**: `scripts/e2e.ts local` passed 34/34. The devnet's usual sidecar was put back afterwards.

**Live sources that differed:**
- **BUDGET-010 now says how to attribute frames.** Per ERC-8421's text at ethereum/ERCs#2028 (head `493ba8ac`), a `pre_verify` frame counts toward its approving frame's entity, and an `expiry_verify` frame toward no entity. Our patch charged `expiry_verify` to the sender. The PR 2 branch follows the ERC.
- **The sidecar's CONTRIBUTING.md says Yarn and Lerna,** but the repo builds with bun. I used bun.
- On both `master` and the branches, 5 executor test files fail to load before running (missing generated EntryPoint types and similar). They're pre-existing and untouched.

### Part D: shared-sender reputation and MATCHA, measured
`research/shared-sender/`: a harness with one command per target, raw JSON in `results/`, write-up in [RESULTS.md](research/shared-sender/RESULTS.md). Local chains only.

| Target | Command | Ran |
|---|---|---|
| ERC-8421 sidecar without the replacement fix | `research/shared-sender/run-sidecar.sh nofix` | Yes |
| ERC-8421 sidecar with the fix | `research/shared-sender/run-sidecar.sh fix` | Yes |
| ethrex `64b8fc09` | `research/shared-sender/run-ethrex.sh 64b8fc09` | Yes |
| ethrex `247e2dd2` (MATCHA), 64-block finality lag | `research/shared-sender/run-ethrex.sh 247e2dd2` | Yes, after a dev-producer patch (`patches/ethrex-dev-hegota-247e2dd2.patch`) |

**Headline results (measured):**
- **Replacement spam, 10 bumps:** sidecar without the fix `seen` +10, with it +1. MATCHA: 1 of 10 accepted, leaving the pool 27,380 width for everyone.
- **4 holders × 5 bumps:** sidecar `seen` +22 without the fix, +6 with it. MATCHA: all 20 accepted, width 20.5M → 11.3M (21 charges), none returned.
- **Conflicts across nodes:** the non-mining sidecar ends at `seen 3, included 0` with or without the fix.
- **Mass invalidation:** 6 of 6 withdrawals stay valid after every change, on all four targets. Statically, the validator reaches no state-reading opcode.
- **MATCHA calibration:** about 438,550 width per additional withdrawal; about 994,000 credited per landed withdrawal at finality; a fresh pool admits 1 of 3; 6 honest withdrawals at once cost 8 charges (3 for revalidation).
- **Below-base-fee parking:** refused at admission by all three clients.

**Things I noticed:**
- Docker had quit earlier (Part B). Starting it brought back an unrelated container, stopped again.
- Each sidecar instance needs its own WebSocket port; the default collides with the devnet's sidecar. Fixed in the wrapper.
- My first harness runs had bugs (a 0-wei tip the node refuses, a stale MATCHA pool, a spam step that only replaced the free baseline). The results in `results/` are from the final version, run on 2026-11-17.

### Part E: research and outreach drafts, not sent
All in `docs/drafts/`: `reply-nethermind-thread.md`, `reply-matcha-thread.md`, `support-eip-8250-8272.md`, `ethresearch-post-outline.md`, `esp-office-hours-request.md`, `grant/evidence.md`, `grant/proposal-skeleton.md`. Their numbers are from Parts B and D and chain 8141; calculated figures are marked. Both forum threads were re-read on 2026-11-17 for the replies.

### Part F: SDK design, for approval
[`docs/sdk-design.md`](docs/sdk-design.md): package layout, a type-safe API with the profile as a type parameter, admission simulation across ethrex, the sidecar and a partial Nethermind fallback, fee bumps that re-prove through a callback, how Relayless would consume it, release 0.1, and seven open questions. Nothing implemented.

## Stage 2: refocus (branch `refocus`, started 2026-11-16)
The positioning is `docs/landscape.md`. The hackathon version stays reachable at the tag `v1.0-ethglobal-mumbai`, and everything below the Stage 2 sections describes it.

### Part 1: lock the hackathon version
| Step | State |
|---|---|
| `main` matches what was judged | Yes. Local `main`, `origin/main` and GitHub's API all point to `8262d04` (2026-11-07 01:08 IST), the last commit before today |
| Tag `v1.0-ethglobal-mumbai` | Annotated, on `8262d04`, pushed on the author's go-ahead |
| README award line | Added on `refocus` |
| ENS deployer roles | **Subregistry roles revoked** on the author's go-ahead: [`relayless`](https://sepolia.etherscan.io/tx/0x6beffc108950ff5151d5db1385bc98b1fefb7ae4f71aefe95c10a2da9265894e) (183,842 gas), [`asp`](https://sepolia.etherscan.io/tx/0x009fcc27a0aec74d2372764fcd9433b17ec0d511adc38cd07ae99ba355527bbd) (169,213 gas) |

**ENS roles, as read from Sepolia on 2026-11-16 before revoking.** The deployer is `0x04f1D2215933f26f07c343511a7E05717273e6BE`.
- `relayless` in the .eth registry `0xd4eb…a8b4`: it holds `SET_SUBREGISTRY` and `SET_RESOLVER`, plus the admin bits for `SET_SUBREGISTRY`, `SET_RESOLVER` and `CAN_TRANSFER_ADMIN` (bitmap `0x1110…01100000`).
- `asp` in R1 `0xa301…87F2`: it holds `SET_SUBREGISTRY` and its admin bit (bitmap `0x1000…00100000`).

**The prepared revocation:** `revokeRoles(tokenId, SET_SUBREGISTRY | ADMIN(SET_SUBREGISTRY), deployer)`, sent once on each registry. Both pass `eth_call` from the deployer and are estimated at 196,633 and 212,780 gas. After sending, the deployer's roles on `asp` are `0x0`, and on `relayless` only `SET_RESOLVER`, its admin bit and the `CAN_TRANSFER_ADMIN` admin bit remain (`0x1100…01000000`). It holds no root role on R1 that could grant `SET_SUBREGISTRY` back, both registries still report `isEmancipated() == true`, and both names still point to the same registries. The author chose to keep `SET_RESOLVER`.

**Working setup:** the submitted repo is `relayless-ethglobal`, not the older `relayless` folder. GitHub is reached over HTTPS through `gh`, because a global `insteadOf` rule rewrites `https://github.com/` to SSH and no SSH key is loaded.

### Part 2: remove ENS, World ID and Nym; make the association set provider-agnostic
Done on `refocus`. Details and reasons are in `DECISIONS.md` under Stage 2.

| What | State |
|---|---|
| ENS (`packages/ens`, screens, live-site build, Sepolia scripts and config) | Removed. Still in the tag. The local `apps/web/dist-ens` build output isn't in git, so it was left on disk |
| Stealth payments (`stealth.ts`, `payStealth`, announcer) | Removed. Reasons in `DECISIONS.md` |
| World ID (IDKit, `world.ts`, `/join`, env vars, docs) | Removed |
| Nym (transport, toggle, notes) | Removed |
| `AssociationSetProvider` in the SDK | Added: `sourceId`, `currentRoot`, `membershipProof`, `status`. Reference: `allowlistProvider` over `apps/asp`. Guide: `docs/association-sets.md` |
| Ragequit and public exit | Unchanged, and passing in `e2e-asp` |
| `pnpm typecheck`, `pnpm build` | New root scripts. Both clean |

**Test results, 2026-11-16, on a fresh local stack** (ethrex `9aa3645d` plus the patched sidecar):

| Suite | Result | Before |
|---|---|---|
| Circuits | 13/13 | 13/13 |
| Contracts (Foundry, including fuzz) | 26/26 | 26/26 |
| SDK | 29/29 | 43/43, of which 21 were ENS and stealth tests, now removed. 7 new recent-root and provider tests |
| ASP server | 15/15 | 26/26, of which most were World ID and ENS tests. Rewritten for the allowlist, plus two HTTP tests against the SDK provider |
| `scripts/e2e.ts` | 34/34 | 34/34 |
| `scripts/e2e-asp.ts` | 10/10 | 7/7. The forgery check is now three, and a source and on-chain root check was added |
| `pnpm typecheck` | clean | no such script |
| `pnpm build` | clean (an existing chunk-size warning) | |

**Live check of the reference ASP server:** `demo:reset` approved a wallet through `POST /allow`. The server published the root, and `demo-prep` confirmed it on the chain with the SDK's `checkRecentRoot` ("verified"). The new Get approved screen typechecks and builds, but **it hasn't been run in a browser.**

**Removed suites,** still in the tag: `e2e-ens` (48), `e2e-world` (7), ENS Foundry (16).

**Things I noticed:**
- The ASP's state file is now keyed by pool address. The old one, `.relayless/asp-local-asp.json`, belonged to the previous chain's pool, and the server refused it. It's left in place.
- Docker Desktop was started for the stack, and it restarted other containers on this machine (nitia, zebra-testnet, lightwalletd and others). They're still running.

### Part 3: the spec-port plan
`docs/spec-port.md`, written and committed. **Waiting for the author's go-ahead before Part 4.**

What it found, in short:
- **Three profiles, not two:** `devnet-8421` (sidecar), `hegota-8141` (chain 8141, ethrex `64b8fc09`), and `eips-current` (Nethermind master).
- **The sidecar and hegota-support speak only the devnet profile.**
- **The verification estimate** is about 250k declared, and compression would save about 25k.
- **The risks** are funding on chain 8141, standing up the two client stacks, the ethrex-only simulation RPC, and re-measuring the SENDER state pin.

### Part 4: the port, to two profiles
Done on `refocus`, with the author's decisions: two profiles now (`devnet-8421`, `hegota-8141`), a table ready for `eips-current`, a local ethrex `64b8fc09` chain only, and compression after the port. Reasons are in `DECISIONS.md`. Gas figures are in `docs/gas-report.md`.

| What | State |
|---|---|
| Profile table | `packages/sdk/src/profiles.ts`, and the validator generator's `PROFILES`. A pool's config names its profile |
| `hegota-8141` codec | Ours. Pinned to ethrex's golden vector, and the live chain 8141 node decodes it |
| Validator | One generator, one build per profile. The `devnet-8421` build is semantically unchanged |
| Pool contract | Recent-root contract and staking registry are constructor arguments |
| Local `hegota-8141` chain | `scripts/local-stack-hegota.sh`: ethrex `64b8fc09` in dev mode, plus a dev-producer-only patch |
| SENDER floors re-measured | Execution 861,786 of 1,500,000 at full depth. State: at most 566,100 seen, of 1,000,000. Minimums unchanged |
| Hostile recipients | `scripts/adversarial.ts`, 10 cases, each a real withdrawal |
| CI | `.github/workflows/ci.yml`: unit suites on every push, both profiles' e2e on demand and nightly. **Not yet run on GitHub**, because the branch isn't pushed |
| Compression docs | The wrong SHA-256 reason is corrected in `DECISIONS.md`, `docs/code-tour.md` and `docs/gas-report.md`. The README never gave it |

**Test results, 2026-11-16:**

| Suite | `devnet-8421` | `hegota-8141` |
|---|---|---|
| Circuits | 13/13 (shared) | |
| Contracts (Foundry; fuzz at 10,000 runs) | 29/29 (shared; 3 new tests for the constructor) | |
| SDK | 39/39 (shared; 10 new: codec, profiles, frame layout) | |
| ASP server | 15/15 (shared) | |
| `scripts/e2e.ts` | **34/34** | **32/32**. The two alt mempool checks become public-mempool checks |
| `scripts/e2e-asp.ts` | **10/10** | **10/10** |
| `scripts/adversarial.ts` (new) | **10/10** | **10/10** |
| `scripts/gas-floors.ts` (new) | pass: 861,779 | pass: 861,786 |
| `pnpm typecheck`, `pnpm build` | clean | |

**New gas figures, `hegota-8141`:**
- Recent-root frame: 5,579 (one root) or 8,010 (two).
- Pool VERIFY frame: 233,383, plus 97,920 state for the nullifier slot.
- Validation used: 238,962. Declared: 308,100.
- SENDER frame: 183,810–230,515 execution, plus 379,440–477,360 state.
- Total, fresh recipient: about 980,000–1,030,000.

**Things I noticed:**
- At `64b8fc09`, ethrex's dev mode can't produce Hegotá blocks without the patch, though its docs say `--dev` stays available.
- The fee-bump check passes on `hegota-8141` without bumping anything: blocks every ~2 s mine the first transaction before the bump. It's exercised on `devnet-8421`.
- The unrelated Docker containers were stopped on the author's request (stopped, not removed). The Relayless devnet and its sidecar are still running, and so is the local `hegota-8141` node (`pkill -f 'ethrex.*hegota-stack'` stops it).
- The old `packages/contracts/generated/validator.json` (git-ignored) is no longer read, and was left on disk.

### Part 5: deployed and exercised on chain 8141
**5/5 on the public chain, 2026-11-16.** Pool `0x6d58de3fc7d80705ef2077b1d3b6aef1e87bb225`, validator `0x72fb50da9fe63c68bf886ffc1e6a97e9d097421c`. Every transaction, with explorer links, is in the README's [Public testnet](README.md#public-testnet) section. The deployer was a throwaway key (`0x5D5d…5e61`, in git-ignored `.env.hegota-8141`) funded by the author from the faucet with 1 ETH.

| Step | Result |
|---|---|
| Deposit | 5 × 0.02 ETH |
| Private withdrawal to a fresh 0-ETH address | Received 0.014999 ETH. 941,778 gas, every frame succeeded. Gas on the public chain matches the local `hegota-8141` chain exactly for the root and VERIFY frames (5,579 and 233,383) |
| Double spend | Refused before broadcast, on the nonce |
| Concurrent withdrawals | 3 of 3 pending at once. Shows the relaxed per-sender rule; chain 8141 has no MATCHA width budget |
| Ragequit | Paid the depositor |

The sequence is in `docs/testnet-run.md`. What was prepared:

| What | State |
|---|---|
| Network | Chain 8141: RPC `rpc1.privacy.ethrex.xyz` (open), explorer [Dora](https://dora.privacy.ethrex.xyz), faucet at faucet.privacy.ethrex.xyz (the author claimed from it) |
| Admission | Permissionless transactions, 500,000 verify budget, relaxed per-sender rule for disjoint keys, no MATCHA width budget |
| `scripts/testnet-key.sh` | Fresh throwaway key in `.env.hegota-8141` (git-ignored) |
| `scripts/testnet-preflight.ts` | **Passes against chain 8141**, read-only: chain id, client `64b8fc09`, recent-root code hash, nonce manager, slots, and our encoding decoded by the node |
| `scripts/testnet-run.ts` | Deposit, private withdrawal to a 0-ETH address, double spend refused, concurrent withdrawals, ragequit. **Rehearsed 5/5 on the local `hegota-8141` chain** |
| README [Public testnet](README.md#public-testnet) | Filled from the run's output |
| Funds needed | About 0.15 ETH on chain 8141 |

## Hackathon status (as judged)

Last checked 2026-11-06, on the running stack: ethrex `9aa3645d` plus sidecar with `patches/sidecar-budget-010.patch` and a `precompiles` config. The alt mempool authors confirmed a local sidecar is fine for judging.

### What works
| What | Evidence |
|---|---|
| Withdrawal to a 0-ETH wallet: no relayer, pool pays gas from the note | `scripts/e2e.ts`, browser run below, [gas report](docs/gas-report.md) |
| Canonical mempool rejects it, patched alt mempool admits it | **Compare mempools** panel, on live nodes. `scripts/e2e.ts` |
| One sender, many users: 3 pending at once, each with its own nonce key | **Live mempool** panel. `scripts/e2e.ts` |
| Recovery from one signature, any-amount payments, change notes | `scripts/e2e.ts` |
| Anonymity meter, and a k-gate in the circuit | Circuit tests, `scripts/e2e.ts` |
| SENDER frame can't revert after APPROVE | Foundry fuzz and adversarial tests, `scripts/e2e.ts` |
| Association set and public exit | `scripts/e2e-asp.ts` |
| World ID, on **staging** with the simulator | [Below](#world-id-against-the-real-staging-service) |
| ENSv2 directory and private names, on Sepolia | [Live page](https://relayless-ens.vercel.app), `scripts/e2e-ens.ts`, [addresses](https://github.com/jatinsahijwani/relayless-ethglobal/blob/v1.0-ethglobal-mumbai/README.md#on-sepolia) |
| Nym route for ENS reads, off by default | [Below](#nym-mixnet), [notes](docs/nym-notes.md) |
| Findings, each reproducible | [Repro](docs/repro-gateway.md), [upstream write-up](docs/upstream-pr.md), [analysis](docs/reputation-analysis.md) |

### Test results
Every suite was run on 2026-11-06, after the demo aids were added.

| Suite | Result |
|---|---|
| Circuits | 13/13 |
| Contracts (Foundry, including fuzz) | 26/26 |
| SDK | 43/43 |
| ASP server | 26/26 |
| ENS (Foundry, on forked Sepolia with the deployed contracts) | 16/16 |
| `scripts/e2e.ts`, on the running stack | 34/34 |
| `scripts/e2e-asp.ts` | 7/7 |
| `scripts/e2e-world.ts` (World's verdict faked) | 7/7 |
| `scripts/e2e-ens.ts`, real Sepolia plus the live devnet | 48/48 |
| Sidecar: mempool, validation and `eth` suites only | 213/213, **from an earlier run, not repeated** |

**Fresh clone, in a temporary folder, with the running stack left alone:** install, circuits 13, contracts 26, SDK 43, ASP 26, ENS 16, web typecheck and the ENS page build all passed. The ENS suite failed once on an RPC error (`block not found`) and passed on rerun.

**`scripts/local-stack.sh` from that clone was skipped this time.** It needs ports 18545 and 14337 and the same Docker project as the running stack, and the chain mustn't be restarted, so it stopped at its port check, as designed. Its last full run from a fresh clone passed in about 13 minutes, before the ENS, Nym and demo work. Those added no steps to it.

With the optional fee-bump limit on, `scripts/e2e.ts` last passed 30/30, on an earlier run with fewer checks.

### Browser runs
| Run | Result |
|---|---|
| Whole demo path at 1280×720 and 390px: 0 ETH to 0.05 ETH, proving counter, compare panel, 3 pending at once, meter | Worked. No console errors, no horizontal overflow, only the local app contacted, no key rendered |
| Landing and `/findings` at both widths | Worked, no console errors, no overflow |
| Live link, 390px, Nym off: directory, `alice.relayless.eth`, derive twice | Directory in 6 s, lookup in 1 s. Console shows the public RPC's 429s, which retry |
| Live link, 390px, Nym on: same steps | Directory in 59 s, lookup in 2 s. No browser request to a Sepolia RPC, no console errors |
| Live link, new build, 1280×720 and 390px: `/findings` directly and from the landing page | Worked. No console errors or failed requests on `/findings`, no overflow. The landing page shows the same 429s, which retry |

These are headless Chromium runs on a laptop. The two Nym off and Nym on runs above were on the previous live build and weren't repeated on this one.

### World ID against the real staging service
Browser, real World proofs through the simulator, on the local chain:

| Path | Result |
|---|---|
| Verified | `POST /join` 200, approved root published, private payment landed |
| Invalid proof | World rejected it: `POST /join` 400, nothing approved, payment stayed refused |
| Same World ID, second wallet | `POST /join` 409, refused |
| Window closed, or cancelled then closed | "You cancelled", public exit offered, retry works |
| Never approved | Private payment refused; public exit returned the money to the depositor |

The app contacted no outside host until Verify was clicked.

### ENSv2
| Check | Result |
|---|---|
| World ID ASP server restarted with a stale record | [Published by itself](https://sepolia.etherscan.io/tx/0x17d50267d237591b0aeefde7df44086601c24440e9b8178454c47c9ec378ea00) |
| Approving a depositor on the second ASP | [Published by itself](https://sepolia.etherscan.io/tx/0x5320d9afd562ba5713c9cfe174d00b290e2637234008596ada4e31e6f34a071a) |

Key transactions: [register `relayless.eth`](https://sepolia.etherscan.io/tx/0xd8da7a14f61c6e90709a638b435cf15547ea8ea26d4db37f1b7a08b10a9aaed4), [register `asp`](https://sepolia.etherscan.io/tx/0x498e39e8242fbd46f10d7f54dc6fd5dad48eb45911c3929387aa2c7f90be0d2e), [register `world`](https://sepolia.etherscan.io/tx/0x831d30c21853fda6c58890526bf6550a69169dc709a2d0b23619389e7016c42c), [operator role and records](https://sepolia.etherscan.io/tx/0x77a66869be169e3c0de0344901a9862d5588e4dc08d898ba2e983fd758ad2db5).

### Nym mixnet
| Check | Result |
|---|---|
| Deployed preview, 6 full runs with Nym on, laptop | 4 worked, 2 ended in the failure message |
| Live link, Nym on, 3 runs across two sessions | All worked, about 53–70 s to the directory |
| Author's own check on the preview, by hand | Reported working in 4 tests, and on a phone. Not timed |
| Nym off | Default; 18 MB chunk not fetched, no Nym hosts contacted |
| Local app with Nym on | Sepolia routed, local chain and approval server direct, verdicts right |

### Griefing, measured
| Experiment | Result |
|---|---|
| 8 fee bumps from one note, before our fix | `seen` 0 → 8, `included` 1 |
| Same, after our fix | `seen` 0 → 1, `included` 1 |
| Same note sent to two nodes, 2 notes, after our fix | Non-mining node: `seen 2, included 0`. **Still open** |

### What's untested
- World ID in production, or with a real World App.
- A real browser wallet: an injected test wallet stood in, on a fork.
- Claiming through the live page on real Sepolia: the e2e script claimed through the same SDK call.
- The World ID ASP publishing after a real World ID approval: a restart and the second ASP's approval use the same publisher.
- The private payment and scan through the browser's ENS screens: the e2e script covers those paths.
- `/join` in the browser since the ENS work: `scripts/e2e.ts` covers the pool, not the World ID screen.
- Proving on a real phone.
- Nym on a slow connection, with a real wallet, with a claim, or over Tor.
- Throttle and ban thresholds, which are calculated, not reached in a run.
- Anon-RPC isn't integrated: its docs list no devnet support.
- ENSIP-26 agent records weren't added.

### Known issues
- **ethrex loses block numbers.** On 2 of 2 fresh chains, blocks from about 149 lost their number lookup, about 15 minutes after genesis. Cause unknown. The SDK reads around it and fails loudly if a gap hid pool data. Written up in `docs/upstream-pr.md`.
- **Griefing across nodes is limited, not solved.**
- **The main pool's reputation settles one short:** `seen 31, included 30` after this run, and the same gap of 1 before. **It's unexplained.** The run includes a deliberate fee bump, which may be why.
- **VERIFY gas varies by a few hundred between runs,** and the cause isn't pinned down. See the [gas report](docs/gas-report.md).
- **Unexplained, seen once:** on one chain, large deployments stopped mining while small transactions kept going. A fresh chain past its hole deployed normally. If deploys hang, start a fresh chain.
- A young chain can briefly report a root as not yet referenceable. The SDK retries before broadcasting.
- Same seed on two devices can still race on one note.
- A public Sepolia RPC rate-limits the live page, so the console shows 429s that retry.

### Links
**Public devnet** ([explorer](https://explorer.altmempool.wtf/): search by hash, and its history is in memory, so these can disappear):
- Contract sender with a nonce key and a root reference, block 401126: `0x6f39d1fe8c3828025fe8f21baf3ac012acedc6a2d7b87371eae9f54d62ccef99`
- Keyed nonces, workshop step 12: `0x8fc566abddd6a77a4dc6fd26eb31285c44eabb4d0df4851495fd7108ea0d2acd`
- Recent root reference, workshop step 13: `0x8eb575751505fdc906729eeefbf0657da34a9aad618afaa76d0f3a291cf2377e`

**Withdrawals have no public link.** The public gateway refuses them (`docs/repro-gateway.md`), and our chains are private. A real one from the last run, on a chain you can recreate with `scripts/local-stack.sh`: `0x6971448b24aa413325b20c96c4afed464d5f8d3d6c62b2eb93da280e86182d3f`.
