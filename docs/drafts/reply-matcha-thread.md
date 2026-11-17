# Draft: reply to "Mempool Account Transaction Capacity from Historical Activity (MATCHA)"

**Not posted.** For the author to review and post at https://ethresear.ch/t/mempool-account-transaction-capacity-from-historical-activity-matcha/25949

The authors' next steps, quoted from the post (2026-11-17): implement width in clients, "test the two attacks MATCHA targets", "calibrate the admission charge and capacity limits", "determine whether FOCIL is sufficient on its own", and "measure honest throughput". Every number below is from `research/shared-sender/results/ethrex-247e2dd2.json`. **Re-check them against `RESULTS.md` before posting.**

---

> We ran a shared sender against ethrex's MATCHA implementation (`247e2dd2`, default policy) and wanted to report back on three of your next steps. The sender is [Relayless](https://github.com/jatinsahijwani/relayless-ethglobal), a privacy pool where every user's withdrawal is the pool's own frame transaction on its own EIP-8250 key, and validation reads no storage. Setup: one ethrex node in dev mode with a small patch so finality trails the head by 64 blocks (dev mode otherwise finalizes every block, which would hide how width is earned). The harness is public and runs with one command: [`research/shared-sender`](https://github.com/jatinsahijwani/relayless-ethglobal/tree/main/research/shared-sender).
>
> **Calibration: what a privacy withdrawal costs in width.** One additional pending withdrawal is charged about **438,550** width (1.5 × an admission gas of about 292,000: 268,100 declared validation plus intrinsic, data, signature and one nonce key). Once it lands and finalizes, it credits about **994,000**, its total gas including state. So in steady state each landed withdrawal pays for about two more concurrent ones. The width cap (30,000,000) is about 68 concurrent additional withdrawals.
>
> **Honest throughput.** A new pool gets its free baseline and nothing else: 1 of 3 concurrent withdrawals was admitted, the others refused with *"sender has 0 MATCHA width, needs 438558"*. After three withdrawals finalized (width 3,974,288), six concurrent ones were all admitted and landed within two blocks. That burst cost **8 charges, not 5**: three of the five additional transactions were still pending at the next forkchoice and were charged again for revalidation. Width then sat at 465,956 until those withdrawals finalized 64 blocks later.
>
> **Draining by replacement, which your post anticipates ("Replacing an additional transaction with different bytes spends another charge").** Four note holders, each bumping a pending withdrawal five times in one burst, with one baseline already pending: all 20 were accepted, and width fell from 20.5M to 11.3M (21 charges, never returned). The 16 replaced versions never land, so they earn nothing and cost their senders no gas: the holders paid for four withdrawals and spent 7.0M of everyone's width. At that rate, about 47 free replacements empty a pool holding 20.5M, and every honest withdrawal beyond the baseline then waits for finality (64 blocks here, about 13 minutes on mainnet timing). *(Calculated from the measured charge; the run stopped at 20.)*
>
> **Mass invalidation doesn't apply to this sender.** Six prepared withdrawals stayed valid after a deposit (new root), after another withdrawal landed (new root, balance change, a key consumed) and after 20 more blocks. A static walk of the validator's reachable bytecode finds no `SLOAD`, `BALANCE`, `EXTCODE*`, `TIMESTAMP` or `NUMBER`, only calls to the BN254 precompiles. So for a sender like this, the charge buys protection against one attack (draining) but pays mass-invalidation prices for an attack that can't happen.
>
> **One question:** for a sender whose validation provably reads no state that another transaction can change, would you consider a lower revalidation charge (or none, since a new head can't change its result), while keeping the full admission charge for replacements? That's where most of the honest burst's cost went (3 of 8 charges), and it wouldn't weaken the replacement bound.
>
> We also measured the same attacks against an ERC-8421 sidecar, where the shared sender's reputation is the scarce resource instead of width; with a replacement-counting fix, ten fee bumps cost one `seen` instead of ten, but a conflict sent to two nodes still leaves the non-mining one at `seen 3, included 0`. Happy to run other parameters if useful.

---

## Notes for the author
- **Measured:** the charge (438,504–438,594 across runs), credits (1,967,139 after the first withdrawal of a fresh pool, including the first baseline; then +993,581 and +1,013,568), the 6-at-once burst and its 8 charges, the 4×5 replacement burst (20 of 20 accepted, 20,507,996 → 11,298,098), the 1-of-10 spam result, the mass-invalidation checks and the static check.
- **Calculated:** "about two more per landed withdrawal", "68 concurrent at the cap", "47 replacements empty 20.5M", and the 13 minutes (64 slots × 12 s).
- **The dev-mode caveats are real:** one node, blocks never full, so includable transactions land in the next block. Say so if challenged; the finality lag is the one thing patched.
- The question is the one ask. If the thread has moved on to contention-indexed width (Ankushin's question), consider tying it to that instead.
