# Draft: reply to "Mempool Account Transaction Capacity from Historical Activity (MATCHA)"

**Not posted.**

| | |
|---|---|
| **Where** | Reply to the original post, at the bottom of https://ethresear.ch/t/mempool-account-transaction-capacity-from-historical-activity-matcha/25949 |
| **Order** | **2nd of 5.** Day 1, the day after the Nethermind reply |
| **Then** | EIP-8250 post on day 2, EIP-8272 post on day 3, the ethresear.ch post on day 5 |
| **Thread state** | Re-read 2026-11-22: the latest post is from 2026-10-07. The authors haven't posted an implementation update. soispoke asked (Sep 9) which lower-risk transactions could qualify for a lower charge; this reply answers with data |

The post's own next steps are to implement width in clients, then:
- "test the two attacks MATCHA targets: repeated mass invalidation by a malicious application";
- "`width` draining against an honest one, including repeated replacements before inclusion";
- "calibrate the admission charge and capacity limits";
- "measure honest throughput".

The reply answers those four. It has nothing on FOCIL.

## Full version
---

I ran a shared sender against ethrex's MATCHA implementation and want to report back on four of your next steps. The sender is [Relayless](https://github.com/jatinsahijwani/relayless-ethglobal), a privacy pool where every user's withdrawal is the pool's own frame transaction on its own EIP-8250 key, and validation reads no storage.

**Setup.** This is ethrex `247e2dd2` with MATCHA on and its default policy (cap 30,000,000, safety factor 3/2), run locally as one node in dev mode. Dev mode finalizes every block at once, which would make width look free, so I patched the dev block producer to trail finality by 64 blocks. Chain 8141, the public Hegotá testnet, runs ethrex `64b8fc09`, which has no MATCHA, so none of this ran there. The harness is one command: [`research/shared-sender`](https://github.com/jatinsahijwani/relayless-ethglobal/tree/main/research/shared-sender).

**Calibration.** One additional pending withdrawal is charged 438,504–438,594 width; at the 3/2 safety factor that's about 292,000 of admission gas. Once it lands and finalizes, it credits about 994,000, its total gas including state. So each landed withdrawal pays for about two more concurrent ones, and the 30,000,000 cap is about 68 at once.

**Honest throughput.** A new pool gets its free baseline and nothing else: 1 of 3 concurrent withdrawals was admitted, and the others were refused with *"sender has 0 MATCHA width, needs 438558"*. After three withdrawals had finalized (width 3,974,288), six sent at once were all admitted and landed within two blocks. Width fell to 465,956, which is 8 charges for 5 additional transactions. Three of the five were still pending at the next forkchoice and were charged again for revalidation.

**Mass invalidation didn't work against this sender.** Six prepared withdrawals stayed valid after a deposit (new root, balance up), after another withdrawal landed (new root, balance down, a key consumed) and after 20 more blocks. A static walk of the validator's reachable bytecode finds no `SLOAD`, `BALANCE`, `EXTCODE*`, `TIMESTAMP` or `NUMBER`, only calls to the BN254 precompiles. Nothing another transaction does can change whether one of these is valid.

**Draining by replacement.** Your post anticipates this: "Replacing an additional transaction with different bytes spends another charge." I sent one baseline withdrawal, then four note holders each bumped a pending withdrawal five times in one burst. All 20 replacements were accepted, and width fell from 20,507,996 to 11,298,098: 9,209,898 spent, 21 charges, never returned. The 16 replaced versions never land, so they earn nothing back and cost their senders no gas. The holders paid for four withdrawals and spent about 7.0M of everyone's width. At that rate, about 47 free replacements would empty a pool holding 20.5M. Every honest withdrawal beyond the baseline then waits for finality: 64 blocks here, about 13 minutes at 12 s slots.

Two proposals from this:

1. **A lower revalidation charge for senders whose validation reads no mutable state.** This is one answer to which transactions could qualify for a lower charge. If no executed opcode in the validation prefix reads state that another transaction can change, a new head can't change the result. The node can tell from the trace it already records when it admits the transaction. In the honest burst above, that would have saved 3 of 8 charges, about 1.3M width, without weakening anything.
2. **Price or rate-limit replacements of additional transactions.** A replaced version never lands, so it never earns width back. Making it cost more than a fresh admission, or capping replacements per nonce key, would stop a few holders draining the shared budget for free.

My question: for a sender like this one, would you rather see the reduced charge applied to revalidation only, or also to the first admission? The second would also ease the bootstrap, where a new pool gets one pending withdrawal at a time.

---

## Short version (two links)
---

I ran a shared sender against ethrex's MATCHA implementation (`247e2dd2`, default policy: cap 30,000,000, safety factor 3/2). It ran locally in dev mode, with the dev producer patched so finality trails by 64 blocks. Chain 8141 runs `64b8fc09`, which has no MATCHA, so none of this ran there. The sender is a privacy pool ([Relayless](https://github.com/jatinsahijwani/relayless-ethglobal)): every withdrawal is the pool's own frame transaction on its own EIP-8250 key, and validation reads no storage.

- **Calibration:** 438,504–438,594 width per additional withdrawal, and about 994,000 credited when one finalizes. That's about two concurrent per landed withdrawal, and about 68 at the cap.
- **Honest throughput:** a new pool admits 1 of 3 at once. Later, six at once cost 8 charges for 5 additional transactions, because 3 were still pending at the next forkchoice and were charged for revalidation.
- **Mass invalidation didn't work:** six prepared withdrawals stayed valid through a deposit, another withdrawal and 20 blocks. Statically, validation reaches no state-reading opcode, only BN254 precompiles.
- **Draining by replacement:** a baseline, then four holders bumping five times each. All 20 were accepted, and width went from 20,507,996 to 11,298,098 (9,209,898 spent, 21 charges). The 16 replaced versions never land, so they earn nothing back and cost their senders nothing. About 47 would empty 20.5M.

Two proposals:
1. A lower revalidation charge for senders whose validation reads no mutable state; the node can check this from its own validation trace. It would have saved 3 of 8 charges above.
2. Price or rate-limit replacements of additional transactions, since a replaced version never earns width back.

Everything, including the harness: [RESULTS.md](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/research/shared-sender/RESULTS.md).

My question: for such a sender, would you apply the reduced charge to revalidation only, or also to the first admission, which would ease bootstrap?

---

## Notes
- **Measured** (`research/shared-sender/results/ethrex-247e2dd2.json`, 2026-11-17, local ethrex `247e2dd2`, `hegota-8141` profile):
  - the charge range (438,504–438,594, 12 samples);
  - the credits (width 0 → 1,967,139 → 2,960,720 → 3,974,288, each about 66 blocks after landing);
  - the 1-of-3 bootstrap and its refusal text;
  - the 6-at-once burst (width 3,974,288 → 465,956, blocks 893–894);
  - the 4×5 burst (20 of 20 accepted, 20,507,996 → 11,298,098);
  - the mass-invalidation checks;
  - the static check (`results/static-check.json`).
- **Calculated:**
  - "about 292,000 of admission gas" (the charge ÷ 3/2);
  - "about two more per landed withdrawal" (994,000 ÷ 438,550);
  - "about 68 at the cap";
  - "about 7.0M" (16 × 438,550);
  - "about 47" (20,507,996 ÷ 438,550);
  - "about 13 minutes" (64 × 12 s);
  - "about 1.3M" (3 × 438,550);
  - the charge counts themselves (21 and 8), which are width spent ÷ the measured charge. `RESULTS.md` uses the same counts.
- **Never claim this ran on chain 8141.** Both versions say it didn't.
- **Dev-mode caveats,** if challenged: one node, blocks never full, so an includable transaction lands in the next block. The finality lag is the only change, and it touches only the dev producer (`patches/ethrex-dev-hegota-247e2dd2.patch`).
- **The ERC-8421 comparison was left out on purpose,** to keep this reply to MATCHA. It's in the ethresear.ch post.
