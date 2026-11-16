# Relayless

🥇 1st place, EF: Best use of the Frame Transaction Alternative Mempool, ETHGlobal Mumbai 2026. The hackathon version is tagged `v1.0-ethglobal-mumbai`.

**Pay anyone privately, from a wallet with no history. No relayer. It tells you how hidden you are before you pay.**

- **What:** a privacy pool that pays gas from the note being withdrawn, so a brand-new wallet holding 0 ETH can receive money with nobody funding it, using EIP-8141 frame transactions and the alt mempool.
- **Where it fits:** the pool primitive builds on prior work, where [soispoke's reference pool](https://github.com/soispoke/minimal-shielded-pool) leads. Relayless adds the ERC-8421 alt mempool path, measured shared-sender reputation, a provider-agnostic compliance layer, and the SDK. See [docs/landscape.md](docs/landscape.md).
- **Run it:** `scripts/local-stack.sh && pnpm web`, then open http://127.0.0.1:5199. See [Run it](#run-it).

![A payment to a wallet holding 0 ETH](docs/img/demo.gif)

| Part | What's real | Where it runs |
|---|---|---|
| Core: frame withdrawals, recovery, meter, k-gate | Works end to end on both spec profiles: 34 e2e checks on `devnet-8421`, 32 on `hegota-8141` | `devnet-8421`: ethrex `9aa3645d` plus a patched ERC-8421 sidecar (the alt mempool path). `hegota-8141`: a local chain on ethrex `64b8fc09`, the revision the public Hegotá testnet runs. See [Spec profiles](#spec-profiles) |
| Association sets and public exit | Works with any provider through one SDK interface, with an allowlist ASP as the reference | Both profiles, locally. See [Association sets](#association-sets) |
| Public testnet (chain 8141) | Deployment prepared, waiting for testnet funds | See [Public testnet](#public-testnet) |

Testnets and local chains only. Not audited.

## What you get
Privacy pools with no relayer have been prototyped. This is the layer that makes one usable:

- **One seed, nothing to back up.** Your wallet signs once. Notes and fresh addresses derive from that signature, and everything, change notes included, can be rebuilt from the chain on any device.
- **Pay any amount.** Partial payments leave a change note. A payment bigger than any one note splits across several, all pending at once.
- **Withdrawals don't wait for each other.** Each one has its own nullifier as its nonce key, and validation reads no storage. So one pool can serve many users at the same moment.
- **See how hidden you are.** Every deposit is drawn as a dot, sized by how suspicious it looks from outside. You get min-entropy and Shannon scores, plus advice you can act on: wait, split, or change the amount. It's an explicit model, not a guarantee.
- **Enforce it if you want.** Require at least *k* notes after yours, checked inside the proof.
- **Compliance path.** An optional association set: only approved deposits withdraw privately, and anyone else can always exit publicly to the wallet that deposited. Any association set provider plugs in, such as an allowlist or 0xbow's ASP. See [Association sets](#association-sets).

## Findings for the alt mempool
Building a pool where every user shares one sender surfaced these, each reproducible:

| Finding | Evidence | Status |
|---|---|---|
| **Verification over 100k is rejected, even for a staked sender.** The cap runs before stake is looked up | Live gateway: `250000 exceeds MAX_VERIFY_GAS 100000`, from a sender with a real stake | Fixed in our local patch. [Repro](docs/repro-gateway.md) |
| **Precompile calls are rejected during validation, even under the cap** (`COD-010`), because `precompiles` is empty in the gateway's config | Live gateway rejects a 60k frame calling `0x06` | Config fix locally. [Repro](docs/repro-gateway.md) |
| **Replacements inflate reputation.** Each fee bump counted as a new `seen`, against ERC-8421's REPUTATION-040. **The alt mempool authors confirmed this as a prototype bug** | 8 bumps from one note: `seen` 0 → 8 before our fix, 0 → 1 after | Fixed in our patch. [Write-up for upstream](docs/upstream-pr.md) |
| **A note owner can grief the shared sender across nodes.** A node that never sees the tx mined keeps it against the pool | Same note sent to two nodes: `seen 2, included 0` on the non-mining one | **Open.** It needs a rule change. At that rate, throttling a node takes about 110 notes and banning about 510 (calculated, not reached) |

### Why allowing precompiles in validation is safe
ERC-8421's CALLING-040 already allows `0x01–0x11` and `P256VERIFY`, and only the gateway's config blocks them. These precompiles are:

- **Pure and deterministic:** the output depends only on the input, so a result can't differ because of who runs it or when.
- **Stateless:** they read no storage, balance, code or block data, and write nothing.
- **Gas-bounded:** each call is priced from its input and counts against the entity's validation budget, so a transaction can't spend more than it declared.

So they add no mass-invalidation risk for builders. Nothing another transaction does can change a precompile's result, and a precompile call can't change anything another transaction depends on, so a block landing gives a builder nothing extra to revalidate.

**What else changes:** allowing precompiles is a config value. [The patch](patches/sidecar-budget-010.patch) otherwise changes only per-entity gas budgets (BUDGET-010), plus the replacement fix (REPUTATION-040).

**One limit:** this is about correctness, not cost. Gas doesn't price CPU evenly, and [Nethermind's follow-up to the budget research](https://ethresear.ch/t/eip-8141-and-minimum-required-validation-budget-for-privacy-applications/25889) reports a real circuit costing about 3.3x more CPU per gas than a synthetic one. So the budget is what limits node work, and a node should set it with that in mind.

[Everything about reputation and griefing, with mitigations](docs/reputation-analysis.md).

The authors confirmed a local sidecar is fine for judging. Separately, ethrex lost the number lookup for a run of blocks on 2 of 2 fresh chains; the cause is unknown, and the SDK reads around it. See the [write-up](docs/upstream-pr.md#separate-issue-ethrex-loses-block-numbers).

## How it works
EIP-8141 frame transactions let the pool be the sender and pay gas from the note being withdrawn. A fresh wallet receives money without ever holding ETH.

![Sequence of a payment](docs/img/sequence.png)

![The three frames of a withdrawal](docs/img/frame-layout.png)

On `hegota-8141`, a fourth frame leads: EIP-8272's recent-root verifier, a VERIFY frame to the recent-root contract carrying the roots the proof uses. On `devnet-8421` those roots travel in an envelope field.

| Mechanism | How |
|---|---|
| Double spends | The nullifier is an EIP-8250 nonce key, consumed atomically with payment approval. A second spend is an invalid transaction, not a paid failure |
| Root | Referenced as an EIP-8272 recent root, not read from storage. Bound to the leaf count, for the k-gate |
| Binding | The proof sits in an `ARBITRARY` signature and commits to `sigHash`, so recipient, fee and every frame are fixed |
| Pool safety | The validator pins the exact transaction shape, and `maxCost ≤ fee ≤ amount`, so one note can't spend others' money |
| Note safety | The SENDER frame cannot revert after APPROVE. A refused payment becomes a claim, not a lost note |

**The most interesting problem is the shared sender.** Reputation drops for every transaction admitted but not mined, and every user shares the pool's. [docs/reputation-analysis.md](docs/reputation-analysis.md) lists every way this can happen, with griefing measurements, what we mitigated, and what needs a rule change.

## Spec profiles
EIP-8141, EIP-8250 and EIP-8272 are drafts that changed in October 2026, and the chains that run them follow different revisions. A pool is built for one **spec profile**, because its validator's bytecode depends on it:

| Profile | Follows | Where | Withdrawals go to |
|---|---|---|---|
| `devnet-8421` | ethrex `9aa3645d`: recent roots in an envelope field | `scripts/local-stack.sh` | The ERC-8421 alt mempool (sidecar), with the pool staked |
| `hegota-8141` | ethrex `64b8fc09`: EIP-8141 `7d1c8bfb94`, EIP-8250 `f3079a09e8`, EIP-8272 `824cbc0b0e`. Recent roots in a VERIFY frame | `scripts/local-stack-hegota.sh`, and the public chain 8141 | The node's own public mempool, which admits up to 500,000 verify gas. No stake |

The circuits, pool contract, recovery, meter, k-gate and association sets are shared. What differs lives in `packages/sdk/src/profiles.ts` and the validator generator's profile table. A third profile for today's EIP texts (`eips-current`, which only Nethermind master implements) can be added there without touching shared code. Why it isn't built yet, and everything else about the port, is in [docs/spec-port.md](docs/spec-port.md).

## Run it
Needs Docker (running), Node, pnpm and Foundry. From a fresh clone, one command brings up a private local chain and the patched alt mempool, then deploys (the `devnet-8421` profile):

```sh
scripts/local-stack.sh   # about 13 minutes the first time: frame transactions activate about 11 minutes after genesis
pnpm web                 # http://127.0.0.1:5199
```

Everything binds to localhost, and the keys it creates are throwaway. It's safe to rerun: it reuses a running stack and deploys a fresh pool. To stop, run the command it prints at the end.

The association-set pool is optional. `scripts/setup-asp.sh` deploys it on the running stack, and `pnpm demo:asp` starts its reference ASP on port 8790.

**Demo mode.** Open the app with `?demo=1` for the demo buttons and fewer raw addresses on screen. The demo runs on the association-set pool:

```sh
scripts/setup-asp.sh                        # once per stack: the association-set pool
pnpm demo:asp                               # its allowlist ASP, on 8790, in its own terminal
pnpm demo:seed                              # demo data, see below
pnpm demo:reset                             # a new wallet and fresh recipient, for each take
RELAYLESS_NETWORK=local-asp pnpm web
pnpm demo:prep                              # a green or red line for everything; --fix runs the safe fixes
```

**Demo data, clearly:** `demo:seed` makes 56 deposits from throwaway keys into that pool, so the meter and dot chart have a crowd. **Those dots are seed data, not users.** They and the demo wallet are approved directly by the allowlist ASP's operator, which is that ASP's stated policy.

**The `hegota-8141` profile, locally.** Needs Rust, Node, pnpm and Foundry, no Docker. The first run builds ethrex `64b8fc09` from source, about 10–20 minutes:

```sh
scripts/local-stack-hegota.sh                         # ethrex in dev mode, chain id 81410, then deploys
set -a; . .relayless/hegota-stack/keys.env; set +a
pnpm e2e local-hegota
```

Tests:

```sh
pnpm test:circuits && pnpm test:contracts && pnpm test:sdk && pnpm test:asp
pnpm typecheck && pnpm build
set -a; . ./.env; set +a
pnpm e2e                                   # against the running stack
pnpm e2e:asp                               # the association-set pool, after scripts/setup-asp.sh
npx tsx scripts/adversarial.ts local       # ten hostile recipients, each paid by a real withdrawal
npx tsx scripts/gas-floors.ts local        # the SENDER frame's worst case at full tree depth
```

The same commands take `local-hegota` (and `scripts/setup-asp.sh local-hegota .relayless/hegota-stack/keys.env`, then `pnpm e2e:asp local-hegota-asp`). CI runs the unit suites on every push, and both profiles' end-to-end suites on demand and nightly.

Latest results are in [PROGRESS.md](PROGRESS.md).

SDK:

```ts
const rl = await Relayless.connect({ rpc, mempool, profile: "hegota-8141", pool, signer, prover });
await rl.deposit({ amount });
await rl.pay({ to, amount, minAnon: 32 });
const a = await rl.anonymity({ amount }); // { minEntropyBits, shannonBits, setSize, advice }
```

CLI: `npx tsx packages/cli/src/cli.ts deposit|withdraw|anonymity|recover|fresh|ragequit`

## Association sets
A pool can require that a note's label is in an approved set before it leaves privately. Whoever is left out can always exit publicly, to the address that deposited. That's the Privacy Pools model, carried into frame transactions.

- **Any provider.** The SDK speaks to an association set provider (ASP) through one interface, `AssociationSetProvider`: the current root, a membership proof for a label, an approval status, and the root's on-chain source id. The allowlist server in `apps/asp` is the reference implementation. [How a third-party ASP, such as 0xbow's, would implement it](docs/association-sets.md).
- **What the chain enforces.** The pool accepts roots from exactly one EIP-8272 source, fixed at deployment. The validator checks the root against the chain, and the circuit checks membership against the root. So a provider can withhold or over-approve, but it can't fake a root or a proof, move money, or block the public exit.
- **Checked before sending.** The SDK refuses a provider whose source isn't the pool's, and a proof that doesn't reach its root. It simulates before broadcasting, so a root the chain doesn't hold is caught without costing the pool reputation.

The hackathon version also had a World ID ASP, an ENSv2 directory of ASPs on Sepolia, private receive names, and an optional Nym route. They're in the tag `v1.0-ethglobal-mumbai`, and the Sepolia contracts stay deployed with their subregistry roles revoked.

## Public testnet
*Not deployed yet: waiting for chain 8141 funds. This section is filled in once the run below is done.*

The Hegotá privacy testnet, chain 8141, run by the ethrex team: RPC `https://rpc1.privacy.ethrex.xyz`, explorer [dora.privacy.ethrex.xyz](https://dora.privacy.ethrex.xyz). The node runs ethrex `64b8fc09`, so the pool uses the `hegota-8141` profile.

| Step | Transaction |
|---|---|
| Deploy: Poseidon T3, T4, validator, pool | pending |
| Deposit | pending |
| Private withdrawal to a fresh address holding 0 ETH | pending |
| Double spend of the same note, refused before broadcast | pending (nothing is sent) |
| Concurrent withdrawals from the one pool sender | pending |
| Public exit (ragequit) to the depositor | pending |

The run sequence is in [docs/testnet-run.md](docs/testnet-run.md).

## CROPS
- **C:** We run no server, relayer or RPC. You depend on a mempool node and an RPC, which anyone can run. If a node refuses you, use another. The pool has no owner and can't be upgraded or paused. The exception is the association set, if a pool uses one: its operator decides who can withdraw privately, and public exit stays open regardless.
- **O:** GPL-3.0, because circomlib's GPL-3.0 circuits are compiled into the project (see [NOTICE.md](NOTICE.md)). Builds and runs from this repo, using a patched third-party sidecar until the public gateway supports it.
- **P:** The RPC and mempool node see your IP, and everything on-chain is public: deposits, amounts, recipients, and *k*. Reads fetch all deposits, so they don't reveal which are yours. No trackers or analytics: a full browser run contacted no outside host, and fonts are self-hosted. On a pool with an association set, the client downloads the whole approved set and builds proofs locally, so the ASP doesn't learn which note is about to be spent. The ASP does see whatever its own approval process asks for. Anon-RPC isn't integrated, as its docs list no devnet support.
- **S:** Keys stay on your device and derive from a wallet signature held in memory. The test wallet keeps a throwaway key in browser storage, so it's for devnets only. Trust assumptions: the circuits, the validator (neither audited), and a Groth16 setup that is **devnet-grade**, since anyone with its one local contribution could forge proofs.

## Threat model
**Protects against:** an observer linking your deposit to your payment through gas funding; a relayer seeing or refusing you (there isn't one); someone spending a note they don't own; someone changing a payment's recipient or fee; one note taking other depositors' money.

**Doesn't protect against:**
- The node you submit to, which sees your IP.
- Timing and amount analysis. The meter estimates this but can't remove it.
- A small pool. With few deposits, you're easy to pick out.
- A note owner griefing the pool's reputation. This is bounded, not solved.
- Whoever holds the setup's toxic waste.

**What an association set provider can and can't do:**
- **Can:** decide who is approved, so it can withhold approval or approve too much, and see whatever its own approval process collects.
- **Can't:** approve a label without its root on the chain, forge membership, change the pool's source, touch anyone's money, or block the public exit.

## Limitations
- **The alt mempool path runs on a patched local sidecar.** The public gateway needs per-entity budgets and precompiles allowed. The same transaction simulates successfully against the public chain, and its gateway refuses it. The `hegota-8141` profile doesn't need the alt mempool, because chain 8141's public mempool admits 500,000 verify gas.
- **Testnets only.** These EIPs aren't on mainnet. Neither profile follows today's EIP texts exactly: see [Spec profiles](#spec-profiles).
- **The validation budget is above EIP-8141's 100,000** on every profile: about 308,000 declared and 239,000 used on `hegota-8141`. It needs a node that admits more, as chain 8141 does. Compressing the public inputs, planned next, saves about 25,000.
- **Not audited.** Groth16 isn't post-quantum. Trusted setup is devnet-grade.
- **On the alt mempool path, withdrawals need the pool to be staked** under the ERC draft's budgets, and the stake can't be withdrawn.
- **A banned pool blocks everyone at that node**, including public exits, until `seen` decays or you use another node.
- **One association set provider per pool.** The source is fixed at deployment. A pool taking several providers would need a contract and validator change. Anon-RPC isn't integrated.
- Proving hasn't been timed on a phone.
- **The demo's crowd is seed data,** and its wallet is approved by the allowlist ASP's operator. See [Demo mode](#run-it).

## Options
**Fee-bump limit, off by default.** Build the validator with `RELAYLESS_FEE_RANGE=<min wei>:<max wei>` to reject max fees outside a fixed range, which caps fee bumps per note. It limits griefing on a node that still counts replacements, but withdrawals stall when the base fee passes the ceiling. See the [analysis](docs/reputation-analysis.md#the-optional-fee-bump-limit).

## Gas
A withdrawal to a fresh wallet costs about 900,000–950,000 gas on `devnet-8421`, of which about **253,000** is verification. On `hegota-8141` it's about 980,000–1,030,000, of which **238,962** is verification: 5,579 for the recent-root frame and 233,383 for the pool's. The rest of the difference is the nullifier slot's state gas. Proving takes about 2 s on a laptop. Full figures: [docs/gas-report.md](docs/gas-report.md).

## Prior work
- [EIP-8141 and minimum required validation budget for privacy applications](https://ethresear.ch/t/eip-8141-and-minimum-required-validation-budget-for-privacy-applications/25889) (mmjahanara): the gas floor and optimizations.
- [Ephemeral rollup: the new L1.5 of Ethereum](https://ethresear.ch/t/ephemeral-rollup-the-new-l1-5-of-ethereum/26187) (namnc): the prior working frame layout for privacy pool redemption.
- [Frame transactions and the three gates to privacy](https://ethresear.ch/t/frame-transactions-and-the-three-gates-to-privacy/24666) (nero_eth): mempool rules for privacy transactions.
- [Privacy Pools](https://github.com/0xbow-io/privacy-pools-core) (0xbow): circuits, association sets and ragequit, adapted with attribution.
- [minimal-shielded-pool](https://github.com/soispoke/minimal-shielded-pool) (soispoke): the reference shielded pool on frame transactions, with the same core design (pool as sender, nullifiers as EIP-8250 keys, EIP-8272 roots, a Yul validator, settlement that can't fail after approval) and the current-spec profile.
- [A privacy pool on frame transactions: what works, and the case that does not yet](https://ethresear.ch/t/a-privacy-pool-on-frame-transactions-what-works-and-the-case-that-does-not-yet/26223) (Nethermind): measured costs and budgets on Nethermind.
- [MATCHA](https://ethresear.ch/t/mempool-account-transaction-capacity-from-historical-activity-matcha/25949) (soispoke, Vitalik, Toni): a public-mempool policy for shared senders.
- [Alt mempool workshop and sidecar](https://github.com/forshtat/mempool-workshop) (forshtat), and direct feedback from the alt mempool authors.

## Before vs during the hackathon
All of this repository's code is in its git history, from the first commit, `aa797f7`, dated 2026-11-05 22:54 IST. Run `git log --date=iso` to see every step. `docs/research-notes.md` records the Phase 0 spikes of 2026-11-05, which were throwaway and kept outside this repo, so none of their code is here.

| Dates in `git log` | What was committed |
|---|---|
| 2026-11-05 (11 commits, `aa797f7` to `f118a8c`) | Monorepo, circuits, pool and validator, SDK, local stack, e2e and CLI |
| 2026-11-06 to 2026-11-07 | Web app, association set and World ID, ENSv2, Nym, findings, demo aids and docs. This is the tag `v1.0-ethglobal-mumbai` |
| 2026-11-16 onward, branch `refocus` | Stage 2: World ID, ENS and Nym removed from the core, the association set made provider-agnostic, and the port to the current specs |

Third-party work is listed under [Prior work](#prior-work) and [NOTICE.md](NOTICE.md).

## AI usage
Claude Code was used for implementation, testing and documentation, under the author's direction. The ideas, steps and detailed specifications came from the author, who also designed, reviewed and validated the work.

## Docs
[Landscape](docs/landscape.md), [spec port](docs/spec-port.md), [testnet run](docs/testnet-run.md), [association sets](docs/association-sets.md), [code tour](docs/code-tour.md), [reputation analysis](docs/reputation-analysis.md), [gateway repro](docs/repro-gateway.md), [upstream fix](docs/upstream-pr.md), [gas report](docs/gas-report.md), [research notes](docs/research-notes.md), [demo script](docs/demo-script.md), [decisions](DECISIONS.md), [progress](PROGRESS.md).
