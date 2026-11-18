**Not sent.** Draft email. Numbers checked against `research/shared-sender/RESULTS.md` on 2026-11-18. The third contribution is the precompile-only issue (#11), since BUDGET-010 is already covered by upstream PRs #2–#4.

Subject: Relayless: sidecar fixes and shared-sender reputation data for ERC-8421

Hi Alex, hi Pierre,

I'm Jatin. Relayless won your track at ETHGlobal Mumbai, and since then I've kept building it as a public good. Three contributions to the sidecar are now open:

- PR: a replacement is not a new `seen` (REPUTATION-040): https://github.com/forshtat/mempool-workshop-sidecar/pull/9
- Issue: don't count an eviction caused by the sender's own consumed nonce key: https://github.com/forshtat/mempool-workshop-sidecar/issues/10
- Issue: allow pure precompiles by default (CALLING-040), with a ready branch: https://github.com/forshtat/mempool-workshop-sidecar/issues/11

They're backed by measurements on a shared pool sender: with the fix, a 20-bump burst moves `seen` +6 instead of +22, and a non-mining node still ends at `seen 3, included 0` from conflicts that each landed once. Full results: https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/research/shared-sender/RESULTS.md

Relayless is also live on chain 8141 now, with compressed proofs (268k declared validation).

I'd like to keep contributing to ERC-8421, especially shared-sender rules. Is there a part you'd want me to take on? I'm happy to do a 20-minute call.

Best,
Jatin Sahijwani
github.com/jatinsahijwani
