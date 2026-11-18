**Not sent.** Draft email. Numbers checked against `research/shared-sender/RESULTS.md` on 2026-11-18; all match.

Subject: MATCHA measurements from a second shared-sender pool on chain 8141

Hi Thomas,

I'm Jatin, building Relayless, a pool-as-sender privacy pool now live on chain 8141. Your minimal-shielded-pool is our main reference, and it's credited in the repo.

I tested MATCHA (ethrex 247e2dd2) against shared-sender attacks:
- A burst of 20 fee bumps from 4 note holders spent 9.2M of the pool's width (20.5M → 11.3M, 21 charges), paying only for the four withdrawals that landed.
- Mass invalidation failed (validation reads no mutable state), yet 3 of 8 charges in an honest burst went to revalidation.

Two suggestions: a lower revalidation charge for senders whose validation reads no mutable state, and pricing or rate-limiting replacements of additional transactions. The harness and numbers: https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/research/shared-sender/RESULTS.md

Would this be useful as input to MATCHA? I can rerun with any parameters you'd like.

Best,
Jatin
