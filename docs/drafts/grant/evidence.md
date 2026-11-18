# Evidence log

A running log of every public result, with links, for grant applications. **Add a row whenever something becomes public.** Rows marked *prepared* or *local* aren't public yet: they're listed so nothing is forgotten, and must not be cited as public until they are.

Last updated: 2026-11-18.

## Recognition
| Date | What | Link |
|---|---|---|
| 2026-11 | 🥇 1st place, EF: Best use of the Frame Transaction Alternative Mempool, ETHGlobal Mumbai 2026 | Judged version tagged [`v1.0-ethglobal-mumbai`](https://github.com/jatinsahijwani/relayless-ethglobal/tree/v1.0-ethglobal-mumbai) |

## Public testnet: chain 8141 (Hegotá privacy testnet, ethrex `64b8fc09`)
| Date | What | Link |
|---|---|---|
| 2026-11-16 | First pool (7 public inputs). 5/5: deposit, private withdrawal to a 0-ETH wallet (941,778 gas), double spend refused before broadcast, 3 concurrent withdrawals, ragequit | Pool [`0x6d58de3f…`](https://dora.privacy.ethrex.xyz/address/0x6d58de3fc7d80705ef2077b1d3b6aef1e87bb225), withdrawal [`0x9671febc…`](https://dora.privacy.ethrex.xyz/tx/0x9671febcc7365da4f5761559979b6776e0271ff12efbb6e6eac7ba508ffc2ef4) |
| 2026-11-17 | Second pool, compressed statement (3 public signals). 5/5 again. Withdrawal **916,820 gas**, pool VERIFY 207,913, validation declared 268,100 (under Nethermind's 300,000 default) | Pool [`0xab5d3d27…`](https://dora.privacy.ethrex.xyz/address/0xab5d3d27d192af9bcb1eafc953ba695baea0c7be), withdrawal [`0x543a9ad3…`](https://dora.privacy.ethrex.xyz/tx/0x543a9ad335af2202d696d9bdae7c242c30f952f44f06b9eb512dbdfc24236ed8), 3 concurrent in one block: [`0x7dabc6e6…`](https://dora.privacy.ethrex.xyz/tx/0x7dabc6e6d7d93be1e2a589f1458b0cce291cc8589b9eef7d19daadc134181e1b) |

## Code in our repository
| Date | What | Link |
|---|---|---|
| 2026-11-07 | Hackathon build: circuits, pool, validator generator, SDK, web app | PRs [#1](https://github.com/jatinsahijwani/relayless-ethglobal/pull/1)–[#4](https://github.com/jatinsahijwani/relayless-ethglobal/pull/4) |
| 2026-11-17 | Stage 2 merged: refocused core, provider-agnostic association sets, spec profiles `devnet-8421` and `hegota-8141`, chain 8141 deployment | [PR #5](https://github.com/jatinsahijwani/relayless-ethglobal/pull/5) |
| 2026-11-17 | Statement compression (eprint 2025/1500), on-chain alias checks, new chain 8141 pool. *Open* | [PR #7](https://github.com/jatinsahijwani/relayless-ethglobal/pull/7) |
| 2026-11-17 | Docs fixes after the merge. *Open* | [PR #6](https://github.com/jatinsahijwani/relayless-ethglobal/pull/6) |

## Findings
| Date | Finding | Status | Where |
|---|---|---|---|
| 2026-11 | The public ERC-8421 gateway can't admit any Groth16 withdrawal: its 100k cap applies even to staked senders (`250000 exceeds MAX_VERIFY_GAS 100000` from a staked sender), and precompiles count as undeployed code (COD-010) | Reproduced. BUDGET-010 half covered by upstream PRs #2–#4; precompile half opened as [issue #11](https://github.com/forshtat/mempool-workshop-sidecar/issues/11) | [`docs/repro-gateway.md`](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/docs/repro-gateway.md) |
| 2026-11 | The sidecar counts every fee-bump replacement as a new `seen` (ERC-8421 REPUTATION-040): 8 bumps took a shared sender's `seen` from 0 to 8 | Confirmed as a prototype bug by the alt mempool authors; fix opened as [PR #9](https://github.com/forshtat/mempool-workshop-sidecar/pull/9) | [`docs/upstream-pr.md`](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/docs/upstream-pr.md) |
| 2026-11 | A non-mining node charges a shared sender for a conflicting transaction that was mined elsewhere (`seen 3, included 0` for three pairs, [RESULTS.md](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/research/shared-sender/RESULTS.md)) | Opened as [issue #10](https://github.com/forshtat/mempool-workshop-sidecar/issues/10) | [`docs/reputation-analysis.md`](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/docs/reputation-analysis.md) |
| 2026-11-16 | The hackathon's reason for not compressing public inputs (SHA-256 in the circuit) was wrong: the hybrid scheme uses Poseidon | Corrected, then compression shipped | `DECISIONS.md` |

## Upstream contributions
| Date | What | Link | What it shows |
|---|---|---|---|
| 2026-11-18 | `forshtat/mempool-workshop-sidecar` PR: replacements aren't a new `seen` (REPUTATION-040), with a test that fails without it | [PR #9](https://github.com/forshtat/mempool-workshop-sidecar/pull/9) | A spec-conformance bug fix to the ERC-8421 reference sidecar, measured: a 20-bump burst moves `seen` +6 instead of +22 |
| 2026-11-18 | Same repo, issue: an eviction caused by the sender's own consumed nonce key shouldn't count against it | [Issue #10](https://github.com/forshtat/mempool-workshop-sidecar/issues/10) | A proposed reputation rule for shared senders, grounded in PROPAGATION-040 and a measured `seen 3, included 0` |
| 2026-11-18 | Same repo, issue: allow pure precompiles by default (CALLING-040), with a ready, tested branch | [Issue #11](https://github.com/forshtat/mempool-workshop-sidecar/issues/11), [branch](https://github.com/jatinsahijwani/mempool-workshop-sidecar/tree/feat/pure-precompiles-default) | The fix that lets proof-verifying senders through the public gateway, with the safety argument |

## Research
| Date | What | Status |
|---|---|---|
| 2026-11 | Shared-sender reputation griefing under ERC-8421, measured | Public in the repo: [`docs/reputation-analysis.md`](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/docs/reputation-analysis.md) |
| 2026-11-17 | Shared senders against an ERC-8421 sidecar (with and without the fix), ethrex `64b8fc09` and ethrex `247e2dd2` (MATCHA): conflicts, replacement spam, width draining, mass invalidation, honest throughput | Public: [RESULTS.md](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/research/shared-sender/RESULTS.md) |
| | ethresear.ch post on shared senders, reputation and MATCHA | *drafted, not posted* (`docs/drafts/ethresearch-post-outline.md`) |
