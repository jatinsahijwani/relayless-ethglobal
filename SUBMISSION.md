# Submission

**Relayless: pay anyone privately, from a wallet with no history. No relayer. It tells you how hidden you are before you pay.**

- **Repo:** https://github.com/jatinsahijwani/relayless-ethglobal
- **Live page (ENS directory and private names, on Sepolia):** https://relayless-ens.vercel.app
- **Video:** *link to be added*

## The problem
A fresh wallet has no history, which is what makes it private, and no ETH, which means it can't do anything. If you fund it, you've linked it to yourself. If a relayer pays, someone sees your IP, can refuse you, and has to exist.

## What it does
EIP-8141 frame transactions let a privacy pool be the sender and pay gas from the note being withdrawn. Your browser proves the note is yours, and the wallet receives money holding 0 ETH, with nobody funding it.

On top of that:
- One seed, nothing to back up: everything rebuilds from the chain and one signature.
- Any amount: change notes, and payments that split across notes, all pending at once.
- A meter that shows how hidden you are, with a k-gate enforced in the proof.
- An optional association set with a public exit, using World ID on staging.
- ENSv2 as the directory of approvers, and private receive names.
- An optional Nym route for ENS reads.

## What's real, and what isn't
| Part | State |
|---|---|
| Core withdrawal path | Works on a local devnet: ethrex `9aa3645d` plus a patched sidecar. **The alt mempool authors confirmed this is fine for judging.** The public gateway can't admit these transactions yet |
| World ID | Works on the staging service with World's simulator. Production and a real World App aren't tested |
| ENSv2 | Deployed on Sepolia, with a live link |
| Nym | Optional, covers ENS reads only. Transaction submission still goes directly to the mempool node |
| Demo crowd | **56 seed deposits from throwaway keys.** Labelled as demo data in the README |
| Security | Not audited. The Groth16 setup is devnet-grade |

## Numbers
All of these come from [docs/gas-report.md](docs/gas-report.md), the source of truth.

| What | Number |
|---|---|
| Verification gas | **253,176**, against the canonical 100,000 cap |
| Total gas, fresh recipient | About 900,000 |
| Proving | About 2 s in a browser on a laptop. Not timed on a phone |
| Withdrawal circuit | 24,965 constraints, 7 public inputs |
| Tests | Circuits 13, contracts 26, SDK 43, ASP 26, ENS on forked Sepolia 16, e2e 34, association set 7, World ID 7 (World's verdict faked), ENS e2e on real Sepolia 48. Sidecar: 213, last run earlier |

## What we found
Details and repros are on the [findings page](https://relayless-ens.vercel.app/findings) and in the [README](README.md#findings-for-the-alt-mempool).
1. The public gateway rejects on-chain ZK verification, twice: a 100k cap that ignores stake, and precompiles refused during validation.
2. Fee bumps inflated reputation. The authors confirmed it's a prototype bug, and it's fixed in our patch.
3. A note owner can grief the shared sender across nodes. **This is still open**, and it needs a rule change.

## Video outline (under 3 minutes)
The click-by-click version is in [docs/video-shotlist.md](docs/video-shotlist.md).

| Time | Segment |
|---|---|
| 0:00 | The problem |
| 0:15 | The 0-ETH moment |
| 0:50 | Same withdrawal, two mempools |
| 1:20 | 3 people at once, one sender |
| 1:45 | How hidden you are |
| 2:05 | ENS, World ID and Nym |
| 2:35 | Findings |
| 2:55 | Close |

## Try it
- **On your phone, with nothing to install:** the [live page](https://relayless-ens.vercel.app).
- **The whole thing:** `scripts/local-stack.sh && pnpm web`. See [Run it](README.md#run-it).

## Disclosures
- [Before vs during the hackathon](README.md#before-vs-during-the-hackathon)
- [AI usage](README.md#ai-usage)
- [Prior work](README.md#prior-work)
- [Limitations](README.md#limitations)
- [Licenses](NOTICE.md)
