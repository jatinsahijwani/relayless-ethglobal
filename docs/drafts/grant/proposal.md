# Privacy-ready frame transactions for Hegotá

**Draft ESP proposal. Not submitted.** Submit it when a matching Wishlist item or RFP opens, or after the ESP Office Hours call, reshaped by what that call says. Every "today" figure is measured, names its spec profile (`devnet-8421` or `hegota-8141`), and is listed with its link in [`evidence.md`](evidence.md). Calculated figures are marked *calc.*

| | |
|---|---|
| **Applicant** | *[Team: to fill]* |
| **Project** | Relayless and frame-tx-sdk |
| **Requested** | *[Amount: to fill, see Budget]*, paid in ETH, per milestone |
| **Duration** | Core scope about 6 months; extended scope 9–12 months |
| **Licenses** | frame-tx-sdk: MIT. Relayless: GPL-3.0 (circomlib is compiled into its circuits). Upstream contributions take the upstream project's license |
| **Repository** | https://github.com/jatinsahijwani/relayless-ethglobal |

## Summary
EIP-8141 frame transactions, EIP-8250 keyed nonces and EIP-8272 recent roots let a privacy pool be its own sender and pay gas from the note being withdrawn. A wallet with no ETH and no history can then be paid privately, with no relayer. Relayless has done this end to end on the Hegotá privacy testnet (chain 8141), and has found and fixed problems that every pool built this way will hit in mempools.

What's missing before wallets and other teams can rely on the pattern is the layer around the pool:
- mempools that treat a shared sender fairly;
- a maintained reference for the ERC-8421 alternative mempool (optional, pending its author's confirmation);
- a reusable frame-transaction SDK;
- a compliance layer any association-set provider can plug into;
- a withdrawal path in Kohaku;
- public numbers anyone can reproduce.

This proposal funds those six pieces, and can be cut to the subset reviewers prefer.

## The problem
- **One sender, many users.** A privacy pool on frame transactions is a single sender for everyone who uses it. Mempool protections were designed for senders that act for themselves: ERC-8421's reputation counts transactions admitted but never mined, and MATCHA charges width for admissions. So one note holder can spend the standing everyone shares. Measured locally:
  - On the reference ERC-8421 sidecar, without a fix, 10 fee bumps of one note cost the pool 10 `seen` for 1 inclusion (`devnet-8421`).
  - On ethrex with MATCHA, four holders bumping 20 times in one burst spent 9,209,898 of the pool's width, 21 charges never returned, for the price of four withdrawals (`hegota-8141` profile, local ethrex `247e2dd2`).
- **Validation costs more than the base cap.** A Groth16 withdrawal declares 268,100 gas of validation on `hegota-8141`, against EIP-8141's 100,000 `MAX_VERIFY_GAS`. It's admitted by chain 8141 (500,000) and by Nethermind's default (300,000), but the public ERC-8421 gateway refuses it outright (`devnet-8421`).
- **Every team rewrites the plumbing.** A codec per spec revision, keyed nonces, recent-root frames, fee and `maxCost` arithmetic, and "will the mempool take this?". It changes with every EIP revision, and getting it wrong costs a shared sender reputation or width.
- **Privacy needs a compliance path to be usable,** and wallets need a way in. Today there's no pluggable association-set layer for frame-transaction pools, and no frame-transaction path in Kohaku.

## Why now
- **Hegotá ([EIP-8081](https://eips.ethereum.org/EIPS/eip-8081)) schedules EIP-8141, but only *considers* EIP-8250 and EIP-8272.** Every privacy pool on frames depends on both. Working users with numbers are what move "considered" to "scheduled".
- **Mempool policy for shared senders is being designed now.** MATCHA's authors list testing mass invalidation, width draining and honest throughput as their next steps. ERC-8421 is still a draft, its reference sidecar speaks only an early EIP-8272 form, and [EIP PR #12301](https://github.com/ethereum/EIPs/pull/12301) would turn `MAX_VERIFY_GAS` into a shared floor. Measurements from a working pool are useful before these settle, and much less useful after.
- **The drafts change monthly.** Three of the four relevant EIP files changed in October 2026. A shared SDK with one profile per revision is cheaper than every team chasing each change alone.

## What exists today
| What | Status | Link |
|---|---|---|
| 1st place, EF: Best use of the Frame Transaction Alternative Mempool, ETHGlobal Mumbai 2026 | Public | Tag [`v1.0-ethglobal-mumbai`](https://github.com/jatinsahijwani/relayless-ethglobal/tree/v1.0-ethglobal-mumbai) |
| Relayless on chain 8141 (`hegota-8141`): two deployments, 5/5 each | Public | [Public testnet](https://github.com/jatinsahijwani/relayless-ethglobal#public-testnet) |
| Each run: deposit; private withdrawal to a 0-ETH address (**916,820 gas**, 268,100 validation declared, 213,492 used); double spend refused before broadcast; 3 concurrent withdrawals in one block; public exit | Public | [Withdrawal](https://dora.privacy.ethrex.xyz/tx/0x543a9ad335af2202d696d9bdae7c242c30f952f44f06b9eb512dbdfc24236ed8) |
| Statement compression (eprint 2025/1500), pool VERIFY 233,383 → 207,913 (`hegota-8141`) | Public | [Gas report](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/docs/gas-report.md) |
| Upstream, ERC-8421 reference sidecar: a replacement isn't a new `seen` (REPUTATION-040), with a test that fails without it | Open, awaiting review | [PR #9](https://github.com/forshtat/mempool-workshop-sidecar/pull/9) |
| Upstream: an eviction rule for shared senders | Open | [Issue #10](https://github.com/forshtat/mempool-workshop-sidecar/issues/10) |
| Upstream: pure precompiles allowed by default, with a ready branch | Open | [Issue #11](https://github.com/forshtat/mempool-workshop-sidecar/issues/11) |
| Shared-sender research harness: the ERC-8421 sidecar with and without the fix, ethrex `64b8fc09`, ethrex `247e2dd2` (MATCHA). One command per target | Public | [RESULTS.md](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/research/shared-sender/RESULTS.md) |
| **frame-tx-sdk 0.1** (MIT): profiles `devnet-8421` and `hegota-8141`, keyed nonces, recent-root frames, admission simulation, a broadcast guard, fee bumps that re-prove. 46 unit tests; integration tests pass on live local chains of both profiles. Relayless runs on it | **To be published** | *[link when published]* |
| **Kohaku prototype:** a Relayless plugin that unshields as a frame transaction through Kohaku's plugin interface. A real withdrawal to a fresh 0-ETH address on a local `hegota-8141` chain (973,582 and 993,581 gas in two runs) | **Local branch**, not upstream | [Design](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/docs/kohaku-design.md) |
| Pluggable association sets: `AssociationSetProvider`, with an allowlist reference and public exit (ragequit) | Public | [docs/association-sets.md](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/docs/association-sets.md) |

## Workstreams
Each milestone ends in something a reviewer can check: a merged or reviewed PR, a published package, a passing suite, or a results page.

### 1. Shared-sender mempool safety
**Why:** a pool's users share one reputation and one width budget, so each mechanism needs a rule that doesn't punish everyone for one holder.

| Milestone | Deliverable | Measured by |
|---|---|---|
| 1.1 Sidecar fixes landed | PR #9 merged, or revised to the maintainers' review; issues #10 and #11 resolved into code or a written decision | Upstream status. Measured before and after: a 20-bump burst moves `seen` +22 without the fix, +6 with it (`devnet-8421`) |
| 1.2 The eviction rule | An implementation for the sidecar, and a proposed ERC-8421 text change | A non-mining node ends a cross-node conflict at `seen n, included n`, not `seen n, included 0` |
| 1.3 MATCHA for state-free senders | An ethrex patch charging less for revalidating senders whose validation reads no mutable state, measured with the harness, and a write-up for MATCHA's authors | Revalidation charges in an honest burst (3 of 8 today, `hegota-8141`, local `247e2dd2`) before and after; the replacement bound unchanged |
| 1.4 Replacement pricing | A measured proposal for pricing or rate-limiting replacements of additional transactions | Width a 20-bump burst can drain (9,209,898 today) under each variant |
| 1.5 The harness, wider | Gossip between sidecars, more than one ethrex node, full blocks, and Nethermind | Results published per target, with exact revisions |

### 2. Bringing the ERC-8421 reference sidecar up to date with the current ERC (optional)
**Optional, pending the sidecar author's confirmation.** This is done with the author, not around him. If he prefers otherwise, the workstream drops out and its budget with it.

**Why:** the reference sidecar (`forshtat/mempool-workshop-sidecar`, last commit `2e22ff0a`, 2026-10-25) speaks only the `devnet-8421` profile, with recent roots as an envelope field. Today's EIP-8272 text carries them in a VERIFY frame. Parts of the ERC's current text, for example how BUDGET-010 attributes `pre_verify` and `expiry_verify` frames, were written after it. A reference that matches the ERC is what client teams and app developers test against.

| Milestone | Deliverable | Measured by |
|---|---|---|
| 2.1 Conformance map | Every MUST and SHOULD in the current ERC-8421 text, mapped to sidecar code, a test, or "missing", agreed with the author | The map, published |
| 2.2 Current transaction format | The sidecar accepts the current frame-transaction envelope and EIP-8272 frame form, alongside the old one | Golden vectors from a client following the current texts |
| 2.3 Rules brought up to date | Missing rules implemented in the order the author picks, each with a test that fails without it | Tests in the sidecar's suite |

### 3. frame-tx-sdk
**Why:** one maintained library instead of every team's own codec, nonce and admission code.

| Milestone | Deliverable | Measured by |
|---|---|---|
| 3.1 Release 0.1 | Published on npm, MIT, with docs and examples | npm; the quickstart works on a fresh machine |
| 3.2 `eips-current` and Nethermind | A profile for today's EIP texts (total `max_fee`, signature-length elision, single-use keys, new predeploys), and an admission path for Nethermind | Golden vectors and integration tests against a running Nethermind node |
| 3.3 Signers and paymasters | P256, owner-set and hardware-wallet flows; a paymaster pattern | Examples and tests |
| 3.4 Adoption | At least one team outside Relayless uses it, or a written account of why not | A dependent repository, or the write-up |

### 4. A pluggable association-set layer
**Why:** a compliance path is what lets people who must show where funds came from use a privacy pool.

| Milestone | Deliverable | Measured by |
|---|---|---|
| 4.1 A second provider | An adapter for an existing association-set provider (for example 0xbow's ASP) | It passes the same `e2e-asp` suite as the reference (10 checks on each profile today) |
| 4.2 Several providers per pool | A contract and validator design, implemented, with gas measured | Gas per extra root (8,010 for two roots against 5,579 for one today, `hegota-8141`) |
| 4.3 A conformance suite | A test any provider can run, and a guide | Third-party provider passes it |

### 5. A Kohaku frame-transaction withdrawal path
**Why:** Kohaku is where wallets meet privacy, and frame transactions let a Kohaku wallet withdraw to a fresh address without a relayer, paymaster or bundler.

| Milestone | Deliverable | Measured by |
|---|---|---|
| 5.1 Fit agreed | The design (written) reviewed with Kohaku's maintainers: plugin or Privacy Pools mode, `Broadcaster` or host capability, simulation route | A written agreement, or a decision not to proceed |
| 5.2 License path | A route for the MIT/GPL question (the client side relicensed or rewritten under MIT; the circuit artifacts handled the way Kohaku already handles circuits) | Agreed with the maintainers |
| 5.3 On chain 8141 | The path, on published dependencies, on chain 8141 | Gas and admission measured on at least two clients |
| 5.4 Hand-off | Merged upstream, or a maintained adapter, as the maintainers prefer | Upstream status |

### 6. Public benchmarks: verification gas and CPU per proof system
**Why:** verify budgets, MATCHA's safety factor and FOCIL caps need numbers from real verifiers. Nethermind's follow-up already found a real circuit costing about 3.3× more CPU per gas than a synthetic one.

| Milestone | Deliverable | Measured by |
|---|---|---|
| 6.1 A benchmark suite | Verification gas inside a VERIFY frame and CPU time per gas, for Groth16 (BN254) and at least two other proof systems a pool might use, on ethrex and Nethermind | Reproducible with one command |
| 6.2 A results page | Published, and updated for each EIP revision and client release during the grant | The page |
| 6.3 Comparisons | Relayless next to minimal-shielded-pool and any other frame-transaction pool, with each project's authors invited to check their figures | Their review |

## Two scopes
| Workstream | Core (about 6 months) | Extended (9–12 months) |
|---|---|---|
| 1. Shared-sender safety | 1.1–1.4 | + 1.5 |
| 2. Sidecar up to date *(optional)* | 2.1 | + 2.2, 2.3 |
| 3. frame-tx-sdk | 3.1, 3.2 | + 3.3, 3.4 |
| 4. Association sets | none | 4.1–4.3 |
| 5. Kohaku | 5.1, 5.2 | + 5.3, 5.4 |
| 6. Benchmarks | 6.1, 6.2 (Groth16 and one other system) | + 6.3, more systems |

Reviewers can take any subset. Workstreams 1, 3 and 6 stand alone. Workstream 5 needs 3.1. Workstream 2 depends only on its author's go-ahead.

## Timeline (core scope)
| Month | Work |
|---|---|
| 1 | 3.1 SDK release. 1.1 sidecar fixes through review. 2.1 conformance map, if confirmed. 5.1 Kohaku fit review |
| 2 | 1.2 eviction rule. 6.1 benchmark suite, first two proof systems |
| 3 | 1.3 MATCHA revalidation patch, measured. 3.2 `eips-current` profile |
| 4 | 3.2 Nethermind admission path. 1.4 replacement pricing |
| 5 | 6.2 results page. 5.2 license path |
| 6 | Write-ups, a final report, and everything re-run on the then-current client releases |

The extended scope adds months 7–12: 1.5, 2.2–2.3, 3.3–3.4, workstream 4, 5.3–5.4 and 6.3.

## Team
*[To fill: who, background, time commitment, and relevant links (the ETHGlobal Mumbai 2026 result, the chain 8141 runs, the upstream PR and issues).]*

## EF team interest
*[To fill after conversations: which EF teams have said the work is useful, in their own public words or with their permission. Don't name individuals or quote private messages without consent.]*

## Budget
Amounts are left blank on purpose.

| Milestone | Core | Extended |
|---|---|---|
| 1.1–1.2 Sidecar fixes and the eviction rule | | |
| 1.3–1.4 MATCHA proposals, measured | | |
| 1.5 Harness: gossip, multi-node, full blocks, Nethermind | | |
| 2.1 Sidecar conformance map *(optional)* | | |
| 2.2–2.3 Sidecar brought up to date *(optional)* | | |
| 3.1 SDK 0.1 | | |
| 3.2 `eips-current` and Nethermind | | |
| 3.3–3.4 Signers, paymasters, adoption | | |
| 4.1–4.3 Association sets | | |
| 5.1–5.2 Kohaku fit and license path | | |
| 5.3–5.4 Kohaku on chain 8141 and hand-off | | |
| 6.1–6.2 Benchmarks and results page | | |
| 6.3 Comparisons | | |
| Infrastructure (testnet ETH, CI runners for both profiles' e2e) | | |
| **Total** | | |

**How to size it:**
- **Honest rates:** a time estimate per milestone times an hourly or monthly rate that would be ordinary for open-source protocol engineering. Don't pad it to a round number.
- **Milestone-based:** each row pays on its deliverable being checkable, not on time spent.
- **Optional rows are separate,** so cutting workstream 2 removes exactly its cost.
- **ETH payment:** state the conversion date the amounts assume.

## Open-source commitment
- Everything built under the grant is public from the first commit: no private repositories, no closed components, no hosted service anyone depends on.
- frame-tx-sdk stays MIT. Relayless is GPL-3.0 because circomlib's GPL-3.0 templates are compiled into its circuits (see `NOTICE.md`). Contributions to other projects take their license.
- Results ship with the commands that produced them.

## CROPS alignment
- **Censorship resistance:** no relayer. A withdrawal is the pool's own transaction, so any node that admits it can include it, and the work here is about making mempools admit shared senders fairly.
- **Open source:** see above.
- **Privacy:** a fresh wallet receives money with nobody funding it, so gas funding links nothing.
- **Security:** the SDK refuses to broadcast a transaction a node hasn't simulated and admitted; the pool's SENDER frame can't revert after approval. The trusted setup is devnet-grade, and nothing is audited. The grant doesn't claim otherwise and doesn't fund a mainnet deployment.

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| The EIPs change again | One profile per revision in the SDK and the validator generator, so a change is a new table entry plus its golden vectors |
| EIP-8250 or EIP-8272 isn't scheduled | The mempool, SDK and benchmark work is still useful for EIP-8141 alone; we'll say plainly which results depend on which EIP |
| Upstream maintainers prefer other designs | Issues before PRs, measurements with every proposal, and optional workstreams that drop out cleanly |
| The sidecar's author doesn't confirm workstream 2 | It's optional and separately budgeted |
| Kohaku's direction doesn't fit, or the license question has no answer | 5.1 and 5.2 come first, and 5.3 starts only if both are agreed |
| Local measurements don't match production | Exact revisions for every result, multi-node and full-block runs in 1.5, and re-runs on new releases |

## How success will be measured
- Upstream: the three sidecar changes merged or answered with a written decision; the MATCHA proposals discussed with their authors, with numbers.
- The SDK published, used by Relayless and at least one other project, with its integration tests passing on each supported profile.
- Benchmarks reproducible with one command, and cited in at least one EIP or ERC discussion.
- Kohaku: an agreed decision, either way, and if yes a withdrawal on chain 8141 through Kohaku.
- Every figure in every write-up marked with its profile and revision, and anything calculated marked *calc.*

## What we won't do
- Claim the pool primitive. It follows soispoke's minimal-shielded-pool.
- Run attacks against public networks. The harness runs on local chains only.
- Deploy to mainnet. The trusted setup is devnet-grade and nothing is audited.

## AI usage
The design, the research questions, the measurements, the decisions and the review are the author's. The implementation used Claude Code, under the author's direction, as the README's "AI usage" section describes.
