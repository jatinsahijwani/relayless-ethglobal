# Decisions

Design choices and why. Newest context first where it matters.

## Stage 4 (2026-11-22): frame-tx-sdk, a Kohaku prototype, final drafts, the grant proposal

### frame-tx-sdk: the open questions, resolved with the brief's defaults
All seven are recorded with reasons in `docs/sdk-design.md` under "Decisions for 0.1". In short:
- **Its own repository, MIT, named `frame-tx-sdk`.** It's local at `~/Desktop/frame-tx-sdk` with git, with no GitHub repository and nothing published. `npm view frame-tx-sdk` returned 404 on 2026-11-22. `viem-frame-tx` is taken (an encoder and sigHash only, 2026-09), and the README credits it.
- **Profiles stay in the SDK.** Nobody was contacted about moving them to hegota-support.
- **No Nethermind path in 0.1.** Nodes without `ethrex_simulateFrameTransaction` get an "unverified preflight", labelled in every result, which the broadcast guard refuses without `force: true`.
- **MATCHA and reputation are raw readouts,** `null` where the endpoint doesn't exist. There's no scheduler.
- **The broadcast guard is on by default.**

### frame-tx-sdk: choices made in building it
- **`FrameTransaction` carries its profile at runtime** (`tx.profile`), and every encoder checks it. That's in addition to the type parameter, because Relayless and the examples build transactions in more places than one client.
- **`admitted` also requires every VERIFY and SENDER frame to succeed.** A failing DEFAULT frame is a warning. This matches what Relayless's preflight already enforced.
- **The `devnet-8421` codec stays `@forshtat/hegota-support`'s,** imported statically and checked byte for byte.
- **The pool-as-sender example is a 69-line Yul "DripPool",** not Relayless. It pays a fixed amount once per address, with the nonce key `keccak256(recipient)` as its nullifier and validation reading no storage. An example that withdrew from Relayless would pull GPL code and circuits into an MIT repository.
- **The examples give the drip's SENDER frame 200,000 gas on both profiles.** ethrex `9aa3645d` (`devnet-8421`) fails that frame at 60,000 and 100,000 with all gas used, but succeeds at 200,000 using 12,196. Measured, cause not pinned down. Unused gas isn't charged.
- **`randomNonceKey` avoids Node's `Buffer`,** so the SDK bundles for the browser (Relayless's web app builds with it).

### Relayless on frame-tx-sdk
- **Linked with `file:../../../frame-tx-sdk`** from `packages/sdk`, as the brief allows. **CI on GitHub can't resolve that path** until the SDK is published, so the PR's `unit` job is expected to fail at install. Local runs pass. Not worked around, because vendoring the SDK into this public repository would publish it before review.
- **What moved:** the `hegota-8141` codec (deleted from Relayless), frame builders, recent-root reads and storage checks, the nonce-manager slot, admission simulation, sending, the spent-key check, the fee-bump arithmetic, and the sidecar estimate and reputation reads. **What stayed:** notes, proofs, compression, the pool's calls and limits, solvency, the in-flight ledger, and Relayless's fee policy.
- **Relayless's fee bump now asks for 25% through `bumpFees`, rounded up.** It used 125/100 rounded down. The difference is a wei at most.

### Kohaku prototype
- **A separate plugin package (`@kohaku-eth/relayless`), not a mode of Privacy Pools.** Privacy Pools is 0xbow's protocol on ERC-20s, and Relayless is a different pool on native ETH. Whether it should become a Privacy Pools mode is an open question for Kohaku's maintainers (`docs/kohaku-design.md`).
- **Purpose `m/29292'`** ("rl"), by the same rule as Privacy Pools' `28784'` and Tornado's `29795'`.
- **Reads and simulation go through `host.provider`; sending goes through `host.network.fetch`,** like Privacy Pools' bundler traffic.
- **The prototype links Relayless's client as TypeScript source** and relaxes `noUncheckedIndexedAccess` for that one package. An upstreamed version would use a built package.

### Drafts
- **Every draft is in my voice,** first person, with nothing posted.
- **The Nethermind reply** drops the 235,000 sentence, as asked, and says the association set isn't in the 916,820 figure, because that chain 8141 pool has none.
- **The ethresear.ch post** has 11 links; the notes say to cut them if the account is link-limited.
- **Diagrams** are Mermaid sources plus hand-written SVGs (`docs/drafts/img/`), because Discourse may not render Mermaid.

### Grant proposal
- **Workstream 2 (the sidecar) is optional, pending its author's confirmation,** with its own budget rows. It cites only public facts about the sidecar: its last commit and the profile it speaks.
- **The skeleton is kept,** marked superseded by `proposal.md`.

### Live sources that differed from the brief
- **Kohaku has no `broadcastPrivateOperation` in its code.** Only the plugins README still shows it. Broadcasting is a separate `Broadcaster<Op, Result>` with `broadcast(op)` (`packages/plugins/src/broadcaster/base.ts`, at `b6a67fa`), which the prototype implements.
- **Kohaku has no CONTRIBUTING guide** at `b6a67fa`. Conventions were taken from the code: vitest projects, ESLint rules, strict TypeScript, changesets.
- **ethrex `64b8fc09` gives keyed concurrency to one sender only when its validation reads none of its own storage** (and not the legacy nonce). EOAs get one pending frame transaction whatever their keys. The keyed-nonce example sends one at a time; the pool example shows concurrency.
- **ethrex `64b8fc09` refuses `nonce_seq = 2^64 − 1`,** so `hegota-8141` has no single-use form, as the profile table already said. The integration suite checks the refusal on the live client.
- **The devnet had to restart from a new genesis again:** its head was at slot 2,912 with the wall clock past slot 65,000, as in Stage 3. The old data was moved aside to `data.old.<time>`, not deleted.

## Stage 3 (2026-11-17): compression, upstream drafts, shared-sender research

### The withdrawal statement is compressed; the ragequit's isn't
The withdrawal proof now exposes `[beta, gamma, alpha]` instead of seven values (eprint 2025/1500, adapted from minimal-shielded-pool; see NOTICE.md). Measured on chain 8141: pool VERIFY 207,913 gas, from 233,383. **The ragequit keeps its five inputs:** its VERIFY frame uses 219,827 on `hegota-8141`, which already fits the new declared limit, and leaving it alone keeps its key, and so every existing ragequit, unchanged. Compressing it would save about 13k more and can follow.

**Choices made in adapting it:**
- **alpha's preimage** is the seven values as 32-byte words in the circuit's order: root commitment, nullifier hash, change commitment, amount, sigHash mod r, k, ASP root. The validator reduces sigHash itself, so that word is canonical by construction.
- **beta travels after the proof in the frame transaction's signature** (now 288 bytes for a withdrawal), not in frame data as minimal-shielded-pool does. Our proof already lives in the ARBITRARY signature, which sigHash elides, so beta adds no circularity. A wrong beta only fails verification.
- **Every statement value is range-checked by the validator.** They already were, but compression makes it load-bearing: the verifier no longer sees the values, and an aliased value (x + r) gives a different alpha for the same field element, so a proof for it verifies. `scripts/alias.ts` shows both halves on a real chain for amount, change, k and the nullifier hash: the aliased proof verifies off-chain against the pool's key, and the node refuses the transaction.
- **The SDK checks the prover's public signals against its own compression** before building the transaction, because a disagreement in order or encoding would otherwise show up only as a refusal.

### The pool's VERIFY frame declares 260,000
Down from 300,000. The worst VERIFY used is the `devnet-8421` ragequit (it pays the nullifier key's 20,000 first use in that frame). `hegota-8141` declares 268,100 in all: 8,000 for the root frame, 260,000, and 100 for the signature (272,100 with an association set's second root). That's under Nethermind's 300,000 default. **It's above the 250,000 that Nethermind's post measured as holding one attacker peer**; a `hegota-8141`-only limit of 235,000 would get under it (243,100 declared) with about 15,000 to spare on a ragequit. Not done, because it's a per-profile limit for a margin that isn't a node default; it needs the author's call. The VERIFY limit is set by the SDK, not pinned by the validator: a frame that ran out would only make the transaction invalid, never burn a note.

### Correction: the 250k figure was not Nethermind's limit
The Stage 2 entry below said compression would bring the budget "under the 250k Nethermind measured as its limit". Nethermind's default `--mempool.max-verify-gas` is 300,000. 250k is the budget their post found holds one attacker peer at a 25 ms block-building slowdown.

### A new pool on chain 8141; the old one stays
Compression changes the withdrawal key, so the validator and the pool are new: `0xab5d3d27…` (2026-11-17), with the five steps re-run. The first pool, `0x6d58de3f…` (2026-11-16), still holds its change notes. It can only be spent with the old key, which is in git at `9e9536c` (`packages/circuits/build/`). Its records are in `docs/testnet-runs/`.

### Only the withdrawal key was regenerated
`scripts/build.sh` now takes circuit names. Regenerating the ragequit key too would have changed the validator for no reason.

### The local devnet was restarted from a new genesis
Docker had quit, and after a restart the two beacons found no peers and stopped producing. `scripts/local-stack.sh` now notices when its cached staking registry isn't on the chain, redeploys it and refunds the sidecar's faucet. The old chain data was moved aside, not deleted.

### Part C: the upstream branches follow ERC-8421's current text
BUDGET-010 in ethereum/ERCs#2028 (head `493ba8ac`) attributes a `pre_verify` frame to its approving frame's entity and an `expiry_verify` frame to no entity. Our Stage 1 patch charged `expiry_verify` to the sender; the PR 2 branch follows the ERC. The two fixes are separate branches, as the brief asked, and the precompile default is code, not just config, because CALLING-040 allows those precompiles; the draft suggests an issue first because it changes the gateway's default policy.

### Part D: how the shared-sender harness was set up
- **Sidecar variants come from our patches on upstream `2e22ff0a`,** not from our devnet's own sidecar. "Without the fix" still has the per-entity budgets patch: without it the pool's withdrawals (about 228,000 gas of validation) aren't admitted at all, so there would be nothing to measure.
- **ethrex `247e2dd2` needed a second dev patch** (`patches/ethrex-dev-hegota-247e2dd2.patch`): its `ForkChoiceUpdatedV5` has a `custody_columns` field, which the dev producer sets to `None`, and an opt-in `ETHREX_DEV_FINALITY_LAG`. MATCHA credits width only at finality, and dev mode finalizes every block at once, which would make width look free. The harness runs with a 64-block lag, about two epochs. Both changes touch only the dev block producer.
- **`scripts/local-stack-hegota.sh` is now parametrized** (name, ports, chain id, client commit, extra node arguments), so the MATCHA chain runs beside the `64b8fc09` one. Defaults are unchanged.
- **Below-base-fee withdrawals can't be priced by the SDK,** because the node won't simulate them. For that probe only, the harness over-estimates `maxCost`. All three clients refused such withdrawals at admission anyway.
- **The "width draining" step sends one at a time,** so on MATCHA each was the free baseline. The burst case is the replacement-draining step. RESULTS.md says so rather than presenting the first as a draining result.
- **Nothing ran against chain 8141.**

### Part E: drafts only
Every draft is under `docs/drafts/`, nothing was posted or sent, and every number in them comes from our measured results, with calculated figures marked.

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

## Seven public inputs, not compressed yet (superseded on 2026-11-17: see Stage 3)
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
