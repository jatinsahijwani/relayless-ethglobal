# Video shotlist (under 3 minutes)

The exact clicks for the outline in [SUBMISSION.md](../SUBMISSION.md). Record at 1280×720.

## Before each take
```sh
pnpm demo:reset   # a new wallet and fresh recipient, about 40 s
pnpm demo:prep    # everything must be green
```

- Open two tabs: **A** at http://127.0.0.1:5199/?demo=1, and **B** at https://relayless-ens.vercel.app.
- Close other tabs, and set zoom to 100%.
- Wait for tab B's directory to finish loading, so it's on screen at once.
- Load the Nym clip as a cutaway (see 2:05). Don't connect Nym live in a take: it takes over a minute.

## The shots
| Time | Tab and URL | Do this | On screen | Say |
|---|---|---|---|---|
| 0:00–0:15 | A, `/?demo=1` | Nothing | "Pay from a wallet with no history", crowd animating, QR | "A fresh wallet has no history and no ETH. Fund it and you've linked it to yourself. Use a relayer and someone sees you, can refuse you, and has to exist." |
| 0:15–0:22 | A | Click **Use the demo wallet** | Pay screen: **The new wallet holds 0 ETH**, private balance, crowd | "This wallet really holds zero, read live from the chain." |
| 0:22–0:30 | A | Leave 0.05. Click **Pay 0.05 ETH** | **Proving… 1.2 s** counting up | "My browser proves this money is mine, on this device." |
| 0:30–0:50 | A | Wait. **Cut the block wait in the edit** if it's long | Stages ticking, then **0.05 ETH** with the highlight | "Nobody funded it. No relayer. The pool sent this transaction and paid the gas out of my note." |
| 0:50–1:20 | A, tab **Under the hood** | Click **Compare mempools**, then wait about 3 s | Side by side: **Rejected**, `300100 > 100000 (MAX_VERIFY_GAS)`, beside **Would admit**: stake, reputation, gas against budget | "Same bytes to both. A dry run, so nothing is sent. The canonical mempool has a flat 100k cap. The alt mempool gives a staked entity a bigger budget, and about 253k fits." |
| 1:20–1:45 | A, same tab | Scroll to **Live mempool**. Click **Pay 3 people at once**. Keep the rows in view | **3 pending now**, three different nonce keys, then each **confirmed in block N** | "One sender, three users, all pending together. Each nullifier is its own nonce key, and validation reads no storage, so they can't invalidate each other." |
| 1:45–2:05 | A, tab **Privacy** | Scroll slowly | Dot chart, "picked out of about N", bits, comparison table | "Each dot is a deposit, and these are demo seed data. This is a model, and it says so. If I want a guarantee, I can require notes after mine, inside the proof." |
| 2:05–2:20 | B, **ASP directory** | Point at `world`, then `forged-demo`. Click into roles if there's time | Directory from ENSv2, roles | "Approvers are found by ENS name, with no list in the app. The roles are enforced by ENSv2 contracts: the operator can edit only its root." |
| 2:20–2:28 | B, **Private names** | Type the full name, `alice.relayless.eth` (bare `alice` won't resolve). Click **Look up**, then derive twice | Two different one-time addresses | "Pay a name, and each payment goes to a new address." |
| 2:28–2:35 | Cutaway: World ID and Nym clips, or the README table | Nothing | Staging label visible | "World ID runs on staging with the simulator. Nym optionally hides your IP from the Sepolia RPC. It covers ENS reads only: transactions still go straight to the mempool node." |
| 2:35–2:55 | A, `/findings?demo=1` | Scroll to the precompile box | Three findings, safety argument | "Three findings, each with a repro. We fixed two locally, and one's still open and needs a rule change. Allowing precompiles is safe because they read no state, so they can't mass-invalidate anything." |
| 2:55–3:00 | A, `/findings?demo=1`, at the QR | Hold | QR | "This runs on a local devnet with a patched sidecar, which the authors confirmed is fine for judging. Scan to try the ENS part yourself." |

## Say these accurately
- It's the local stack with a small sidecar patch. The public gateway can't admit these yet.
- Don't say "anonymous" without "the model estimates". The node you submit to sees your IP.
- **The demo wallet was approved by the allowlist ASP's operator, not World ID.** Don't imply it went through World ID.
- The 56 dots are seed data.
- With Nym on, the RPC still sees the names looked up. It just can't tie them to your IP.
- The panel shows live gas, about 253k. It varies by a few hundred gas between proofs (see the [gas report](gas-report.md)), so say "about 253,000".
- Don't time proving out loud as a promise. It's about 2 s on this laptop, and hasn't been timed on a phone.

## Optional clips, recorded separately
- **World ID:** on the [local app](http://127.0.0.1:5199/), go to **ENS**, pick `world.asp.relayless.eth`, then **Get approved**, and use the staging simulator.
- **Nym:** open https://relayless-ens.vercel.app/?nym=1. Connecting takes about 25–35 s and the first directory load about 90 s, so cut the wait. If it fails, retake: 4 of 6 test runs worked.

If a take goes wrong, see the [failure plan](demo-script.md#if-something-fails-live).
