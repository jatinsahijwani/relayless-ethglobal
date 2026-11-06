# Demo script (3 minutes)

The prize needs the lead property shown end to end, including the moment it matters. This runs on the local stack, which the alt mempool authors confirmed is fine for judging. Say so on camera (see the last section).

Before you start: stack running, some deposits already in the pool from other wallets so the crowd isn't empty, and the browser at the Connect screen.

## 0:00 The problem (20 s)
*Show the Connect screen.*

> "You want to pay from a fresh wallet with no history. But a fresh wallet has no ETH for gas. If you fund it, you've linked it to yourself. If you use a relayer, someone sees your IP, can refuse you, and has to exist. Relayless removes that choice."

## 0:20 One seed (20 s)
*Click **Use a test wallet**, then **Add money**, and add 0.1 ETH.*

> "One signature from your wallet derives everything. There's no new backup. This deposit is public, as any deposit is. What happens next isn't."

## 0:40 The moment (45 s)
*Go to **Pay**. Leave "A new wallet of mine, holding zero ETH" selected. Pay 0.05 ETH.*

*The screen becomes the wallet's balance. Pause on it.*

> "That's the recipient's real balance, read from the chain: zero ETH. It can't pay for anything. Nobody funded it, and there's no relayer. Here, my browser proves in about two seconds that this money is mine."

*Wait for it to change.*

> "There it is. The pool itself sent this transaction and paid the gas from my note, then refunded what gas didn't use."

## 1:25 Under the hood (25 s)
*Open **Under the hood**.*

> "Three frames: check the proof, pay and record the change, refund. Checking the proof took about 253,000 gas, which is why this needs the alt mempool: the canonical mempool's limit is 100,000, and it rejects this same transaction. 17 of 17 rule checks passed here."

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
- Compliance is only claimable up to what's built: association set and public exit work locally. **Don't claim World ID or ENS until they're integrated.**

## ENS segment (30 s)
Before you start: the local app is on the **ENS** tab with a test wallet that has private money, `alice.relayless.eth` is claimed, and the recipient's wallet is ready to scan.

*Show **ASPs**. Point at the green check on `world.asp.relayless.eth`, then the warning on `forged-demo`.* (10 s)

> "These are privacy pool approvers, found by name. There's no list in the app: it reads ENSv2 subnames. Each root is checked against the pool's own chain, so this one passes, and this deliberately wrong one gets a warning. The operator's key can edit only this root and policy. Not even the parent name can change them."

*Go to **Names**. Look up `alice.relayless.eth`. Pay it. Pay it again. Two different addresses appear.* (12 s, cut the waiting)

> "Pay a name, not an address. The name holds a stealth record, so each payment goes to a new one-time address, paid from the pool. Same name, two addresses, and nothing on-chain connects them."

*Switch to the recipient's wallet. Click **Find my payments**. Both appear.* (8 s)

> "Only Alice's viewing key can find them. Her scan fetches every announcement, so even the node can't tell which are hers."

If you're showing the public link instead, say that payments run on the local devnet: the page says so too.
