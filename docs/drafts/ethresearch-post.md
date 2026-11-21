# Draft: ethresear.ch post

**Not posted.**

| | |
|---|---|
| **Where** | A new topic on https://ethresear.ch, category **Networking** (MATCHA and the alt-mempool posts sit there), tags `mempool`, `account-abstraction`, `privacy` if available |
| **Title** | Shared senders in alternative mempools: reputation, MATCHA and griefing, from a working privacy pool |
| **Order** | **5th of 5.** Day 5, a few days after the MATCHA reply (day 1) and after both EIP posts (days 2 and 3) |
| **Images** | Upload `img/frame-layout.svg` and `img/shared-sender-attack.svg` as PNGs. Discourse may not render Mermaid; the `.mmd` sources are next to them |

The text to paste is between the two `---` lines. Notes follow.

---

*Thanks to soispoke for minimal-shielded-pool and MATCHA, to Nethermind (Daniil Ankushin, Manuel Arto) for their privacy-pool measurements, to mmjahanara for the validation-budget work, to namnc for the frame layout I started from, and to nero_eth for the three gates. The mistakes are mine.*

**TL;DR.** A privacy pool on frame transactions is one sender for all its users, so mempool protections built for senders acting for themselves charge every user for each user's behaviour. I attacked such a pool the way its own users could, against four local targets: the ERC-8421 reference sidecar without and with a replacement-counting fix, ethrex `64b8fc09` (chain 8141's client, no width budget), and ethrex `247e2dd2` (MATCHA).
- On the unfixed sidecar, 10 fee bumps of one note cost the pool 10 `seen` for 1 inclusion.
- On MATCHA, four users bumping 20 times in one burst spent 9.2M of the pool's width for the price of four withdrawals.
- Neither mechanism has anything to defend against mass invalidation for this sender, because its validation reads no state another transaction can change. MATCHA still charges it for revalidation.

I propose five changes, three of them already open upstream.

### The sender
[Relayless](https://github.com/jatinsahijwani/relayless-ethglobal) follows soispoke's [minimal-shielded-pool](https://github.com/soispoke/minimal-shielded-pool):
- the pool is the frame transaction's sender and pays gas from the note;
- the nullifier hash is the EIP-8250 nonce key, at sequence 0;
- the root arrives in an EIP-8272 frame;
- validation reads no storage. A walk of the validator's reachable bytecode finds no `SLOAD`, `BALANCE`, `EXTCODE*`, `BLOCKHASH`, `TIMESTAMP` or `NUMBER`, only `STATICCALL`s to the BN254 precompiles.

![The four frames of a withdrawal](upload://frame-layout.png)

On the Hegotá privacy testnet (chain 8141, ethrex `64b8fc09`), a withdrawal to a fresh 0-ETH address used **916,820 gas** and declares **268,100** of validation ([tx](https://dora.privacy.ethrex.xyz/tx/0x543a9ad335af2202d696d9bdae7c242c30f952f44f06b9eb512dbdfc24236ed8)). Three withdrawals from the one sender were pending together and mined in one block ([tx](https://dora.privacy.ethrex.xyz/tx/0x7dabc6e6d7d93be1e2a589f1458b0cce291cc8589b9eef7d19daadc134181e1b)), a double spend was refused by the node's simulation before broadcast, and a public exit paid the depositor ([tx](https://dora.privacy.ethrex.xyz/tx/0x7d6d3ffb622f6787e51bcf6c5ea5d7b506db0597caf29e99a365aa0d98e15897)).

### Setup
| Target | What exactly | Chain |
|---|---|---|
| `sidecar-nofix` | ERC-8421 sidecar [`2e22ff0a`](https://github.com/forshtat/mempool-workshop-sidecar/commit/2e22ff0a2898e69ea4bf5275bce1be8581a8582a), with per-entity budgets and pure precompiles allowed, **without** the replacement fix | ethrex `9aa3645d`, Lighthouse, 12 s slots. Pool staked (0.012 ETH) |
| `sidecar-fix` | The same, **with** the fix | The same |
| `ethrex-64b8fc09` | Chain 8141's client: one-pending-per-sender relaxed for disjoint keys, no width budget, verify budget 500,000 | Dev mode, about 1 s blocks |
| `ethrex-247e2dd2` | MATCHA on, default policy (cap 30,000,000, safety factor 3/2). The dev producer is patched so finality trails by 64 blocks | Dev mode, about 1 s blocks |

Common to all: a fresh wallet, 52 deposits of 0.05 ETH, withdrawals of 0.03 ETH. The two sidecar targets run two instances without gossip: A mines, and B never does.

**Limits of the setup:**
- Dev-mode blocks are never full, so an includable transaction lands in the next block.
- The ethrex targets are single nodes.
- Two sidecars without gossip are a worst case for cross-node conflicts.
- Throttle and ban thresholds were never reached; they're only calculated.
- Nothing ran against a public network. MATCHA isn't on chain 8141.

One command per target reruns everything: [`research/shared-sender`](https://github.com/jatinsahijwani/relayless-ethglobal/tree/main/research/shared-sender).

### Results
| Attack, by users of the one pool | `sidecar-nofix` | `sidecar-fix` | `ethrex-64b8fc09` | `ethrex-247e2dd2` (MATCHA) |
|---|---|---|---|---|
| **One note, 10 fee bumps in a burst** | 10 of 10 accepted. `seen` +10, `included` +1 | 10 of 10. **`seen` +1** | 10 of 10. Nothing tracked | **1 of 10.** The rest: *"sender has 27380 MATCHA width, needs 438576"*. Nobody else gets a second pending withdrawal until finality |
| **A baseline, then 4 holders × 5 bumps in one burst** | 20 of 20. `seen` +22, `included` +6 | 20 of 20. `seen` +6 | 20 of 20. Nothing tracked | 20 of 20. **Width 20,507,996 → 11,298,098: 9,209,898 spent, 21 charges,** never returned |
| **One note in two versions, one to each node** (3 notes) | Never-mining node B: **`seen` 0 → 3, `included` 0** | **The same** | The second version is refused as an underpriced replacement | The same as `64b8fc09` |
| **Mass invalidation:** 6 pending, then a deposit, another withdrawal landing, 20 blocks | 6 of 6 stay valid; on B, 6 `New` | The same | 6 of 6 | 6 of 6 |
| **Parking below the base fee** | Refused at admission | Refused | Refused | Refused |
| **Honest throughput:** 6 at once, before and after the attacks | 6 of 6 admitted; end at `seen 59, included 32` | 6 of 6; end at **`seen 34, included 32`** | 6 of 6, about 2 s | 6 of 6, but see below |

![Replacement draining against one shared sender](upload://shared-sender-attack.png)

**MATCHA for a privacy withdrawal:**
- **Calibration.** An additional pending withdrawal is charged 438,504–438,594 width. One that lands credits about 994,000 at finality, so each landed withdrawal funds about two concurrent ones, and the cap is about 68 at once.
- **Bootstrap.** A fresh pool admitted 1 of 3 concurrent withdrawals.
- **Honest bursts.** Six honest withdrawals at once cost 8 charges for 5 additional ones, because three were still pending at the next forkchoice and were charged again for revalidation.
- **Draining.** In the 20-bump burst, the 16 replaced versions never land, so they earn nothing back and cost their senders no gas. About 47 free replacements would empty a pool holding 20.5M, and then every honest withdrawal beyond the baseline waits for finality.

### What each mechanism protects against
| | ERC-8421 reputation | MATCHA width |
|---|---|---|
| Fee-bump spam | Without the fix, it *is* the attack. With it, a burst counts once | Bounded, but by the pool's shared width, so the spammer spends everyone's |
| Several holders bumping at once | `seen` +22 against `included` +6 without the fix, +6 with it | Drains width for free: 21 charges for a burst that paid for 4 withdrawals |
| The same note to two nodes | Charges the sender on every node that didn't mine it, fix or not | Not tested across nodes |
| Mass invalidation | Not applicable: validation reads no state another transaction can change | Not applicable either, yet 3 of 8 charges in an honest burst went to revalidation |
| Honest throughput | Unaffected in these runs | One pending at a time until the first withdrawal finalizes; then about two per landed one |

They price different things. ERC-8421 counts transactions; MATCHA counts admission work, and a privacy withdrawal is expensive to admit (about 292,000 gas). Neither can tell one note holder from another, because the pool can't either.

### Proposals
1. **ERC-8421 sidecar: a replacement isn't a new `seen`** (REPUTATION-040). The authors agreed it's a prototype bug. With the fix, 10 bumps count as +1 instead of +10, and a full run ends at `seen 34` instead of `59` for the same 32 inclusions. [PR #9](https://github.com/forshtat/mempool-workshop-sidecar/pull/9), with a test that fails without it.
2. **ERC-8421: no reputation change for an eviction caused by the sender's own consumed nonce key.** PROPAGATION-040 already says a received transaction conflicting with a recently included one "causes no reputation change"; the pending case is the same race a block later. [Issue #10](https://github.com/forshtat/mempool-workshop-sidecar/issues/10).
3. **ERC-8421 sidecar: allow pure precompiles by default** (CALLING-040 already lists them). Without it, the public gateway can't admit any proof-verifying sender. [Issue #11](https://github.com/forshtat/mempool-workshop-sidecar/issues/11), with a ready branch.
4. **MATCHA: a lower revalidation charge for senders whose validation reads no mutable state.** The node can check this from the validation trace it already records: if no executed opcode reads state another transaction can change, a new head can't change the result. Keep the full charge for admissions and replacements. It would have saved 3 of 8 charges in the honest burst, and weakens nothing.
5. **MATCHA: price replacements of additional transactions above a fresh admission, or rate-limit them per nonce key,** because a replaced version never earns width back.

**Until mempools change, for pools:** keep the free baseline for the withdrawals that matter, re-prove rather than bump where possible, and send each withdrawal to one node. Never send a transaction the node's own simulation refused; [frame-tx-sdk](https://github.com/jatinsahijwani/frame-tx-sdk) does this by default.

### Honest limits
- Local chains and dev-mode blocks; single ethrex nodes; sidecars without gossip; no Nethermind. Thresholds are calculated, not reached.
- The trusted setup is devnet-grade and nothing is audited.
- **Relayless doesn't solve a pool paying for a call from the user's own address,** the open case in Nethermind's post. Nonce keys are scoped to the sender, so the pool has to be the sender.
- The pool design isn't mine; it's soispoke's. What's new here is the shared-sender measurements, the alt-mempool path and the fixes.

Open questions:
- Is proposal 4 safe for a sender whose validation is state-free today but upgradeable? Mine is immutable.
- Should a shared sender's reputation and width be partitioned by nonce key or by payer? Daniil's contention-indexed width asks a version of this.
- Does real gossip between sidecars make the cross-node conflict worse or better?

---

## Notes
- **Every figure is from `research/shared-sender/RESULTS.md`** (local runs, 2026-11-17) **or the chain 8141 runs** (2026-11-17).
  - `hegota-8141`: 916,820, 268,100, the three chain 8141 links, and both ethrex targets.
  - `devnet-8421`: both sidecar targets (ethrex `9aa3645d`).
- **Calculated:**
  - "about two concurrent" (994,000 ÷ 438,550);
  - "about 68" (30,000,000 ÷ 438,550);
  - "about 47" (20,507,996 ÷ 438,550);
  - "about 292,000" (the charge ÷ 3/2);
  - the charge counts (21 and 8), which are width spent ÷ the measured charge.
- **The frame-tx-sdk link won't work** until that repository exists. If it isn't published by day 5, cut the clause or say "the SDK in the repo".
- **Links:** 11, so a new account will be link-limited. Either post after the replies have earned trust, or cut it to the repo, RESULTS.md and PR #9.
- **Credits are forum handles** (soispoke, AnkushinDaniil, mmjahanara, namnc, nero_eth). Check each spelling on the forum before posting; Manuel Arto's handle isn't in the thread, so he's named, not tagged.
- **Don't post before the replies.** This post cites both conversations.
