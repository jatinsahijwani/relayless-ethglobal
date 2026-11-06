# Demo script (3 minutes)

This is the spoken script for showing a judge in person. For the recorded video, use [video-shotlist.md](video-shotlist.md).

It runs on the local stack, which the alt mempool authors confirmed is fine for judging. Say so out loud (see "Be accurate").

Before you start: run `pnpm demo:reset` and then `pnpm demo:prep`, which must be all green. Open http://127.0.0.1:5199/?demo=1.

## 0:00 The problem (20 s)
*Show the Connect screen.*

> "You want to pay from a fresh wallet with no history. But a fresh wallet has no ETH for gas. If you fund it, you've linked it to yourself. If you use a relayer, someone sees your IP, can refuse you, and has to exist. Relayless removes that choice."

## 0:20 One seed (20 s)
*Click **Use the demo wallet**. It already holds approved notes, from `demo:reset`.*

> "One signature from your wallet derives everything. There's no new backup. These deposits were public, as any deposit is. What happens next isn't."

## 0:40 The moment (45 s)
*The Pay screen shows the new wallet's balance, 0 ETH. Pause on it. Leave "A new wallet of mine, holding zero ETH" selected, and pay 0.05 ETH.*

> "That's the recipient's real balance, read from the chain: zero ETH. It can't pay for anything. Nobody funded it, and there's no relayer. Here, my browser proves in about two seconds that this money is mine."

*Wait for it to change.*

> "There it is. The pool itself sent this transaction and paid the gas from my note, then refunded what gas didn't use."

## 1:25 Under the hood (25 s)
*Open the **Under the hood** tab and click **Compare mempools**. Then click **Pay 3 people at once**.*

> "Same bytes to both mempools, as a dry run. Checking the proof takes about 253,000 gas. The canonical cap is 100,000, so it's rejected. The alt mempool gives a staked entity a bigger budget, so it's admitted. And here are three people paying at once, all from one sender, because each nullifier is its own nonce key."

## 1:50 How hidden am I? (30 s)
*Go to **Privacy**.*

> "Every dot is a deposit, sized by how suspicious it looks from outside. Mine's in marigold. This says how easily I could be picked out, and what would actually help. Funding the wallet myself would score zero. It's a model, and it says so. If I want a guarantee I can demand a minimum number of notes after mine, enforced inside the proof."

## 2:20 Any amount, recovery (25 s)
*Go to **Recover**. Click **Find my money**.*

> "If I lose this device, one signature rebuilds everything from the chain. Change notes included. And a payment bigger than any one note just splits, with all the parts pending at once, because every withdrawal has its own nullifier as a nonce key. That's what lets one pool serve many users at once."

## 2:45 What we learned (15 s)
> "A shared sender has a shared reputation. So the frame that moves money can't revert, validation reads no storage, and we measured how a note owner could grief the pool. It's all written up, including what the pool can't fix alone."

## Be accurate on camera
- **Say it's the local stack:** "This runs on a local devnet with a small sidecar patch, because the public gateway doesn't yet allow verification over 100k."
- Don't say "anonymous" without "the model estimates". The node you submit to sees your IP.
- World ID works on **staging** with the simulator. Production and a real World App aren't tested. The demo wallet is approved by the allowlist ASP's operator, not World ID.
- ENSv2 is live on Sepolia. The pool is on the local devnet.
- The dots are seed data. Say so if asked, and it's labelled in the README.
- Nym covers ENS reads only. The RPC still sees the names looked up, but not your IP. Transactions still go directly to the mempool node.

## ENS segment (30 s)
Before you start: the local app is on the **ENS** tab with a test wallet that has private money, `alice.relayless.eth` is claimed, and the recipient's wallet is ready to scan.

*Show **ASPs**. Point at the green check on `world.asp.relayless.eth`, then the warning on `forged-demo`.* (10 s)

> "These are privacy pool approvers, found by name. There's no list in the app: it reads ENSv2 subnames. Each root is checked against the pool's own chain, so this one passes, and this deliberately wrong one gets a warning. The operator's key can edit only this root and policy. Not even the parent name can change them."

*Go to **Names**. Look up `alice.relayless.eth`. Pay it. Pay it again. Two different addresses appear.* (12 s, cut the waiting)

> "Pay a name, not an address. The name holds a stealth record, so each payment goes to a new one-time address, paid from the pool. Same name, two addresses, and nothing on-chain connects them."

*Switch to the recipient's wallet. Click **Find my payments**. Both appear.* (8 s)

> "Only Alice's viewing key can find them. Her scan fetches every announcement, so even the node can't tell which are hers."

If you're showing the public link instead, say that payments run on the local devnet: the page says so too.

## If something fails live
Stay calm and name what failed. Nothing here needs a chain restart, and **don't restart the chain**: a new one takes about 13 minutes and has to get past its block-number hole.

| What fails | What it looks like | Do this |
|---|---|---|
| **Anything, with no time** | | Play the backup video: `docs/img/demo.gif` for the payment, and the recorded video file for the rest. Keep the video on the laptop as well as online |
| A payment is rejected | "not approved", or a used wallet | Run `pnpm demo:reset`, reload the page, and click **Use the demo wallet**. It takes about 40 s |
| A note has no root yet | "not yet referenceable" | Wait 10 s and try again. The SDK retries before broadcasting |
| The block is slow | Stuck on "Waiting for a block" | Keep talking: slots are 6 s, and it's usually a few. If it passes a minute, run `pnpm demo:prep` to see what's red |
| "This mempool node is limiting the pool" | Pool throttled or banned | Don't retry. Use the backup video. `seen` decays over 24 hours, and `demo:prep` shows the numbers |
| Sidecar or web app down | Connection errors | `pnpm demo:prep` prints what to run for each. `pnpm demo:asp` and `RELAYLESS_NETWORK=local-asp2 pnpm web` are safe to restart |
| **Nym won't connect** | "Try a new connection" or "Turn off Nym" | Click **Turn off Nym and connect directly**. It says so on screen and never goes direct by itself. Say: "4 of 6 test runs connected. When it fails, it stops and asks." |
| The Sepolia RPC rate-limits | ASPs load slowly | Reads back off and fall through to a second RPC, so wait. Otherwise show the explorer links below |
| The live page won't load | | Show the explorer links below, and the same screens in the local app's **ENS** tab |

**Explorer links to show instead**

All on Sepolia, and they stay up without anything of ours running:
- [`relayless.eth` registry](https://sepolia.etherscan.io/address/0xa30168D50Dfa55C2bCe1ed726F86eAFeA3Af87F2)
- [`asp.relayless.eth` directory](https://sepolia.etherscan.io/address/0x1511b0aF97942f939b4F7369b016fAc70ee6033F)
- [World ID ASP's resolver](https://sepolia.etherscan.io/address/0x335dd5348EbEA119DB2644831801C290ECF0B4e7)
- [Allowlist ASP's resolver](https://sepolia.etherscan.io/address/0x891eE68599a0fCcFF956Ee07eB14417255c0B27E)
- [Name claimer](https://sepolia.etherscan.io/address/0x0a1f421cd39dd9015483d6c16aec6ffc819cd85b)
- [An ASP root published by itself](https://sepolia.etherscan.io/tx/0x5320d9afd562ba5713c9cfe174d00b290e2637234008596ada4e31e6f34a071a)

The withdrawals themselves are on a private chain, so they have no public link. The public devnet's [explorer](https://explorer.altmempool.wtf/) shows the Phase 0 contract-sender transaction: `0x6f39d1fe8c3828025fe8f21baf3ac012acedc6a2d7b87371eae9f54d62ccef99`. Its history is in memory, so it can disappear.
