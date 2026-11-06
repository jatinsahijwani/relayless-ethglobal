# Decisions

Design choices and why. Newest context first where it matters.

## Local stack with a sidecar patch
The public gateway rejects this tx twice: a 100k cap that ignores stake, and `COD-010` treating precompiles as un-deployed (`docs/repro-gateway.md`). We use local ethrex `9aa3645d` plus sidecar with `patches/sidecar-budget-010.patch` and a `precompiles` config. **The alt mempool authors confirmed a local sidecar is fine for judging.** RPC URLs live only in config, so moving later is a config change.

## Author feedback: validity must not depend on fast-changing state
Reputation drops for every tx broadcast but not mined. Applied:

| Feedback | What we did |
|---|---|
| Latest committed root; root after every deposit | SDK uses the newest `RootPublished`, waiting for a later slot if needed. The pool publishes after each deposit and change note |
| Generous fee plus refund | Default max fee 10× base fee, at least 1 gwei. `fee` covers `maxCost`, and DEFAULT frame 2 refunds the rest |
| Gas reserve, solvency check | Constructor value beyond stake is the reserve; `fundReserve()`; `reserve()` view. SDK checks before sending |
| Never resubmit a nullifier except a fee bump | In-flight ledger in the SDK. `submit` never retries |
| SENDER frame can't revert after APPROVE | See below. Fuzz and adversarial tests |
| Write the analysis | `docs/reputation-analysis.md`, with measurements |
| Differentiate on the layer above | UX and README lead with recovery, any-amount pay, concurrency, meter and k-gate, compliance |

**Appendix B (digest excluding `max_fee`) is a stretch, not built.** It would let a fee bump skip re-proving. Bumps take about 2 s to re-prove, so the benefit is small today, and it adds validator gas and complexity.

## The SENDER frame cannot revert
By then APPROVE has burned the nullifier, so a revert destroys the note.
- **Payment:** bounded gas, no return data copied, last in the frame. Refusal becomes `claimable`.
- **Change leaf:** invalid, duplicate or tree-full is skipped with an event; only the prover who chose it loses out.
- **Root write:** failure is logged, and the next publish covers it.
- **Out of gas:** the validator enforces minimum limits (1.5M execution, 1M state). Worst case measured at 812k under Foundry's gas costs, and real runs used 184k execution and 477k state.

**Consequence:** a recipient that refuses payment also forgoes its refund, which stays in the reserve.

## Replacement counting is fixed in our sidecar patch
ERC-8421's REPUTATION-040 says a replacement isn't a new `seen`, and the authors confirmed the sidecar's behavior is a prototype bug. Fixed locally and written up in `docs/upstream-pr.md`. Measured: 8 bumps from one note move `seen` 0 → 1, not 8. The public gateway doesn't have this.

## The SDK doesn't trust the node's log index
ethrex lost the number lookup for a run of blocks on 2 of 2 fresh chains, which breaks any `eth_getLogs` touching them. The SDK splits the range around such blocks. If a gap hid a pool leaf, reads fail with a clear error rather than building a wrong tree, and the root check stays as a second guard.

## World ID: Orb-level proof of a unique human
The association set needs "one person, once", and nothing about who. Each proof is bound to its depositor, one nullifier maps to one address, and the depositor must sign. World's API only checks validity, so those live on our server, and the circuit enforces membership. It sits behind an env check and stays off until configured. Why this credential: `docs/world-id-debrief.md`.

## Fee-bump limit is optional and off by default
Measured: the sidecar counts each replacement as `seen`, and a note could make about 248 of them. A fixed max-fee range in the validator limits that (1–8 gwei gives about 22). The authors confirmed the counting is a prototype bug, not ERC-8421 behaviour, so a permanent liveness cost isn't worth it: with the range on, all withdrawals stall if the base fee passes the ceiling. Enable with `RELAYLESS_FEE_RANGE=<min wei>:<max wei>` at validator build time, and the SDK reads it from the deployed config. The checks aren't in the bytecode when it's off.

## Minimum deposit 0.01 ETH
Must exceed the refundable gas deposit, about 0.003 ETH at 1 gwei, and raises griefing cost. Note `amount` must also exceed that deposit.

## Validator in Yul, delegatecalled by a Solidity pool
Vanilla solc can't emit frame opcodes; Yul can via `verbatim`. Hardcoding the keys in code avoids storage reads, which keeps withdrawals concurrent. The experimental solc fork isn't used. `HegotaSupport` helpers would add a cold call per opcode.

## The snarkjs verifier template isn't used
`staticcall(sub(gas(), 2000), …)` is rejected (`payer uses banned opcode: GAS`), measured in the Phase 0 spike.

## Seven public inputs, no compression
Root commitment, nullifier hash, change commitment, amount, sigHash, k, ASP root. Verify frame measures 253,176 gas. Compression could save about 40k, but SHA-256 in the circuit adds about 60k constraints (about 2.7x proving). A staked budget of 1M has plenty of room under the draft's numbers, and 253k **slightly exceeds** the landing page's unstaked 250k, so **the pool must be staked** under either figure.

## Positional LeanIMT for the k-gate
0xbow's inclusion proof allows siblings to shift down past empty levels, so a leaf can claim a smaller index under the same root. Harmless for them, since they don't use the index as a claim, but it would bypass our k-gate. `PositionalLeanIMT` adds two constraints per level; a test runs the exact attack. The ASP tree uses the plain version, because only membership matters there.

## k counts leaves, not deposits
Change notes are leaves too, and the proof only sees `leafCount`. So k is an upper bound on deposits after yours. The meter counts real deposits.

## Fee is in the SENDER frame's data, and Solidity never reads TXPARAM
The validator checks `maxCost ≤ fee ≤ amount`. This keeps frame opcodes out of the Solidity pool.

## Change notes derive from the parent nullifier
Recovery walks spends: a `Withdrawn` event gives the amount, hence the change value, with no encrypted memos or extra backup.

## Ragequit is a frame tx too
It must consume the same nonce key as a withdrawal, or a note could exit twice. A normal tx can't consume a keyed nonce, and the predeploy has no read interface. Blocked at any node that has banned the pool: see the analysis.

## Stake has no unlock path
Simplest way to rule out the pool losing staked status. **Cost:** the stake is locked forever. Fine on a devnet; a real deployment would need a governance answer.

## Testing split
Foundry covers deposits, the tree, roots and the no-revert guarantees. Frame opcodes don't exist in stock Foundry, so validator paths run on the chain through `scripts/e2e.ts`.

## Trusted setup is devnet only
Phase 1 uses the PSE Perpetual Powers of Tau; phase 2 is a single local contribution. Anyone with that randomness could forge proofs. Not acceptable beyond a devnet.

## License note
`circomlib` is GPL-3.0 and is compiled into the circuits. See `NOTICE.md`; a final license choice for the circuits package should account for this.
