# Proposal skeleton: Privacy-ready frame transactions for Hegotá

**Superseded on 2026-11-22 by [`proposal.md`](proposal.md).** Kept for its history.

**Draft for the author.** Structure and milestones only; the budget is left blank on purpose. Every "today" figure is measured and linked in [`evidence.md`](evidence.md).

## Summary (one paragraph, to write last)
Frame transactions (EIP-8141), keyed nonces (EIP-8250) and recent roots (EIP-8272) let a privacy pool be its own sender and pay gas from the note being withdrawn, so a wallet with no ETH and no history can be paid privately without a relayer. Relayless has shown this end to end on the Hegotá privacy testnet (chain 8141). What's missing before wallets and other teams can rely on it is the layer around the pool: mempools that treat a shared sender fairly, a reusable SDK, a compliance layer any provider can plug into, a path into Kohaku, and public numbers anyone can reproduce. This proposal funds those five pieces.

## The team
- *Author: background, the ETHGlobal Mumbai 2026 win (1st place, EF: Best use of the Frame Transaction Alternative Mempool), links.*
- *How AI tools are used, as in the README's "AI usage" section.*

## Where things stand (today)
- A working pool on chain 8141 since 2026-11-16: private withdrawal to a 0-ETH wallet, double spend refused before broadcast, concurrent withdrawals from one sender, public exit.
- Withdrawal 916,820 gas; validation declared 268,100, under Nethermind's 300,000 default, after compressing the statement (eprint 2025/1500).
- Two spec profiles (`devnet-8421`, `hegota-8141`), with suites passing on both: 34 and 32 end-to-end checks, 10 hostile-recipient cases, full-depth gas floors, alias checks.
- Three upstream changes to the ERC-8421 sidecar prepared, and a shared-sender attack harness run against an ERC-8421 sidecar and two ethrex revisions, one with MATCHA.

## Workstreams

### 1. Shared-sender mempool safety
**Why:** a privacy pool is one sender for many users. ERC-8421 reputation and MATCHA width were designed for senders that act for themselves; one user of a shared sender can spend the reputation or width of all of them.

| Milestone | Measurable outcome |
|---|---|
| 1.1 Upstream the sidecar fixes | The replacement-counting fix (REPUTATION-040) and per-entity budgets with a pure-precompile default (BUDGET-010, CALLING-040) merged or reviewed in `forshtat/mempool-workshop-sidecar`, with tests |
| 1.2 The eviction rule | An eviction caused by the sender's own consumed nonce key stops counting against it, in the sidecar and proposed for ERC-8421's text. Measured: a non-mining node ends a cross-node conflict at `seen n, included n`, not `seen n, included 0` |
| 1.3 MATCHA for a shared sender | A measured proposal for how MATCHA should charge a sender whose validation reads no storage, with the harness's numbers before and after, shared with the authors |
| 1.4 A public harness | `research/shared-sender` runs with one command per target, against at least the sidecar, ethrex (with and without MATCHA) and Nethermind, and its results are published |

### 2. A frame-transaction viem SDK
**Why:** every team rewrites the same codec, nonce, recent-root and admission plumbing for each EIP revision. See [`docs/sdk-design.md`](../../sdk-design.md).

| Milestone | Measurable outcome |
|---|---|
| 2.1 Release 0.1 | Published package with the `devnet-8421` and `hegota-8141` profiles, golden-vector tests against ethrex, admission simulation for ethrex and the sidecar |
| 2.2 Relayless on top of it | Relayless's suites pass unchanged on the package, and the bytes it sends are identical |
| 2.3 `eips-current` and Nethermind | A third profile for today's EIP texts, and an admission path for Nethermind, tested against a running node |
| 2.4 Adoption | At least one team outside Relayless using it, or a written reason why not |

### 3. A pluggable association-set layer
**Why:** compliance is what lets a privacy pool be used by people who need to show where funds came from. Relayless has a provider interface and an allowlist reference; real providers need more.

| Milestone | Measurable outcome |
|---|---|
| 3.1 A second provider | An adapter for an existing association-set provider (for example 0xbow's ASP), passing the same `e2e-asp` suite as the reference |
| 3.2 Several providers per pool | A design and implementation for more than one source per pool, with its gas measured (each extra root costs about 2,400 in the root frame today) |
| 3.3 Provider guide | A guide any provider can follow to plug in, with a conformance test |

### 4. A Kohaku frame-transaction withdrawal path
**Why:** Kohaku is where wallets will meet privacy. A frame-transaction withdrawal path there would let a Kohaku wallet withdraw to a fresh address with no relayer.

| Milestone | Measurable outcome |
|---|---|
| 4.1 Fit study | A written comparison of Kohaku's withdrawal flow with a frame-transaction one, agreed with Kohaku's maintainers before building |
| 4.2 Prototype | A Kohaku withdrawal through a frame transaction on chain 8141, with its gas and its admission on at least two clients measured |
| 4.3 Hand-off | Merged upstream, or a maintained adapter, as Kohaku's maintainers prefer |

*Kohaku's current scope and maintainers to be confirmed before submitting.*

### 5. Public benchmarks
**Why:** decisions about verify budgets, MATCHA charges and inclusion caps need numbers from working applications, and today those numbers are scattered across forum posts.

| Milestone | Measurable outcome |
|---|---|
| 5.1 A benchmark suite | Withdrawal gas by frame, validation declared and used, proving time (laptop, browser, phone), and admission under each client's default budget, reproducible with one command |
| 5.2 A results page | Published and updated for each EIP revision and client release during the grant |
| 5.3 Comparisons | Relayless next to the reference pool (minimal-shielded-pool) and any other frame-transaction pool, with each one's authors invited to check the figures |

## Timeline
*To fill: workstreams in order of dependency. 1.1 and 2.1 first; 4 after 2.1.*

## Budget
*Left blank.*

## Risks
- The EIPs are drafts and change; each change means a new profile. Mitigation: the profile table, and the SDK's per-profile tests.
- Upstream maintainers may prefer other designs. Mitigation: issues before PRs, and the harness's numbers.
- Kohaku's direction may not fit. Mitigation: milestone 4.1 is a fit study, and 4.2 only starts if it's agreed.

## What we won't do
- Claim the pool primitive as ours: it follows soispoke's minimal-shielded-pool.
- Run attacks against public networks: the harness runs on local chains only.
- Mainnet deployment: the trusted setup is devnet-grade and nothing is audited.
