# Draft: ESP Office Hours request

**Not sent.** Text for the Ecosystem Support Program's Office Hours form. Field names vary; the sections below map onto the usual ones (project, what you need, background). Keep it under the form's length limits: the "What we'd like feedback on" section is the one to protect if you have to cut.

---

**Project name:** Relayless

**One-line description:** A privacy pool on EIP-8141 frame transactions that pays gas from the note being withdrawn, so a wallet with no ETH and no history can be paid privately without a relayer, running on the Hegotá privacy testnet (chain 8141).

**Links:**
- Repository: https://github.com/jatinsahijwani/relayless-ethglobal
- Live runs on chain 8141, with explorer links: https://github.com/jatinsahijwani/relayless-ethglobal#public-testnet

**What we'd like feedback on (the reason for the call):**
1. **Fit with EF priorities.** We think the useful work now isn't another pool primitive (soispoke's minimal-shielded-pool leads there) but the layer around one: shared-sender safety in alternative mempools and MATCHA, a reusable frame-transaction SDK, a pluggable association-set layer, and public benchmarks. Does that match where the EF's privacy and account-abstraction efforts want help, or is there a gap we're missing?
2. **Kohaku.** Is a frame-transaction withdrawal path for Kohaku wanted, and who should we talk to before designing one?
3. **Preparing for a future Wishlist or RFP.** We'd like to apply when a matching Wishlist item or RFP opens. What does a strong application in this area look like, and what evidence should we have ready (beyond working code, testnet runs and upstream contributions)?
4. **Scope.** Of the five workstreams we're considering, which one or two would you fund first, if any?

**What exists today (measured, linked in the repository):**
- 🥇 1st place, EF: Best use of the Frame Transaction Alternative Mempool, ETHGlobal Mumbai 2026.
- Deployed twice on chain 8141, 5/5 each time: a private withdrawal to a wallet holding 0 ETH, a double spend refused before broadcast, three concurrent withdrawals from one sender in one block, and a public exit. The current withdrawal uses 916,820 gas and declares 268,100 gas of validation, under Nethermind's 300,000 default, after compressing the public inputs (eprint 2025/1500).
- Upstream contributions to the ERC-8421 sidecar, opened 2026-11-18: [PR #9](https://github.com/forshtat/mempool-workshop-sidecar/pull/9) (replacement counting, REPUTATION-040), [issue #10](https://github.com/forshtat/mempool-workshop-sidecar/issues/10) (an eviction rule for shared senders), [issue #11](https://github.com/forshtat/mempool-workshop-sidecar/issues/11) (pure precompiles by default, CALLING-040, with a ready branch).
- A reproducible harness that attacks a shared sender in an ERC-8421 sidecar and in ethrex with and without MATCHA, with results published in the repository: https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/research/shared-sender/RESULTS.md

**Team:** *one line on the author.*

**What we're not asking for:** funding decisions on the call. We'd like direction before writing a proposal.

---

## Notes for the author
- The form changes; check its current fields and limits before pasting.
- If the shared-sender results are merged by then, link `research/shared-sender/RESULTS.md` directly.
- Don't attach the proposal skeleton yet. It reads better after the call, shaped by the answers.
