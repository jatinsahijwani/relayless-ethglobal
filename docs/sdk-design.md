# Design: a viem extension for frame transactions

**Status: design only, for the author's approval.** Nothing here is implemented yet. It describes extracting what Relayless's SDK already does for EIP-8141 frame transactions into a standalone package any team can use, whether they build a privacy pool, a paymaster or a smart account.

## Why
Every team building on frame transactions today writes the same plumbing: an RLP codec per spec revision, keyed nonces, recent-root frames, the fee and `maxCost` arithmetic, and "will the mempool take this?" before broadcasting. That plumbing changes with each EIP revision, and getting it wrong costs reputation on an ERC-8421 mempool and width on a MATCHA one. Relayless has working, tested versions of all of it for two revisions (`devnet-8421`, `hegota-8141`), used on chain 8141. Moving it into a library others can depend on is the cheapest way to make it reusable, and the clearest test of whether our abstractions are right.

**Non-goals:** proving systems, note management, association sets, wallets' key storage. Those stay in Relayless.

## What exists today, and where
| Piece | In Relayless now | Reusable as is? |
|---|---|---|
| Spec profiles | `packages/sdk/src/profiles.ts`: addresses, nonce form, root carrier, submit route, codec, simulate params, per-profile gas constants | Mostly. Mixes in pool-specific constants (`verifyState`) |
| `hegota-8141` codec | `codec-hegota.ts`, own RLP via viem's `toRlp`, pinned to ethrex's golden vector | Yes |
| `devnet-8421` codec | `@forshtat/hegota-support` (the workshop's tracer profile) | Yes, as a dependency |
| Frame building | `frame.ts`: `frame()`, `assemble()`, `rootFrame()`, `encodeRootTuples`, `refsOf` | The generic parts, yes. `buildWithdrawal` and `buildRagequit` are Relayless's |
| Keyed nonces | `crypto.ts: nonceSlot`, `recent-root.ts`, the nonce-manager reads in `client.ts` | Yes |
| Admission simulation | `client.ts: simulate()`, `preflight()`, `compareMempools()` | Logic yes, but tied to the client class |
| Fee bumps | `client.ts: bumpFee()`, re-proving through `prepare()` | The pattern, not the code |

## Package layout
One package, `viem-frames` (working name), with subpath exports so an app pulls in only what it uses:

```
viem-frames/
  profiles/      ProfileId, Profile, defineProfile(); built-ins: devnet-8421, hegota-8141 (later eips-current)
  codec/         per-profile encode / decode / sigHash / txHash; golden-vector tests per profile
  frames/        frame(), verifyFrame(), senderFrame(), defaultFrame(), recentRootFrame(), assemble()
  nonces/        keyed nonce helpers: nonceSlot(), currentSeq(), isConsumed(), pickFreshKey()
  admission/     simulateAdmission(): one result type across clients; adapters per client
  fees/          maxCost(), feeCaps(), bump() with the 10% replacement rule
  actions/       viem client extension: client.extend(frameActions(profile))
  test/          golden vectors, a local-chain conformance suite
```

**Dependencies:** `viem` as a peer dependency, nothing else at runtime. `@forshtat/hegota-support` only for the `devnet-8421` codec, behind its subpath, so an app on `hegota-8141` never loads it.

## Type-safe API
The profile is a type parameter, so a transaction built for one revision can't be encoded or sent with another's codec:

```ts
import { createPublicClient, http } from "viem";
import { frameActions, profiles } from "viem-frames";

const client = createPublicClient({ transport: http(rpc) }).extend(frameActions(profiles.hegota8141));

const tx = client.buildFrameTransaction({
  sender: pool,
  nonce: { keys: [nullifierHash], seq: 0n },                 // EIP-8250
  recentRoots: [{ sourceId, slot, root }],                    // EIP-8272: a frame or an envelope field, per profile
  frames: [
    verifyFrame({ target: null, scope: "executionAndPayment", gas: 260_000n, stateGas: 97_920n }),
    senderFrame({ target: pool, data, gas: 1_500_000n, stateGas: 1_000_000n }),
    defaultFrame({ target: pool, data: refundCall, gas: 150_000n }),
  ],
  fees: await client.frameFeeCaps(),
});                                                           // FrameTransaction<"hegota-8141">

const sigHash = client.frameSigHash(tx);                       // what a proof or signature commits to
const signed = withSignatures(tx, [arbitrary(proofBytes)]);
const verdict = await client.simulateFrameAdmission(signed);   // AdmissionResult, see below
if (verdict.admitted) await client.sendFrameTransaction(signed);
```

Design choices:
- **`FrameTransaction<P extends ProfileId>`** carries its profile in the type. `assemble()` places the recent-root frame first, or the envelope field, as the profile says; callers never index frames by hand. `verifyIndex(tx)` and `senderIndex(tx)` give the indices a validator will see.
- **Gas limits are explicit.** No defaults for a VERIFY frame's limit, because it's counted against a node's verify budget, and the right number is the app's. The library reports the declared validation total (`declaredVerifyGas(tx)`) so an app can check it against the budgets it targets.
- **Signatures are attached after `sigHash`,** with the elision rule for empty-`msg` entries applied by the codec. `arbitrary(bytes)`, `secp256k1(...)`, `p256(...)` constructors validate the signer rules (an ARBITRARY signature has an empty signer).
- **No hidden network calls in builders.** `buildFrameTransaction` is pure. Anything that reads the chain (`frameFeeCaps`, `currentSeq`, `simulateFrameAdmission`) is an action.

## Admission simulation across clients
One result type, whatever the node:

```ts
type AdmissionResult = {
  admitted: boolean;
  source: "ethrex-simulate" | "sidecar-estimate" | "fallback";
  reason?: string;                       // the node's own words when refused
  maxCost?: bigint;                      // what the node will hold at APPROVE
  frames?: { gasUsed: bigint; stateGasUsed?: bigint; succeeded: boolean }[];
  validationGasUsed?: bigint;
  matcha?: { charge: bigint; admissible: boolean; refusal?: string };   // ethrex with MATCHA
  reputation?: { seen: number; included: number; status: string };      // ERC-8421 sidecar
  confidence: "authoritative" | "partial";
};
```

| Client | Route | What it can tell | Confidence |
|---|---|---|---|
| ethrex (`64b8fc09`, `247e2dd2`) | `ethrex_simulateFrameTransaction` (2 params on `hegota-8141`, 3 on the devnet). `valid` and `violation` are the node's admission verdict; `matchaCharge`/`matchaAdmissible`/`matchaRefusal` where MATCHA runs; plus `ethrex_matchaWidth` for scheduling | Everything | authoritative, for that node, at that moment |
| ERC-8421 sidecar | `eth_estimateFrameTransactionGas` (needs the placeholder limits, see below), plus `skandha_explorer_listReputation` for the sender's standing | Validation result, budget, the sender's reputation | authoritative for validation; reputation advisory |
| Nethermind, `eips-current` | **Open question.** Candidates: `eth_simulateV1` if it accepts type-0x06; `debug_traceCall` per frame; otherwise a local check (`maxCost ≤ max_fee` is a formula on this profile, frame limits against the node's `--mempool.max-verify-gas`, the nonce key's current sequence, the recent root's slot window) | Static checks, nonce, root window; not the validation result | partial, and the result says so |

**The sidecar's estimate rewrites limits.** `eth_estimateFrameTransactionGas` replaces every frame after the validation prefix with a 10,000,000 placeholder, and those limits are inside `sigHash`. Anything that commits to `sigHash` (a proof, a signature) must be produced for the placeholder limits for the dry run. The library exposes this as `estimateTransaction(tx)`, which returns the rewritten transaction, so the app can produce a dry-run proof for exactly those bytes. Relayless does this today in `compareMempools`.

**The rule the library enforces by default:** `sendFrameTransaction` refuses to broadcast when the last `simulateFrameAdmission` for those exact bytes said `admitted: false`, unless the caller passes `{ force: true }`. On an ERC-8421 mempool a refused-then-sent transaction can cost a shared sender reputation; on MATCHA it costs width.

## Fee bumps that re-prove
A replacement must raise both fee caps by at least 10% (ERC-8421 LIFECYCLE-020; ethrex's `Attempted to replace a pooled transaction with an underpriced transaction` otherwise). The fees are inside `sigHash`, so anything committing to it must be redone. The library owns the arithmetic and the rebuild, and calls back for the commitment:

```ts
const next = await client.bumpFrameTransaction(pending, {
  recommit: async (unsigned, sigHash) => withSignatures(unsigned, [arbitrary(await prove(sigHash))]),
  minPercent: 10,
});
```

- Raises `maxFeePerGas` and `maxPriorityFeePerGas` by `max(minPercent, what the market needs)`, with the same rounding the nodes use.
- Keeps nonce keys and sequence, so the replacement conflicts with exactly the pending one.
- Simulates the replacement before sending it, like any other transaction.
- **Says what it costs,** so the app can decide: on MATCHA, replacing an additional pending transaction spends another charge, which is never returned (`matcha.charge`); on an unfixed ERC-8421 sidecar, each replacement is a new `seen` (see `research/shared-sender/RESULTS.md`).

## How Relayless would consume it
Relayless keeps everything that's about the pool and drops the plumbing:

| Relayless today | After |
|---|---|
| `profiles.ts`, `codec-hegota.ts` | `viem-frames/profiles` and `/codec`. Relayless adds only its pool constants (the VERIFY state gas, its limits) in its own table |
| `frame.ts: frame, assemble, rootFrame, encodeRootTuples, refsOf, verifyIndex, sigHashOf, txHashOf, rawOf` | `viem-frames/frames` and `/codec` |
| `buildWithdrawal`, `buildRagequit`, `encodeWithdrawProof`, compression | Stay in Relayless, built on `buildFrameTransaction` |
| `client.ts: simulate, preflight, compareMempools` | `simulateFrameAdmission` and `estimateTransaction`. Relayless keeps its own checks on top (solvency, the k-gate, the pool's roots) |
| `client.ts: bumpFee` | `bumpFrameTransaction` with a `recommit` that re-proves |
| `crypto.ts: nonceSlot`, the nonce-manager reads | `viem-frames/nonces` |

The test for the extraction: Relayless's e2e suites (34 checks on `devnet-8421`, 32 on `hegota-8141`) and the five-step chain 8141 run pass unchanged on top of the library, and the bytes Relayless sends are identical (the existing byte-equality test in `packages/sdk/test/profiles.test.ts` carries over).

## First release (0.1)
- Profiles `devnet-8421` and `hegota-8141`, with golden-vector tests against ethrex.
- Codec, frame builders, `assemble`, keyed-nonce helpers, `maxCost` and fee caps.
- `simulateFrameAdmission` for ethrex (including the MATCHA fields) and the ERC-8421 sidecar. The Nethermind path is listed as not supported yet, and returns `confidence: "partial"` from the local checks only.
- `bumpFrameTransaction` with `recommit`.
- A conformance script that runs the builders against a local ethrex chain (reusing `scripts/local-stack-hegota.sh`).
- Docs: one page per profile, saying which EIP commits it follows and where the chain runs.

**Not in 0.1:** `eips-current`, Nethermind's admission, a wallet-side signing flow for owner-set or hardware signers, and the paymaster patterns.

## Open questions
1. **Name and home.** A standalone package in its own repository, or a workspace package in Relayless first? Own repo makes it clearly reusable; workspace first is faster to iterate.
2. **Who maintains the profiles.** Each EIP revision means a new profile. Offer them upstream to `@forshtat/hegota-support`, or keep them here?
3. **Nethermind's admission path.** Which RPC Nethermind master offers for frame-transaction simulation needs checking against a running node before 0.2. If none, is a local check honest enough to ship, given that it can't see the validation result?
4. **MATCHA's scheduling API.** Expose `ethrex_matchaWidth` as a scheduler ("send now / wait n blocks") or only as raw data? A scheduler is more useful, but its advice is node-local and goes stale.
5. **Reputation reads.** `skandha_explorer_*` is an explorer API, not a stable mempool interface. Read it at all, or only report it when present?
6. **Default refusal to send.** Is "refuse to broadcast after a failed simulation unless forced" the right default for a general library, or too opinionated?
7. **License.** Relayless is GPL-3.0 because of circomlib. The library has no circuit code, so it could be MIT, which matters for adoption. Does the author want that?
