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
- **The hybrid statement compression is Poseidon in the circuit,** so the "Seven public inputs, no compression" reasoning below (SHA-256, about 60k constraints) doesn't hold for it. That decision gets revisited after the port.

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
The project is GPL-3.0, because `circomlib`'s GPL-3.0 templates are compiled into the circuits. 0xbow's adapted circuits keep their Apache-2.0 headers, and `patches/` modifies an MIT project. Both are compatible. See `NOTICE.md`.
