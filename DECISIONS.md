# Decisions

Design choices and why. Newest context first where it matters.

## Stage 2 (2026-11-16): the core is the pool, the alt mempool path and a provider-agnostic association set
The positioning is `docs/landscape.md`: the pool primitive isn't novel, so the core keeps what is ours (the ERC-8421 path, shared-sender reputation, compliance, the SDK) and drops what's not research. Everything removed is in the tag `v1.0-ethglobal-mumbai`.

### Removed: World ID, ENS, Nym
`packages/ens`, the ENS screens, the live-site build (`vite.ens.config.ts`, `vercel.ens.json`, `ens.html`), the Sepolia scripts and config, World ID (IDKit, `world.ts`, `/join`, `/rp-context`, the env vars and docs), and the Nym transport, toggle and notes. The Sepolia contracts stay deployed, with the deployer's subregistry roles revoked first, so they're frozen rather than abandoned. The local `apps/web/dist-ens` build output isn't in git and was left on disk.

### Removed: stealth payments
`stealth.ts`, `payStealth` and the announcer go too, though ERC-5564 doesn't need ENS. **Why not keep them:**
- A payment funds a throwaway announcer with a second withdrawal. That's about twice the gas, it isn't atomic, and it leaves dust.
- The validator would need a frame layout change to announce atomically.
- The reference pool already does private delivery better, with post-quantum encrypted notes to reusable addresses (`docs/landscape.md`).
- `freshAddress()` already covers the case that matters here, a recipient you control with 0 ETH.

**What it would take to bring back:** a fourth frame, or announcements from the pool itself.

### The association set is an interface, not a server
`AssociationSetProvider` (`packages/sdk/src/association.ts`) has four calls: `sourceId`, `currentRoot`, `membershipProof`, `status`. `status` has `pending` and `declined` so a reviewing ASP, such as 0xbow's, can explain refusals.
- **Reference:** `allowlistProvider` over `apps/asp`, now an allowlist only.
- **Proofs are built locally** from the whole set (`publishedSetProvider`), so the provider doesn't learn which note is about to be spent.
- **The SDK checks before proving:** the provider's source must be the pool's `ASP_SOURCE_ID`, and the proof must reach its root. This catches a wrong or buggy provider without proving, and without the reputation cost of a refused transaction. The chain remains the authority.
- **One pool per provider still holds:** `ASP_SOURCE_ID` is immutable. A pool accepting several providers is a contract change we didn't make. **Cost:** liquidity splits across pools.

The pool, validator, circuits and ragequit didn't change.

### The demo uses one association-set pool
With World ID gone, the second pool (`local-asp2`, `ASP2_KEY`) existed only to keep demo approvals out of the World ID set. The demo now uses `local-asp`, and its allowlist ASP runs on 8790.

### Live sources differ from the brief (Part 3)
Checked 2026-11-16. The plan in `docs/spec-port.md` follows these, not the brief:
- **Chain 8141 doesn't run the current EIP text.** It runs ethrex `64b8fc09`, with the recent-root contract and nonce manager at the old `0x…8272` and `0x…8250`, nothing at the new addresses, and the per-gas fee triple. The brief's "ethrex at the revision chain 8141 uses, or Nethermind master" names two different profiles. Only Nethermind master follows today's texts.
- **The testnet's verify budget is 500,000** (`--mempool.max-verify-gas`). The brief's "about 238k" is the reference pool's own declared budget.
- **The testnet node has no MATCHA width budget.** `64b8fc09` relaxes the one-per-sender rule for disjoint keys instead. MATCHA is in `247e2dd2`.
- **The EIP texts disagree on `fees`.** EIP-8250's payload block still shows three per-gas fees, and EIP-8141 has a single total `max_fee`. We follow EIP-8141, as Nethermind does.
- **The hybrid statement compression is Poseidon in the circuit,** so the hackathon's SHA-256 reason for not compressing was wrong. See "Seven public inputs, not compressed yet" below.

### The spec port: two profiles now, a third later (Part 4)
The author approved two profiles for Part 4, and a table that takes a third without touching shared code. Built:
- **`devnet-8421`:** the alt mempool path, unchanged in behaviour. Its validator is semantically identical to the hackathon's, and the SDK's devnet encoding is checked byte for byte against `@forshtat/hegota-support`'s own builder.
- **`hegota-8141`:** what chain 8141 runs. Our own codec for the 8-field envelope, pinned to ethrex's golden vector. EIP-8272's verifier frame at index 0, every later frame index shifted by one, and roots read with `FRAMEPARAM`/`FRAMEDATALOAD`.

**Why `eips-current` waits:**
- No public network runs it. Chain 8141 has no code at the new addresses.
- Only Nethermind master implements it, and standing up that stack was the riskiest step in the plan.
- `ethrex_simulateFrameTransaction`, which the SDK's preflight depends on, doesn't exist there, so "never broadcast what would fail" needs a new route first.
- The texts are still moving: three of the four relevant EIP files changed in October.

**Adding it later:** an entry in `packages/sdk/src/profiles.ts` (addresses, codec, RPC), an entry in the validator generator's `PROFILES`, and a local stack script. The pool already takes its recent-root contract as a constructor argument, so the contract doesn't change.

**Nonces:** sequence 0 on both profiles, with the validator's pin. Neither defines EIP-8250's single-use form. `eips-current` will use single-use.

### The pool takes its recent-root contract and an optional registry (Part 4)
- **`RECENT_ROOT` is an immutable constructor argument,** so one contract serves every profile. The validator built for the same profile checks roots against the same address, and `deploy.ts` passes the validator build's address to the pool.
- **The staking registry is optional.** Chain 8141 has no alt mempool and no registry, and its public mempool needs no stake. With no registry, the pool stakes nothing and refuses a stake amount.

### A local `hegota-8141` chain is ethrex in dev mode, with a patch (Part 4)
The author chose a local ethrex `64b8fc09` chain only, with no Nethermind stack. ethrex's dev mode supplies the EIP-7843 slot itself, so it needs no consensus client. But at this commit its block producer still drives Hegotá with Amsterdam's engine calls, and the node refuses them ("engine_forkchoiceUpdatedV4 cannot accept Hegotá payload attributes"). `patches/ethrex-dev-hegota.patch` makes it send `forkchoiceUpdatedV5` and `newPayloadV6` with an empty inclusion list. **It touches only the dev producer and its engine client,** never block validation, the EVM or the mempool, so what we test is chain 8141's execution and admission code. Chain id 81410, so nothing signed locally is valid on 8141. The node runs with chain 8141's 500,000 verify budget.

### The SENDER frame's floors were re-measured before any testnet deployment (Part 4)
The author required this. On ethrex's own gas schedule, both profiles:
- **Execution:** 861,786 at full tree depth with a gas-burning recipient and a deferred claim, against the 1,500,000 minimum. Foundry can't measure this, because its EVM doesn't price EIP-8037 state gas, so `scripts/gas-floors.ts` stages the pool's code at depth 20 on the live chain.
- **State:** at most 3 new slots before the payment (293,760), then a new account (183,600) or a claim (97,920). The highest seen was 566,100, from a recipient that keeps 2 new accounts, against the 1,000,000 minimum.
- **The case that could have burned a note:** inside a frame, ethrex treats state gas as its own budget and running out as out-of-gas. If a recipient could spend that budget and then revert without it being restored, the claim written after a refused payment would run out after APPROVE. **It is restored:** a recipient that creates 7 slots and refuses leaves the frame at 293,760. `scripts/adversarial.ts` covers this and nine other hostile recipients, 10/10 on each profile.

**The minimums don't change.** The fuzz tests pass 10,000 runs each.

### The refund overhead stays at 150,000 (Part 4)
Re-derived for `hegota-8141`: intrinsic 21,772 (receipt total minus frames), plus the refund frame's worst case of the 100,000 call cap and about 10,000 of its own. That's about 132,000.

### The solvency check counts pending withdrawals (Part 4)
A public mempool reserves each pending transaction's maximum cost against its payer's balance. The SDK records what each pending withdrawal can take from the pool and counts it, including withdrawals that `payMany` is about to send together. Before, two withdrawals could each pass the check alone and together exceed the pool.

### Chain 8141 has a faucet and an explorer (Part 4)
`docs/spec-port.md` said there was no documented way to get chain 8141 ETH. There is: ethrex's `docs/hegota-testnet-spec.md` lists a faucet (faucet.privacy.ethrex.xyz, `POST /api/claim`) and a Dora explorer that decodes frame transactions. I haven't claimed from the faucet; the author is arranging funds.

### Test fixes found on the new chain (Part 4)
- `txpool_content` keys a sender's transactions by nonce, and every withdrawal uses sequence 0, so three pending withdrawals show as one. The concurrency checks ask for each hash instead, or check that they were mined in the same block.
- `wait()` could return null for a withdrawal that landed between its two reads, as if a fee bump had replaced it. Fixed in the SDK.

### Hackathon-only docs removed
`SUBMISSION.md` and `docs/video-shotlist.md` described the judged entry and would be wrong now. They're in the tag.

### Root `typecheck` and `build` scripts
The brief's "typecheck clean" had no single command. `pnpm typecheck` runs `tsc` on the SDK, the ASP, the web app and the scripts (with a new `tsconfig.scripts.json`), and `pnpm build` builds the web app.

## The mempool comparison proves against placeholder limits
The sidecar's `eth_estimateFrameTransactionGas` overwrites the limits of every frame after VERIFY with 10M. Those limits are part of sigHash, so a normal proof fails there with `validation frame 0: reverted`. The dry run proves for those limits and sends the same bytes to both nodes. VERIFY, which is what's being judged, is unchanged. Measured: neither call moves `seen` or records an admission.

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

## Fee-bump limit is optional and off by default
Measured: the sidecar counts each replacement as `seen`, and a note could make about 248 of them. A fixed max-fee range in the validator limits that (1–8 gwei gives about 22). The authors confirmed the counting is a prototype bug, not ERC-8421 behaviour, so a permanent liveness cost isn't worth it: with the range on, all withdrawals stall if the base fee passes the ceiling. Enable with `RELAYLESS_FEE_RANGE=<min wei>:<max wei>` at validator build time, and the SDK reads it from the deployed config. The checks aren't in the bytecode when it's off.

## Minimum deposit 0.01 ETH
Must exceed the refundable gas deposit, about 0.003 ETH at 1 gwei, and raises griefing cost. Note `amount` must also exceed that deposit.

## Validator in Yul, delegatecalled by a Solidity pool
Vanilla solc can't emit frame opcodes; Yul can via `verbatim`. Hardcoding the keys in code avoids storage reads, which keeps withdrawals concurrent. The experimental solc fork isn't used. `HegotaSupport` helpers would add a cold call per opcode.

## The snarkjs verifier template isn't used
`staticcall(sub(gas(), 2000), …)` is rejected (`payer uses banned opcode: GAS`), measured in the Phase 0 spike.

## Seven public inputs, not compressed yet
Root commitment, nullifier hash, change commitment, amount, sigHash, k, ASP root. Each input past the first costs about 6,645 gas of verification. The devnet's VERIFY frame measures 253,176 gas.

**The hackathon reason was wrong.** It said compression needs SHA-256 in the circuit, about 60k constraints and 2.7x the proving time. The hybrid scheme (eprint 2025/1500), which minimal-shielded-pool uses, does without: the validator computes `alpha = keccak(statement) mod r`, the circuit computes `beta = Poseidon(statement)`, and both evaluate the statement polynomial at `alpha + beta`. That's a few hundred constraints on top of 24,965.

**Decision (2026-11-16): compress to 3 inputs, as a separate step after the spec port.** It saves about 25k net, and moves the declared validation budget from about 250k to about 225k, under the 250k Nethermind measured as its limit. It changes the circuit, the zkey, the validator and the SDK at once, so it gets its own measurements and review. It doesn't block the testnet, which admits 500k. The plan is in `docs/spec-port.md` §4.

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
The project is GPL-3.0, because `circomlib`'s GPL-3.0 templates are compiled into the circuits. 0xbow's adapted circuits keep their Apache-2.0 headers, and `patches/` modifies an MIT project. Both are compatible. See `NOTICE.md`.
