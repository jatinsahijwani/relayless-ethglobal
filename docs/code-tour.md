# Code tour

A withdrawal, file by file, then likely questions. Line numbers are for the tagged commit.

## The withdrawal path
| Step | Where | Point at |
|---|---|---|
| 1. `pay()` plans the payment | `packages/sdk/src/client.ts:345` | Picks one note, or splits across several. `planPayment` at `:139` |
| 2. Pick the root and fees | `client.ts`, `latestRootRef` and `feeCaps` | Always the newest root. Max fee is 10× base fee, refunded when unused |
| 3. Build the witness and prove | `client.ts:522` (`prepare`), `:561` | `sigHash` at `:544` goes in as a public input, so the proof fixes the whole transaction |
| 4. Build the frames | `packages/sdk/src/frame.ts:56` | Three frames, `nonceKeys: [nullifierHash]` at `:72`, root reference at `:77`, proof in an `ARBITRARY` signature |
| 5. Simulate | `client.ts:567` (`preflight`) | A transaction that would fail is never broadcast, because that costs the pool reputation |
| 6. Submit once | `client.ts:586` (`submit`), `:589` | `eth_sendFrameTransaction`. Never retried. Only `bumpFee` (`:480`) can resend a nullifier |
| 7. Sidecar admission | `patches/sidecar-budget-010.patch:238` (`findEntityOverBudget`) | Per-entity budget after stake lookup: 100k or 1M |
| 8. VERIFY, shape | `packages/contracts/script/gen-validator.mjs:92` (`validate`) | Sender and frame checks. One nonce key at `:108`. Frame 1 pinned from `:121` |
| 9. VERIFY, fees | `gen-validator.mjs`, `checkFees` | `maxCost ≤ fee ≤ amount`, so one note can't spend others' money |
| 10. VERIFY, proof | `gen-validator.mjs:47` | `staticcall(gas(), 8, …)`, the pairing precompile. No storage read: keys are in code, the root is a reference |
| 11. APPROVE | `gen-validator.mjs:207` | `verbatim_3i_0o(hex"aa", …)` approves payment and consumes the nullifier atomically |
| 12. SENDER | `packages/contracts/src/RelaylessPool.sol:104` | `_insertChange`, `_publishRoot`, then `_settle` last |
| 13. Payment can't revert | `RelaylessPool.sol`, `_settle` | Bounded gas, no return data. A refusal becomes `claimable` |
| 14. Refund | `RelaylessPool.sol:142` | DEFAULT frame gives back the fee gas didn't use |

Also worth opening: the dry run at `client.ts:386`, the panel at `apps/web/src/screens/Hood.tsx`, and the griefing experiment at `scripts/grief-experiment.ts`.

## 15 likely questions

**1. Why does a fee bump need a new proof?**
The proof commits to `sigHash`, which covers every frame and both fees. Change a fee and the old proof fails, so a bump re-proves, in about 2 s. Excluding `max_fee` from the digest (Appendix B) would avoid that. We didn't build it: the gain is small today, and it adds validator gas and complexity.

**2. Isn't binding the fee into the proof a liveness risk?**
It's why fees are generous. The default max fee is 10× base fee, at least 1 gwei, and the unused part is refunded by frame 2. `bumpFee` refuses during the first 120 s. The optional fixed fee range is off by default, because a spike above its ceiling would stall every withdrawal.

**3. Why must the pool be staked?**
Verification uses about 253k gas, above the draft's 100k unstaked budget and, by about 3,300 gas, above the landing page's 250k. Under either figure it needs the staked budget: 1M or 2.5M.

**4. Can the stake be withdrawn? What does it cost?**
There's no unlock path, by design, so the pool can't lose staked status. The stake here is 0.012 ETH with an 86,400 s delay, and it's locked forever. That's fine on a devnet. A real deployment needs a governance answer.

**5. Everyone shares one sender. What about reputation?**
That's the hardest problem here. `seen` rises for every admitted transaction, and every user shares it. Validation reads no storage, so one user's withdrawal can't invalidate another's, and honest use stays healthy. A note owner can still grief across nodes.

**6. How bad is the griefing?**
With our fix, one non-mining node ends up with `seen 2, included 0` from 2 notes. By the formula, throttling takes about 110 notes and banning about 510. **Those are calculated, not reached in a run.** `seen` decays over 24 hours. At a devnet base fee, the attack costs almost nothing. It's bounded, not solved, and needs a rule change: don't blame a sender when its own nonce key was consumed on chain.

**7. What happens if a node bans the pool?**
That node refuses everyone, including public exits, until `seen` decays or you use another node. Funds are delayed, not lost. Throttled, the pool still gets 4 pending per node.

**8. What exactly did you patch in the sidecar?**
Per-entity budgets (BUDGET-010) and the replacement fix (REPUTATION-040). Allowing precompiles isn't code: it's the `precompiles` config value. The patch also stops ethrex's canonical budget message from masking the real failure reason, as part of the budget work. It's against `2e22ff0a`, and I'd split it into two PRs.

**9. Why is allowing precompiles safe for builders?**
They're pure, stateless, deterministic and gas-bounded. They read no state another pending transaction could change, so a block landing can't flip their result. There's no mass-invalidation risk and nothing extra to revalidate. The one limit is cost: gas doesn't price CPU evenly, so a node should set its budget with that in mind.

**10. Why 253k when the research floor is about 211k?**
The floor of 211,828 assumes one public input. We have seven (root commitment, nullifier hash, change commitment, amount, sigHash, k, ASP root), and each extra one costs about 6,645 gas. A delegatecall to the validator costs 2,600, and shape checks add a little. It includes the 20k first-use nonce key.

**11. Why not compress the public inputs?**
It could save about 40k gas, but SHA-256 in the circuit adds about 60k constraints, roughly 2.7x the proving time. A staked budget has plenty of room, and proving time is what the user feels.

**12. How serious is the trusted setup?**
Devnet-grade. Phase 1 is the PSE Perpetual Powers of Tau, but phase 2 is a single local contribution, so anyone with that randomness could forge proofs. That's not acceptable beyond a devnet. The circuits and validator aren't audited either.

**13. Why can't the SENDER frame revert?**
APPROVE has already burned the nullifier, so a revert would destroy the note. A refused payment becomes a claim, a bad change leaf is skipped, a failed root write is logged, the recipient gets bounded gas, and the validator enforces minimum limits. Worst case measured was 812k against a 1.5M minimum, under Foundry's gas costs.

**14. How do you stop a double spend? Could a replay get in the mempool?**
The nullifier is the EIP-8250 nonce key, and it's consumed atomically with payment approval. A second spend is an invalid transaction, not a paid failure. The SDK also keeps a ledger of what's in flight. A modified client can send to two nodes, and that's the griefing case, but only one can land.

**15. Is this on the public devnet? Does it match the current EIPs?**
No to the first: the public gateway refuses it, and [the repro](repro-gateway.md) shows why. The same transaction simulates successfully there. The authors confirmed a local sidecar is fine for judging. The devnet also predates current EIP text: roots are an envelope field rather than a VERIFY frame, and first-use nonce gas is 20k. `frame.ts` is the one adapter that would change, along with the validator.

**Bonus: what does the compare panel really prove?**
That ethrex's canonical rules and the patched sidecar give opposite answers on the same bytes, right now. The sidecar's dry run overwrites later frames' limits with 10M, and those are in `sigHash`, so the proof is made for them, and the VERIFY frame is unchanged. It doesn't show what the public gateway does. [The repro](repro-gateway.md) covers that.
