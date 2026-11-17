# Landscape: privacy pools on frame transactions

*As of 2026-11-16. This page sets out what already exists, where Relayless overlaps, and where it adds something new. Every post and grant application should be consistent with it.*

## The protocol context

- **Hegotá ([EIP-8081](https://eips.ethereum.org/EIPS/eip-8081)):**
  - Scheduled for inclusion: EIP-8141 (frame transactions) and EIP-7805 (FOCIL).
  - **Only considered for inclusion: EIP-8250 (keyed nonces) and EIP-8272 (recent roots).** Every privacy pool on frames, including this one, depends on both.
  - Proposed: EIP-8369 (FOCIL for frame transactions).
  - Declined: EIP-8182 (protocol-level private transfers). That leaves privacy to application-layer pools.
- **Verification budget:** a Groth16 withdrawal needs about 211k–253k gas of verification, against EIP-8141's 100k cap. [PR #12301](https://github.com/ethereum/EIPs/pull/12301) would turn the cap into a shared mempool floor, with each node free to run higher. Nethermind already defaults to 300k.

## The three reference pieces

### 1. soispoke's `minimal-shielded-pool` (Thomas Thiery, EF)
[Repository](https://github.com/soispoke/minimal-shielded-pool)

An immutable, native-ETH shielded pool on the ethrex Hegotá testnet (chain 8141). It's the most complete reference implementation.

- **Core design:**
  - The pool is the sender, the nullifiers are EIP-8250 nonce keys, and the root arrives as an EIP-8272 recent-root VERIFY frame.
  - Pool code is a Yul dispatcher written with `verbatim`.
  - Settlement can't fail after approval, and its gas limits are pinned.
- **Circuit and proving:**
  - 2-in/2-out join-split transfers and withdrawals.
  - An 11-value statement compressed to **3 public inputs** (eprint 2025/1500), which saves about 44k gas.
  - Nullifiers bound to tree position and epoch, with multi-epoch trees.
- **Keys and wallet:**
  - **Owner sets:** the owner signs an EIP-712 intent from a hardware wallet, and the prover never holds the spending key.
  - Post-quantum (ML-KEM-768) encrypted note delivery to reusable addresses, with recovery by scanning from the seed.
- **Compliance-adjacent:** disclosure receipts (selective proof of where funds came from and went).
- **Assurance:**
  - Lean formal verification of an earlier version. Most pinned files have since changed.
  - Public testnet deployments since September 2026, and a current-spec profile (`owner-set-v1`, at EIP-8141 `7d1c8bfb94`, EIP-8250 `f3079a09e8`, EIP-8272 `824cbc0b0e`).
- **What it doesn't cover:**
  - association sets;
  - an alt mempool or staking path;
  - reputation.

  Its SECURITY.md notes that per-sender mempool and inclusion-list limits hit every user at once. It names two ethrex revisions:
  - **`64b8fc09`, which chain 8141's RPC node runs** (`bdfc5d8f` plus eight testnet fixes), relaxes EIP-8141's one-pending-per-sender rule for spends with disjoint nonce keys and **has no width budget**.
  - **`247e2dd2`, which its native test suite pins,** relaxes the same rule but also runs MATCHA, on by default. A few concurrent spends, or one note holder replacing a spend, can delay everyone. `247e2dd2` also panics when a top-level frame calls a precompile after an earlier frame emitted logs. `64b8fc09` carries the fix.

### 2. Nethermind, "A privacy pool on frame transactions: what works, and the case that does not yet"
[Post](https://ethresear.ch/t/a-privacy-pool-on-frame-transactions-what-works-and-the-case-that-does-not-yet/26223) (Daniil Ankushin and Manuel Arto, November 2026)

They ran soispoke's pool on Nethermind master.

- **Measured costs:**
  - a withdrawal costs **679,322 gas**;
  - the proof check uses 215,654 execution gas;
  - each new nullifier key costs **97,920 state gas** plus 12,100 execution gas.
- **Double spend:** a second spend of the same nullifier was refused at admission, and when forced into a block, the block included zero transactions.
- **Budget measurements ([note](https://hackmd.io/@0Eo_JbIrQIKnf-o35CQ9EQ/H12MW5GsMg)):**
  - a 250k budget holds one attacker peer at a 25 ms block-building slowdown, with no margin;
  - a 300k budget holds one attacker peer only at 50 ms.
- **Open problem:** a pool that pays for a call from the user's *own* address. Nonce keys are scoped to the sender, so the protocol gives no spent-once guarantee across senders. Their proposed change was closed after an EIP-8250 author objected ([PR #12422](https://github.com/ethereum/EIPs/pull/12422)).
- **Thread:** soispoke asked which user flows need that case. The answer was mostly EOAs acting from their own address (repaying a loan, claiming an airdrop, voting).

### 3. MATCHA: Mempool Account Transaction Capacity from Historical Activity
[Post](https://ethresear.ch/t/mempool-account-transaction-capacity-from-historical-activity-matcha/25949) (soispoke, with Vitalik and Toni, September 2026)

A local mempool policy that lets one shared sender (a privacy pool) have many pending transactions.

- **How it works:**
  - Each extra admission spends **width**.
  - Width is earned only from the sender's gas used in finalized blocks.
  - Spent width is never returned, which bounds repeated mass invalidation.
  - FOCIL (EIP-8369) is meant to make flooding with valid transactions costly.
- **Already in a client:** ethrex `247e2dd2` implements a MATCHA width budget, on by default, according to minimal-shielded-pool's SECURITY.md. **Chain 8141 doesn't run it:** its RPC node runs `64b8fc09`, which only relaxes the per-sender rule for disjoint nonce keys.
- **The authors' own next steps:**
  - test mass invalidation and width draining, including repeated replacements;
  - calibrate charges and caps;
  - measure honest throughput.
- **Thread:**
  - indexing the charge by contention, and whether to reserve the payer's balance (Ankushin);
  - extending width to paymasters (soispoke);
  - jstinhw's 100-senders attack with one nullifier, which leads back to "the pool must be the sender" (mmjahanara, Ankushin).
- **Gaps:** reputation is mentioned only once, and **ERC-8421 alternative mempools aren't discussed at all.**

## Where Relayless overlaps (and should credit)

| Mechanism | Relayless | Prior work |
|---|---|---|
| Pool is the sender and pays gas from the note | Yes | namnc's L1.5 post, minimal-shielded-pool |
| Nullifier = EIP-8250 nonce key | Yes | Same |
| Root via EIP-8272, no storage reads in validation | Yes (devnet field form on `devnet-8421`, VERIFY-frame form on `hegota-8141`) | Same (current VERIFY-frame form) |
| Yul validator with `verbatim` | Yes | Same |
| Settlement can't fail after approval | Yes, fuzz-tested | Same, with pinned limits |
| Every public input range-checked | Yes | Same |
| Statement compressed to 3 public inputs (eprint 2025/1500) | Yes, the withdrawal, since 2026-11-17 | Same, which Relayless adapted |

**None of the core pool design is novel.** Present it as built on prior work.

## Where they are ahead

- **Compressed statement:** they compressed first (11 values to 3 public inputs, saving about 44k). Relayless adopted the same scheme on 2026-11-17 (7 values to 3, saving 25,470 on `hegota-8141`, where the pool's VERIFY frame now uses 207,913). The ragequit isn't compressed yet.
- **Private transfers:** join-split. Relayless only withdraws and pays.
- **Wallet security:** owner sets and hardware-wallet signing, post-quantum note delivery, disclosure receipts.
- **Assurance:** a formal-methods effort and a reproducible-artifact discipline.
- **Up to date:** the current-spec profile (`owner-set-v1`) and public testnet history since September 2026. Relayless has `devnet-8421` and `hegota-8141`, and has been on chain 8141 since 2026-11-16.

## Where Relayless is different: our contribution

1. **The ERC-8421 alternative mempool path.**
   - A staked shared sender, admitted with about 253k gas of verification.
   - The public gateway can't admit any Groth16 withdrawal: its 100k cap applies even to staked senders, and COD-010 blocks precompiles. Repro and patch in the repo.
   - No other work covers this path.
2. **Shared-sender reputation, measured.**
   - ERC-8421 counts every transaction admitted but never mined against the sender. A shared pool sender inherits that risk from every user.
   - We measured griefing (`seen`/`included` across nodes), found a replacement-counting bug that the alt mempool authors confirmed, fixed it with a test, and proposed an eviction rule: don't count it against the sender when its own nonce key was consumed on-chain.
   - MATCHA covers the public mempool. **No one has studied how width and ERC-8421 stake and reputation interact for shared senders.**
3. **Running on chain 8141, with association sets and change notes** (`hegota-8141` profile, 2026-11-16, 5/5; links in the README's [Public testnet](../README.md#public-testnet) section):
   - A private withdrawal to a fresh address holding 0 ETH, paid entirely from the note through the chain's public mempool: no relayer, no alt mempool, no stake. 941,778 gas: root frame 5,579, pool VERIFY 233,383 + 97,920 state, SENDER 193,729 + 379,440 state, refund 9,967.
   - A double spend refused by the node's simulation before broadcast, on the nonce.
   - Three withdrawals from the one pool sender pending at once. **This shows `64b8fc09`'s relaxed per-sender rule for disjoint nonce keys, not MATCHA,** which chain 8141 doesn't run.
   - A public exit (ragequit) to the depositor.
4. **Compliance: association sets and ragequit,** the Privacy Pools model. Withdrawals prove membership in an approved set, and excluded depositors can always exit publicly to their deposit address. The reference pool has disclosure receipts but no association sets.
5. **The developer and user layer:**
   - seed recovery from one wallet signature;
   - any-amount payments, split across notes and pending concurrently;
   - an admission simulation before broadcast, so a failing transaction is never sent and never costs reputation;
   - a *k*-gate enforced inside the proof;
   - an anonymity meter based on min-entropy;
   - about 2 s browser proving, a TypeScript SDK and a CLI.

## Where we must catch up

- **Spec version:** ported on 2026-11-16 to two profiles: `devnet-8421` (the sidecar devnet) and `hegota-8141` (chain 8141: recent-root VERIFY frame, nonce manager at `0x8250968C…`, 97,920 state gas per new key). Not yet on `owner-set-v1` or the EIPs at current master (`eips-current`).
- **Public testnet history:** one run on chain 8141 (2026-11-16), against the reference pool's deployments since September 2026.
- **The ragequit's public inputs** aren't compressed yet (the withdrawal's are, since 2026-11-17).
- **No transfers.**
- **Devnet-grade trusted setup** and no audit.

## Open problems nobody has solved (where we can contribute)

1. **MATCHA × ERC-8421.** How earned width and stake and reputation should combine for shared senders, tested with real attacks. MATCHA's own next steps ask for exactly this kind of testing, and Relayless already has a griefing harness.
2. **Inclusion for shared senders.** Includers that cap transactions per sender (ethrex defaults to two) limit pools under FOCIL and EIP-8369.
3. **The verification budget.** Evidence for PR #12301's floor, and the path to aggregated proof verification in the mempool (EIP-8288).
4. **Compliance on frame-transaction pools.** Association sets inside the frame flow.
5. **A pool paying for a call from the user's own address.** Open. Relayless doesn't solve this, and must not claim to.

## Positioning, in one line

> *Relayless doesn't compete on the pool primitive, where soispoke's reference implementation is ahead. It contributes the alternative-mempool path, shared-sender reputation research, a compliance layer, and the developer-facing SDK.*

## Implications for the roadmap

- **Collaborate rather than compete.** Align with the `owner-set-v1` profile where sensible, adopt the statement compression (done for the withdrawal on 2026-11-17), and offer the SDK and association-set layer as something that composes with it.
- **Reframe the MATCHA work.** MATCHA already exists in ethrex, so our value is testing it against Relayless's shared-sender attacks, comparing it with ERC-8421 reputation, and publishing the results.
- **Support EIP-8250 and EIP-8272 for Hegotá** with Relayless as a working user.

## Sources

- [soispoke/minimal-shielded-pool](https://github.com/soispoke/minimal-shielded-pool), including `docs/design.md` and `SECURITY.md`
- [Nethermind: A privacy pool on frame transactions](https://ethresear.ch/t/a-privacy-pool-on-frame-transactions-what-works-and-the-case-that-does-not-yet/26223)
- [MATCHA](https://ethresear.ch/t/mempool-account-transaction-capacity-from-historical-activity-matcha/25949)
- [EIP-8081: Hegotá meta](https://eips.ethereum.org/EIPS/eip-8081), [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141), [EIP-8250](https://eips.ethereum.org/EIPS/eip-8250), [EIP-8272](https://eips.ethereum.org/EIPS/eip-8272)
- [EIP-8141 and minimum required validation budget for privacy applications](https://ethresear.ch/t/eip-8141-and-minimum-required-validation-budget-for-privacy-applications/25889) (mmjahanara)
- [Ephemeral Rollup: the new L1.5 of Ethereum](https://ethresear.ch/t/ephemeral-rollup-the-new-l1-5-of-ethereum/26187) (namnc)
- [Frame transactions and the three gates to privacy](https://ethresear.ch/t/frame-transactions-and-the-three-gates-to-privacy/24666) (nero_eth)
