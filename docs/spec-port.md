# Spec port plan

*Written 2026-11-16 on branch `refocus`. Every claim about the EIPs, minimal-shielded-pool, the clients and the networks was checked against the live source that day. The sources are listed at the end.*

## Status after Stage 3 Part B (2026-11-17)
- **Compression done** (step H): the withdrawal statement is 3 public signals. On `hegota-8141` the pool VERIFY frame uses 207,913 and 268,100 is declared, under Nethermind's 300,000. See `docs/gas-report.md` and `DECISIONS.md`. The figures below are from before it.

## Status after Part 4
- **Built:** `devnet-8421` and `hegota-8141`, behind the profile table, as the author decided. `eips-current` waits: why, and what adding it takes, is in `DECISIONS.md`.
- **Measured,** replacing the §4 estimates: the recent-root frame is 5,579 gas, the pool VERIFY frame 233,383, so 238,962 of validation is used, and 308,100 is declared. See `docs/gas-report.md`.
- **Corrected:** risk 1 below is wrong. Chain 8141 has a faucet and an explorer, listed in ethrex's `docs/hegota-testnet-spec.md`.
- **Risk 2 resolved differently:** ethrex dev mode, with a small dev-producer patch, replaces the consensus client. See `DECISIONS.md`.
- **Risk 4 checked:** the SENDER frame's floors hold under EIP-8037 pricing, measured at full depth and against ten hostile recipients.

## Summary
- **There isn't one "current spec" to port to. There are three profiles in use:**

  | Profile | Where it runs | What defines it |
  |---|---|---|
  | `devnet-8421` | Our local stack: ethrex `9aa3645d` plus the ERC-8421 sidecar `2e22ff0a` | Recent roots as a top-level envelope field, 9-field envelope, predeploys at `0x…8272` and `0x…8250`, 20k first-use nonce |
  | `hegota-8141` | The public Hegotá testnet, chain 8141 (`ethrex/v23.0.0-hegota-testnet-hotfix-64b8fc09`) | The September texts minimal-shielded-pool pins: recent roots in a VERIFY frame, 8-field envelope, per-gas fee triple, contracts still at `0x…8272` and `0x…8250` |
  | `eips-current` | Nethermind master (and no public network found) | Today's texts: the recent-root contract at `0x8272D967…`, the nonce manager at `0x8250968C…`, a single total `max_fee`, signature lengths committed, single-use keys |

  The brief treats "ethrex at the revision chain 8141 uses" and "the current spec" as the same thing. **They aren't:** chain 8141 has no code at either new address, and its envelope predates the `max_fee` change.
- **The sidecar only speaks `devnet-8421`.** `@forshtat/hegota-support@0.0.1` has two profiles, both of which carry recent roots as an envelope field. The sidecar hasn't changed since our pin. So the alt mempool path needs `devnet-8421` kept, as the brief anticipated.
- **The recommendation is all three profiles behind one profile table,** with shared circuits, contracts and SDK logic. The second and third differ in five small things (addresses, fee field, signature elision, single-use keys, the opcode set), so the extra cost of `eips-current` is small once `hegota-8141` exists. The public testnet needs `hegota-8141`, and only `eips-current` tracks the texts.
- **Nonce form:** single-use (`nonce_seq = MAX_NONCE_SEQ`) where the profile has it (`eips-current`), and sequence 0 with the validator's pin on the others, which don't define single-use.
- **Verification:**
  - **Estimate:** about 233k execution for our VERIFY frame once the nonce cost leaves it, plus about 6–8k for the recent-root frame, so about **250k declared**.
  - **Budgets:** that fits chain 8141 (500k), Nethermind's default (300k) and the sidecar's staked budget (1M), but not EIP-8141's 100k.
  - **Compression:** cutting to 3 public inputs would save about 25k. The hybrid scheme uses Poseidon in the circuit, not SHA-256, so our earlier reason for not compressing was wrong. Recommended as its own step, after the port.
- **Biggest open risks:**
  - there's no documented way to get chain 8141 ETH (Part 5);
  - a local `hegota-8141` chain needs ethrex `64b8fc09` with a consensus client;
  - `ethrex_simulateFrameTransaction`, which the SDK depends on, doesn't exist on Nethermind;
  - the SENDER frame's state-gas pin has to be re-measured under EIP-8037 pricing, or the no-revert guarantee could break.

## 1. Differences, profile by profile

### 1.1 EIP-8272: recent roots

| Item | `devnet-8421` (ours today) | `hegota-8141` | `eips-current` (EIP-8272 `5e32ce9abb`) |
|---|---|---|---|
| Carrier | Envelope field `recent_root_references` (`packages/sdk/src/frame.ts:77`, `:113`) | VERIFY frame to the contract, data = 72-byte tuples | Same as `hegota-8141` |
| Contract | `0x…8272` (`RelaylessPool.sol:37`, `recent-root.ts:11`, `local-stack.sh:52`) | `0x…8272` (checked on chain: code present, hash `0xcd1c…75a5`). `owner-set-v1` hardcodes the same address (`ShieldedPoolDispatcher.yul:47`) | `0x8272D9679689Ea2f307140CdF9002D27dC00Ffff`, deployed by a keyless transaction (EIP-8272 lines 38, 206–231). **Empty on chain 8141** |
| Bytecode | Hash `0x432c…c6fb` (290 hex chars) | Hash `0xcd1c…75a5` (692) | `RECENT_ROOT_CODE`, hash `0xda16…e4e3` |
| Storage layout | `keccak(ENTRY_DOMAIN‖source‖slot‖root)` at `keccak(STORAGE_DOMAIN‖source‖slot mod 8192)` | Same domains in the bytecode | Same (EIP-8272 lines 73–100). **So `checkRecentRoot` needs only the address** |
| Read in validation | Opcode `0xb6` (`rootref`, `gen-validator.mjs:79`, `:117–118`, `:167–168`) and `TXPARAM(0x11)` for the count (`:164`, `:166`, `:187`) | `FRAMEPARAM`/`FRAMEDATALOAD` on the root frame. Check `resolved_target`, `mode == VERIFY`, `flags == 0`, `limits.state == 0`, the data length and `status == 1`, then read the tuples (EIP-8272 lines 256–262) | Same |
| Frame index | No root frame. Validator in frame 0 (`gen-validator.mjs:96–97`), SENDER 1, refund 2 | Root frame 0, validator 1, SENDER 2, refund 3. Every frame index in the validator shifts by one (`:96–97`, `:123–155`, `:185–191`, `:227–230`) | Same, or +1 more with `expiry_verify`, which we don't use |
| Tuples | Up to 2 (pool root, ASP root) | 1 or 2 in one frame (max 16) | Same |
| Mempool budget | Not counted | The frame's `limits.execution` counts toward `MAX_VERIFY_GAS` (EIP-8272 line 287) | Same |
| Slot source | `slotNumber` from the block (`client.ts:280`, `:288`) | EIP-7843 `slotNumber`, and references must be strictly before the current slot | Same. Our "wait for a later slot" logic stays |

**Confirmed from the brief:** the VERIFY-frame form, `0x8272D967…`, 72-byte tuples, frame 0 (or 1 after `expiry_verify`), `FRAMEPARAM`/`FRAMEDATALOAD`, `source_id = keccak256(writer ‖ salt)`, and slots from `slotNumber`.

**Correction to the brief:** those are the `eips-current` facts. Chain 8141 has the VERIFY-frame form but at `0x…8272`.

### 1.2 EIP-8250: keyed nonces

| Item | `devnet-8421` | `hegota-8141` | `eips-current` (EIP-8250 `1a086d5c67`) |
|---|---|---|---|
| Nonce manager | `0x…8250` (`frame.ts:13`, used by `client.ts:261` for `isSpent`) | `0x…8250` (on chain: code `0x60006000fd`) | `0x8250968C12e01A19d6F667b9B2F3b3A4d0e51cB7` (EIP-8250 line 39). **Empty on chain 8141** |
| Slot | `keccak(pad32(sender)‖key)` (`crypto.ts:50`) | Same | Same (lines 110–121) |
| First use | 20,000 execution, in the VERIFY frame (inside our 253,176) | 97,920 state gas from the VERIFY frame's `limits.state`, plus 12,100 intrinsic execution | Same: 97,920 state (`64 × 1530`) and 12,100 intrinsic (`2100 + 10000`) (lines 41–52, 80–89, 185–188) |
| Single-use form | None | None (8250 at about `f3079a09e8`) | `nonce_seq = MAX_NONCE_SEQ` (2^64−1): requires the key unused, writes `MAX` (lines 99–102, 143–151, 165–166) |
| TXPARAM | `0x01` seq, `0x0E` count, `0x10` key 0 (`gen-validator.mjs:108–110`) | Same indices | `0x01` seq, `0x0D` legacy nonce, `0x0E` count, `0x0F` keys hash, `0x10` key 0 (lines 207–222) |
| State-gas budget | n/a | VERIFY `limits.state` ≥ 97,920. Counts toward `MAX_VERIFY_STATE_GAS` (500k), not `MAX_VERIFY_GAS` (line 285) | Same |

**Confirmed from the brief:** `0x8250968C…`, 97,920 state gas plus 12,100 execution, the single-use form, and TXPARAM indices `0x01`, `0x0E`, `0x0F`, `0x10`. There's also a fifth, `0x0D`, for the legacy nonce, which we don't need.

#### Single-use or sequence 0
**Decision:**
- `eips-current` uses **single-use**.
- `devnet-8421` and `hegota-8141` keep **sequence 0**, because single-use doesn't exist there.

**Why single-use where it exists:**
- **The protocol enforces spent-once on its own.** With sequence 0, a used key reads 1, so a second transaction at `nonce_seq = 1` with the same key is valid to the protocol. Only our validator's `TXPARAM(0x01) == 0` pin (`gen-validator.mjs:109`) stops the note's owner re-proving a second spend. With `MAX_NONCE_SEQ`, the key is exhausted and no sequence can select it again. One fewer thing for the validator to get right.
- **It's the EIP's stated form for nullifiers** (lines 297, 327), and it's exempt from the `nonce_seq` calldata pricing (lines 72–76, 299), so it's never more expensive.
- **The validator still pins it:** `TXPARAM(0x01) == MAX_NONCE_SEQ` and `TXPARAM(0x0E) == 1`, plus key 0 bound to the proof's nullifier. With exactly one key, that authenticates the key set, as the security section requires (line 327).

**Cost:** none we can see. `owner-set-v1` uses sequence 0 because it was written before single-use existed.

### 1.3 EIP-8141: frame transactions

| Item | `devnet-8421` | `hegota-8141` (8141 about `7d1c8bfb94`) | `eips-current` (8141 `dc5d5fa688`) |
|---|---|---|---|
| Envelope | 9 fields: `[chain_id, nonce_keys, nonce_seq, sender, frames, signatures, fees, blob_hashes, recent_root_references]` (hegota-support `ethrex-eip8141-tracer`) | 8 fields: `[chain_id, nonce_keys, nonce_seq, sender, frames, signatures, fees, blob_hashes]` | 8 fields, same order (EIP-8141 lines 68–75 with EIP-8250 lines 60–66) |
| `fees` | Per gas | `[max_priority_fee, max_fee_per_gas, max_blob_fee]` (minimal-shielded-pool `src/frametx.ts:7`, `:176`) | `[max_fee, max_priority_fee_per_gas]`, where **`max_fee` is a total in wei** covering execution, state and blobs (lines 74, 89, 567–581; changed by #12414 on 2026-10-22) |
| Signature hash | Signature bytes elided | Elided to empty bytes (`frametx.ts:167`) | Elided to their **length**, RLP-encoded as an integer (lines 250–261, #12502) |
| Frame | `[mode, flags, target, [execution, state], value, data]` | Same | Same (line 71) |
| Our frame layout | `VERIFY(self)`, `SENDER(pool)`, `DEFAULT(pool, refund)` (`frame.ts:57–66`) | `VERIFY(0x…8272, tuples)`, `VERIFY(self)`, `SENDER`, `DEFAULT` | Same, with the contract at the new address |
| Per-frame limits | Execution and state per frame | Same | Same, with explicit pools per frame and state gas isolated (lines 585–600) |
| APPROVE | `0xaa`, scopes 1, 2, 3 | Same | Same: offset, length, scope on the stack. Scope 3 is `self_verify` (lines 740–788, 964, 1021–1022). `verbatim_3i_0o(hex"aa", 0, 0, 3)` at `gen-validator.mjs:207` stays |
| `TXPARAM(0x04)` | Max fee per gas (fee-range option, `gen-validator.mjs:55–56`) | Max fee per gas | **Total `max_fee`** (line 810). The fee-range option needs redefining in total terms |
| `TXPARAM(0x06)` | `maxCost` (used by `checkFees`, `gen-validator.mjs:213`) | Has to be checked against ethrex `64b8fc09` | **Undefined: an exceptional halt** (line 819). `checkFees` becomes `TXPARAM(0x04) ≤ fee`, which is stricter, because `max_cost ≤ max_fee` (line 581) |
| `GASPRICE` | Used in `refund()` (`gen-validator.mjs:232`) | Same | Defined as `base_fee + max_priority_fee // max_gas` (line 583). Allowed there, since refund runs after the validation prefix |
| Intrinsic | Devnet values | 12,000 plus 475 per frame, plus data | Same, plus 12,100 per nonce key and the signature-data rules (lines 534–541). **`REFUND_OVERHEAD` (`gen-validator.mjs:243`) must be re-derived**, and the refund must also add the root frame's gas used (`:229–231`) |
| `MAX_VERIFY_GAS` | Sidecar: 100k unstaked, 1M staked (our patch) | ethrex `--mempool.max-verify-gas`; chain 8141 admits 500,000 (minimal-shielded-pool `src/gas.ts:83–89`) | 100,000 in the text (line 933). [PR #12301](https://github.com/ethereum/EIPs/pull/12301), which turns it into a shared floor with per-node headroom, is **open**: last updated 2026-10-12, one author review short |
| `MAX_VERIFY_STATE_GAS` | n/a | 500,000 | 500,000 (line 934) |
| Pending per sender | Sidecar: per-entity reputation | ethrex relaxes the one-per-sender rule for disjoint nonce keys. `64b8fc09` has **no MATCHA width budget** (minimal-shielded-pool `SECURITY.md` lines 146–154) | The text keeps at most one pending transaction per sender (line 1154). EIP-8250 removes the obstacle, but doesn't relax this (EIP-8250 line 311). The payer reservation caps the summed `max_fee` of pending transactions at the payer's balance (line 1163) |

**`MAX_VERIFY_GAS` status:** unchanged at 100k. PR #12301 changes its meaning only, from a ceiling to a floor, and isn't merged. A pool like ours needs a node that admits above it: chain 8141 at 500k, Nethermind's default at 300k, or the alt mempool with stake.

**The texts disagree in one place:** EIP-8250's payload block (line 65) still shows the three-field per-gas `fees`, while EIP-8141 (line 74) has the two-field total `max_fee`. EIP-8250 says it changes only `nonce`, so EIP-8141's `fees` should win. Nethermind master does that (`FrameTxDecoder.cs`, `MaxFee` decoded as a total, #14374). Logged in `DECISIONS.md`.

### 1.4 Everywhere the profile reaches in our code
| File | What changes per profile |
|---|---|
| `packages/sdk/src/frame.ts` | Envelope, fee field, root carrier, frame order, nonce form, addresses, limits. Becomes a profile table plus one builder per carrier |
| `packages/contracts/script/gen-validator.mjs` | Frame indices, root reads (`rootref` vs `FRAMEPARAM`/`FRAMEDATALOAD`), `checkFees`, fee-range meaning, nonce-sequence pin, `REFUND_OVERHEAD`, minimum SENDER limits. Takes `--profile` |
| `packages/contracts/src/RelaylessPool.sol:37`, `:210` | `RECENT_ROOT` address: becomes an immutable constructor argument, so one source serves every profile |
| `packages/sdk/src/recent-root.ts:11` | Address per profile. The layout is shared |
| `packages/sdk/src/client.ts:261` | `NONCE_MANAGER` per profile. A single-use key reads `MAX`, which is still non-zero, so `isSpent` holds |
| `client.ts:296–316`, `:506`, `:608` | Fee caps: per gas on two profiles, a total on `eips-current`, where `fee = max_fee` needs no simulation at all |
| `client.ts:309`, `:388`, `:540–545` | `ethrex_simulateFrameTransaction`: ethrex only. Nethermind needs another route (see Risks) |
| `apps/asp/src/chain.ts:22` | Root writes go to the profile's address |
| `scripts/local-stack.sh:52`, `scripts/deploy.ts` | Per-profile stack and deployment |
| `packages/sdk/src/store.ts:7` | The in-flight record stores `maxFeePerGas`. It needs a profile-neutral fee field |

## 2. Against `owner-set-v1` (minimal-shielded-pool)
`owner-set-v1` is the reference pool's current profile, written to run on `hegota-8141`. It hasn't been deployed yet: `core/deploy_config.json` still records `position-notes-v3` at `0x5ec4…de09`.

### Align with it
| What | Why |
|---|---|
| **Envelope and encoding for `hegota-8141`** (`src/frametx.ts`) | It's the only working encoding for chain 8141. Matching it byte for byte means one set of test vectors and fewer surprises on the public chain. Our codec gets a vector test against theirs |
| **Frame order:** recent root, then pool VERIFY, then SENDER, then an optional DEFAULT | It's what EIP-8272 requires for the public mempool anyway (line 271). Their dispatcher already checks the root frame's defining fields and status, and binds the exact tuple (`ShieldedPoolDispatcher.yul:270–272`, `:364`). We copy that |
| **Recent-root frame defaults:** 8,000 execution, state pinned to 0 | They measured 5,579 for one tuple, and EIP-8272 requires state 0. We need about 2k more for a second tuple on association-set pools |
| **Not pinning the validation frames' limits, while pinning settlement's** | A limit that's too low only invalidates the transaction, but settlement running out after APPROVE burns the note. We already pin only SENDER minimums |
| **Statement compression (eprint 2025/1500, hybrid)** | The pool computes `alpha = keccak(statement) mod r`, the circuit computes `beta = Poseidon(statement)`, and both evaluate the statement polynomial at `alpha + beta`. It's **Poseidon in the circuit, not SHA-256**, so `DECISIONS.md`'s "about 60k constraints, 2.7x proving" doesn't apply. Saves about 25k for us (see §4). Adopt as its own step |
| **Recording every pin's source** (their activation manifest pins `src/gas.ts`) | Our gas pins live in two files today. One profile table, with a measurement reference per pin, matches their discipline |

### Keep different
| What | Why |
|---|---|
| **Association set** (a second tuple, `ASP_SOURCE_ID`, provider interface) | Our contribution 3 in `docs/landscape.md`. They have disclosure receipts, not association sets. Two tuples in one root frame are within the spec's 16 |
| **k-gate** (root bound to `leafCount`, positional LeanIMT) | Enforced anonymity is part of our developer layer, and it needs the root to commit to the leaf count, which their roots don't |
| **Change notes and one input,** not 2-in/2-out join-split | We don't compete on the pool primitive. Join-split, owner sets and PQ note delivery are theirs. Our change notes derive from the parent nullifier, so recovery needs only the seed |
| **Single-use keys on `eips-current`** | They use sequence 0 with two keys, from before single-use existed. See §1.2 |
| **Paying the recipient inside SENDER, with a `claimable` fallback and a refund frame** | Theirs records a credit and claims it in an optional fourth frame. Ours keeps a 0-ETH recipient paid in the same transaction, which is the core UX promise. Both can't revert after APPROVE |
| **Fee bound into the proof through `sigHash`** | Theirs binds the fee through the owner's signature. Ours has no second signer, and the proof is the authorization |
| **The ERC-8421 alt mempool path** | Our contribution 1. They don't use the alt mempool or stake |

## 3. Clients, networks and the sidecar

| Software | Profile | Evidence |
|---|---|---|
| ethrex `9aa3645d` (our local devnet, chain 1337) | `devnet-8421` | Our running stack. Recent roots as an envelope field |
| Public alt mempool devnet (altmempool.forshtat.com) | `devnet-8421` | hegota-support `ethrex-eip8141-tracer`. Its gateway can't admit our withdrawal (`docs/repro-gateway.md`) |
| **ERC-8421 sidecar** `2e22ff0a` (2026-10-25, latest) | **`devnet-8421` only** | Its codec is hegota-support's `ethrex-eip8141-tracer` envelope with `recentRootReferences`. No commits since our pin |
| **`@forshtat/hegota-support` 0.0.1** (latest) | `ethrex-eip8141-tracer`, `ethrex-hegota-devnet`, both "early revision" EIP-8272 | `dist/profiles/*.js`. Its own comment says the current text has no such field |
| ethrex `64b8fc09` = `bdfc5d8f` plus 8 testnet fixes: **chain 8141 RPC** | `hegota-8141` | `web3_clientVersion` on `rpc1.privacy.ethrex.xyz`. Code at `0x…8272` and `0x…8250`, none at the new addresses. Admits 500k verify gas. No MATCHA width |
| ethrex `247e2dd2` | `hegota-8141` with a MATCHA width budget, on by default | minimal-shielded-pool `SECURITY.md` lines 136–154. Pinned by their native suite. Not seen on a public network |
| Nethermind master (2026-11-14) | **`eips-current`** | `Eip8272Constants.cs` (new address, current bytecode), `Eip8250Constants.cs` (new address, `MaxNonceSeq`), `FrameTxDecoder.cs` (total `MaxFee`, length elision). Commits #14437 (2026-10-09), #14374 (2026-10-27), #14791 (2026-10-29) |
| ethrex main | No match for the new addresses in GitHub's code index | It may be lagging. Recheck before Part 4 |

### The dual (here, triple) profile
The sidecar can't carry a VERIFY-frame root, so we keep `devnet-8421` for the alt mempool path, as the brief planned, and add the others beside it:

```
profiles.ts
  devnet-8421   envelope9, fees/gas, rootField,  0x…8272, 0x…8250, seq0,       sidecar
  hegota-8141   envelope8, fees/gas, rootFrame,  0x…8272, 0x…8250, seq0,       ethrex 64b8fc09
  eips-current  envelope8, maxFee,   rootFrame,  0x8272D…, 0x8250…, singleUse, Nethermind master
```

**Shared:**
- the circuits, the trusted setup, the verifying keys and the proof encoding;
- the pool contract, with the root address as a constructor argument;
- recovery, the meter, the k-gate, the association set and the in-flight ledger.

**Per profile:**
- `frame.ts`: a codec and builder;
- the validator, from one generator with `--profile`, which emits different frame indices, root reads and fee checks;
- the gas pins;
- the local stack script.

A pool is deployed for one profile, because the validator's bytecode is profile-specific. The deployment config records which.

## 4. The verification budget

**Today, measured (`devnet-8421`):** VERIFY frame 253,176 execution, including 20,000 for the nonce key's first use. 7 public inputs, at about 6,645 each beyond the first.

**Estimated for `hegota-8141` and `eips-current`.** To be measured in Part 4:

| Part | Gas | Basis |
|---|---|---|
| Pool VERIFY frame, execution | about 233,000 | 253,176 minus the 20,000 first-use charge, which leaves the frame. The root reads change from `0xb6` to `FRAMEPARAM`/`FRAMEDATALOAD`: a few dozen gas |
| Pool VERIFY frame, state | 97,920 | One first-use key. Doesn't count toward `MAX_VERIFY_GAS` |
| Recent-root frame | about 5,600 (one tuple) or 8,000 (two) | minimal-shielded-pool measured 5,579 for one. A second tuple adds a cold SLOAD (2,100) and two keccaks |
| Signature | 100 | `ARBITRARY` |
| **Declared validation budget** | **about 250,000** | Limits with the 1/64 margin for nested calls: about 240k pool VERIFY plus 8k (or 10k) root frame plus 100 |
| Intrinsic, moved out of VERIFY | +12,100 execution per key | Not part of the validation budget |

| Budget | Admits about 250k? |
|---|---|
| EIP-8141 `MAX_VERIFY_GAS` (100k) | No |
| Chain 8141 (500k) | Yes |
| Nethermind default (300k) | Yes, with about 50k spare |
| Nethermind's measurement: 250k holds one attacker peer only at a 25 ms slowdown, with no margin | Right at the edge |
| Sidecar, staked (1M) / unstaked (100k) | Yes / No |

### Compress now?
- **What it would do:** 7 inputs to 3, as `owner-set-v1` does. That saves about 4 × 6,645 ≈ 26.6k in the verifier, less about 1–2k for the validator's keccak and polynomial evaluation. **Net about 25k:** pool VERIFY about 208k, declared about 225k.
- **Circuit cost:** a Poseidon over 7 values plus a few multiplications, a few hundred constraints on top of 24,965. That's not the 60k for SHA-256 the earlier decision assumed.
- **Recommendation: yes, but as its own step after the port,** not inside it:
  - It's profile-independent, so it doesn't need to block the testnet deployment, which admits 500k anyway.
  - It moves us from "at the edge" to about 25k under the 250k Nethermind measured, which matters for every node that runs its default.
  - It changes the circuit, the zkey (still devnet-grade), the validator and the SDK at once, so it deserves its own measurements and review.
  - It also matches the reference pool, which makes a later comparison of verification costs clean.

## 5. Effort, order and risks

### Order
| Step | What | Estimate | Done when |
|---|---|---|---|
| A | Profile table, and the pool's `RECENT_ROOT` as a constructor argument. `devnet-8421` behaviour unchanged | 0.5–1 day | All current suites pass unchanged |
| B | `hegota-8141`: our own 8-field codec (hegota-support has none) with test vectors against minimal-shielded-pool's encoding, the root VERIFY frame, the validator with shifted indices and `FRAMEPARAM`/`FRAMEDATALOAD` root reads, and the 97,920 state limit | 2–3 days | Unit vectors match theirs, and simulations pass against a local `64b8fc09` chain |
| C | Local `hegota-8141` chain: ethrex `64b8fc09` with a consensus client, scripted like `local-stack.sh` | 1–2 days, **risky** | `e2e` and `e2e-asp` pass on it |
| D | `eips-current` on top of B: addresses, total `max_fee`, length elision, single-use keys, `TXPARAM(0x04)` fee check. Local Nethermind master chain | 1–2 days, **risky (stack)** | Suites pass on Nethermind |
| E | Re-derive every gas pin from receipts: SENDER minimums, `REFUND_OVERHEAD`, verify limits. Rerun fuzz and adversarial-recipient tests per profile | 1 day | `docs/gas-report.md` per profile. The no-revert property holds |
| F | CI matrix: unit tests on every push, and e2e per profile where the stack can run in CI | 0.5–1 day | Green on `refocus` |
| G (Part 5) | Deploy on chain 8141 with `hegota-8141` | 0.5 day plus funding | Explorer links. **Blocked on funds** |
| H (later) | Statement compression | 2–3 days | New measurements on all profiles |

**Total for Part 4 (A–F):** about 6–10 working days. Most of the uncertainty is in C and D, standing up the two client stacks.

### Risks
1. **No funding route for chain 8141.** minimal-shielded-pool documents an RPC but no faucet or explorer. Part 5 will need a message to soispoke or the ethrex team, as the brief allows.
2. **A local `hegota-8141` chain.** It needs ethrex `64b8fc09` built from source, with a beacon node that sets `slotNumber`. minimal-shielded-pool's native suite runs the VM directly, not a full chain. If we can't stand one up, the fallback is simulating against the public RPC (read-only, no funds) and running the live tests only on chain 8141.
3. **`ethrex_simulateFrameTransaction` is ethrex-only.** The SDK uses it for `maxCost` and the preflight. On `eips-current`, `max_cost ≤ max_fee` is a formula, so the fee needs no simulation. The preflight needs whatever Nethermind offers for frame transactions (`eth_simulateV1`, `eth_estimateGas`, or a trace). Without one, we lose "never broadcast what would fail" on that profile, and that rule exists to protect reputation. To check first in D.
4. **SENDER state gas under EIP-8037.** Each new storage slot costs 97,920 state gas. Settlement creates tree nodes and the change leaf, and it may write a fresh recent-root slot. The devnet's 477,360 measured under older pricing. `MIN_SENDER_STATE = 1,000,000` (`gen-validator.mjs:256`) may be too low on the new profiles; the reference pool pins 550k for a different settlement. If it's too low, a note burns after APPROVE. **Measure the worst case, at full tree depth, before any public deployment.**
5. **One pending transaction per sender in public mempools** (EIP-8141 line 1154).
   - **ethrex `64b8fc09`:** relaxes it for disjoint keys, and has no width cap.
   - **Nethermind:** not yet checked.
   - **Payer reservation:** limits the summed `max_fee` of pending withdrawals to the pool's balance, so the SDK's solvency check should count pending transactions, not just the one being sent.
6. **The texts are drafts and moving.** Three of the four relevant files changed in October. The profile table keeps each moving part in one place, and every profile records the EIP commits it follows.
7. **MATCHA can't be measured on chain 8141,** because `64b8fc09` has no width budget. Concurrent-withdrawal results there will show the relaxed per-sender rule, not MATCHA. Testing MATCHA would need `247e2dd2` locally.

### What needs the author before Part 4
- Approve the three-profile plan (or drop `eips-current` for now).
- Approve doing compression later (step H), not in Part 4.
- Know that Part 5 will probably need a message to get chain 8141 funds.

## Sources
- EIP-8141 at `dc5d5fa688` (2026-11-01), EIP-8250 at `1a086d5c67` (2026-10-19), EIP-8272 at `5e32ce9abb` (2026-10-08), EIP-7843 at `f1ade090fd`, fetched from `ethereum/EIPs` master.
- [PR #12301](https://github.com/ethereum/EIPs/pull/12301): open. [PR #12422](https://github.com/ethereum/EIPs/pull/12422): closed.
- `soispoke/minimal-shielded-pool` at `eb1bc0e7e1`: `README.md`, `SECURITY.md`, `docs/design.md`, `core/dispatcher/ShieldedPoolDispatcher.yul`, `src/frametx.ts`, `src/gas.ts`, `core/deploy_config.json`.
- Chain 8141 via `https://rpc1.privacy.ethrex.xyz`: `web3_clientVersion`, and `eth_getCode` at `0x…8272`, `0x…8250`, `0x8272D967…`, `0x8250968C…`, `0x81413f0c…`.
- `NethermindEth/nethermind` master: `Eip8272Constants.cs`, `Eip8250Constants.cs`, `FrameTxDecoder.cs`, and the commits named above.
- `forshtat/mempool-workshop-sidecar` (`2e22ff0a`), `@forshtat/hegota-support@0.0.1`.
