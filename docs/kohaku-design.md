# Design: a frame-transaction unshield for Kohaku

*Written 2026-11-22. Kohaku studied at `ethereum/kohaku` master `b6a67fa` (2026-11-21). The prototype is a local branch, `relayless-frame-unshield`, in `~/Desktop/kohaku-fork`: 5 commits, not pushed, nothing opened upstream.*

**In one paragraph:** Kohaku's Privacy Pools plugin unshields through a relayer or an ERC-4337 paymaster. With EIP-8141 the pool itself can be the transaction's sender and pay gas from the note being withdrawn, so a fresh address with 0 ETH receives the withdrawal with no relayer, paymaster or bundler. That fits Kohaku's plugin interface without changing it: `prepareUnshield` returns a proved frame transaction that the node has already simulated, and a `Broadcaster` sends it through `host.network`. A working prototype withdraws from a Relayless pool on a local `hegota-8141` chain. Upstreaming it is blocked mainly by licensing and by which chains run the EIPs, not by the interface.

## What Kohaku has today
| Piece | What it is at `b6a67fa` |
|---|---|
| Plugin interface (`packages/plugins/src/base.ts`) | `PluginInstance`: `instanceId`, `balance`, optional `notes`, and the enabled `prepare*` features. `CreatePluginFn(host, params)` |
| Broadcasting (`src/broadcaster/base.ts`) | A separate `Broadcaster<Op, Result>` with `broadcast(operation)`. **The plugins README still shows `broadcastPrivateOperation` on the instance, but the code no longer has it.** Privacy Pools' `PrivacyPoolsBroadcaster` implements `Broadcaster` |
| `Host` (`src/host/index.ts`, `docs/pages/host.mdx`) | `network.fetch` for everything that isn't a JSON-RPC call to the user's node (relayers, the ASP, IPFS, the bundler); async branded `storage`; `keystore.deriveAt`, wrapped per plugin by `scopeKeystore`; `provider` for chain reads (plugins don't send through it); optional `externalSyncProvider` |
| Privacy Pools' paymaster unshield (`packages/privacy-pools/src/paymaster/`) | An ephemeral EOA, derived per (deposit, withdrawal) or from a wallet `delegation.path`, signs an EIP-7702 authorization and an ERC-4337 userOp. A bundler, reached through `network`, submits it; a paymaster pays the gas, takes a fee from the withdrawal and refunds the overcharge in `postOp`. Gas is estimated with dummy proofs against a verifier override, so real proofs leave the SDK only at broadcast. Native assets aren't supported in this version |
| Keys | Privacy Pools below `m/28784'/1'` ("pp"), Tornado Cash below `m/29795'/1'` ("tc"), plus the exact `delegation.path` of an unshield in progress |
| Conventions | **There is no CONTRIBUTING file** (checked at `b6a67fa`). From the code: pnpm 10 workspace, vitest with a `unit` project and one e2e project per chain, `tests/unit`, `tests/e2e`, `tests/utils/mock-host.ts`; ESLint with a 200-line file limit, descriptive identifiers and statement padding; strict TypeScript including `noUncheckedIndexedAccess`; tsup builds; changesets |

## How a frame-transaction unshield fits the interface
| Kohaku | Frame-transaction unshield |
|---|---|
| `prepareShield(asset, to?)` | A public operation: `{ txns: [deposit(precommitment)] }` for the wallet's own signer, like Privacy Pools |
| `prepareUnshield(asset, to)` | Picks a note, builds the frame transaction (frame-tx-sdk), proves it with the fee and recipient bound in through the sigHash (Relayless), and asks the node to simulate it. **It only returns a withdrawal the node would admit.** The operation carries the signed transaction, its hash, the fee and the admission verdict |
| `Broadcaster.broadcast(op)` | Re-simulates if the verdict is older than 12 s, sends through `host.network.fetch`, and records the note as in flight in `host.storage`. Refuses without a verified admission, and never sends a second transaction for a pending note |
| `balance`, `notes` | Relayless's recovery: every note and change note comes from the chain and one signature |

Nothing in `@kohaku-eth/plugins` had to change.

## What changes compared with the paymaster path
| | Paymaster unshield (Privacy Pools today) | Pool as sender (frame transaction) |
|---|---|---|
| Who sends | An ephemeral EOA with an EIP-7702 delegation, as a userOp through a bundler | The pool contract itself, as a type-0x06 transaction |
| Who pays gas | The paymaster, repaid from the withdrawal's fee; the overcharge refunded in `postOp` | The pool, from the note, at APPROVE. A refund frame returns the unused part to the recipient |
| Extra keys | An ephemeral signer per (deposit, withdrawal), or a wallet `delegation.path` | None. The proof is the authorization (an ARBITRARY signature bound to the sigHash) |
| Infrastructure | Bundler, paymaster contract, EntryPoint | A node that admits about 268,100 gas of validation (`hegota-8141`: chain 8141 admits 500,000; Nethermind's default is 300,000), or an ERC-8421 alt mempool with the pool staked (`devnet-8421`) |
| Double spends | The pool's nullifier storage | The nullifier is an EIP-8250 nonce key: a second spend is an invalid transaction, refused at admission |
| Simulation | Bundler estimation with dummy proofs and a verifier override | The node simulates the real signed bytes. The fee is inside the proof, so maxCost comes from simulating an unproved copy first |
| What a failure costs | A bundler rejection | The pool is one sender for everyone. A transaction admitted but never mined costs it reputation on an ERC-8421 mempool, or width on MATCHA. Hence the broadcaster's guards |
| Assets | ERC-20 (native not supported in v1) | Native ETH (Relayless) |
| Chains | Mainnet, Sepolia | Chain 8141 and local chains; mainnet only after Hegotá |
| `tailCalls` | Supported | Not supported: the validator pins the SENDER frame. A layout with calls after settlement is possible, but it's a validator change |

## Key derivation under the plugin's own subtree
- **Purpose `m/29292'`** ("rl", `0x72 0x6c`), by the same rule as `28784'` and `29795'`. The plugin wraps `host.keystore` with `scopeKeystore({ prefixes: ["m/29292'/1'"] })` and derives nothing else.
- **`m/29292'/1'/{account}'` is the only key.** It signs one EIP-712 message bound to the pool and the chain. Relayless's note secrets and change-note secrets derive from that signature, so a wiped `storage` is rebuilt from the mnemonic and the chain.
- **No ephemeral signer and no `delegation.path`**, because nothing but the pool sends.
- **Hardware wallets:** the identity only signs that one typed message, so an `EnvelopeSigner`-style hook (as Privacy Pools has) would let it stay on a device. Not built.

## Admission simulation and reputation-safe broadcasting with `Host.network`
- **Reads and simulation go through `host.provider`,** because they're JSON-RPC calls to the node the user picked (`ethrex_simulateFrameTransaction`, nonce and root reads). Kohaku's viem adapter passes custom methods through.
- **Sending goes through `host.network.fetch`,** to a configured mempool URL, the way Privacy Pools reaches its bundler. A wallet can route that request over Tor or a proxy. On `hegota-8141` the URL is a node's public mempool; on `devnet-8421` it's the ERC-8421 sidecar.
- **The trade-off:** simulating through `provider` shows the transaction to the user's own node before it's broadcast. A wallet that doesn't want its RPC node to see that would have to simulate through `network` too. This is an open question below.
- **The guards, in order:**
  1. `prepareUnshield` returns only an operation the node admitted.
  2. The broadcaster re-simulates an admission older than 12 s.
  3. frame-tx-sdk's `sendFrameTransaction` refuses a failed or unverified admission, or one for different bytes.
  4. The broadcaster refuses a note already in flight (kept in `host.storage`).
  5. Nothing is retried.

  Where the node runs MATCHA, a width refusal makes the admission fail, so the operation is never returned.

## The prototype
`packages/relayless` in the fork (`@kohaku-eth/relayless`, private, version `0.0.1-prototype.0`):

| File | What |
|---|---|
| `src/keys.ts` | The purpose, the identity path, and the identity as a Relayless signer that never sends |
| `src/network.ts` | frame-tx-sdk clients over `host.provider` (reads) and `host.network.fetch` (sending) |
| `src/plugin.ts` | `createRelaylessPlugin`: `instanceId`, `balance`, `notes`, `prepareShield`, `prepareUnshield` |
| `src/broadcaster.ts` | `RelaylessBroadcaster implements Broadcaster` |
| `src/inflight.ts` | Notes with a withdrawal pending, in `host.storage` |
| `tests/unit/` | 9 tests: keys stay in their subtree, are stable, and never send; the broadcaster sends once through `network`, refuses unadmitted, unverified and in-flight operations without touching the network, and re-simulates stale ones through `provider` |
| `tests/e2e/withdraw-local-hegota.test.ts` | A real shield and unshield through the plugin interface on Relayless's local `hegota-8141` chain |

**Measured on the local `hegota-8141` chain (ethrex `64b8fc09`), 2026-11-22.** Two runs, each shielding 0.05 ETH and unshielding 0.02 ETH to a fresh address that started at 0 ETH:

| Run | Gas | Recipient received | Proving |
|---|---|---|---|
| 1 | 973,582 | 0.019998908637360515 ETH | 1,776 ms |
| 2 | 993,581 | 0.019998888650220606 ETH | 1,816 ms |

The admission was the node's own (`ethrex-simulate`), with 268,100 gas of validation declared. The change note (0.03 ETH) was recovered from the seed. Replaying the same operation was refused before broadcast. Both gas figures are inside the `hegota-8141` range in [`gas-report.md`](gas-report.md) (about 915,000 to 1,005,000; the total moves with the tree's depth).

```sh
cd ~/Desktop/kohaku-fork/packages/relayless
pnpm test                    # 9 unit
pnpm test:e2e:local-hegota   # needs scripts/local-stack-hegota.sh running in relayless-ethglobal
```

ESLint passes with the repo's config.

## What upstreaming would need
1. **A license path.** Relayless's client is GPL-3.0, because its circuits compile circomlib (GPL-3.0), and Kohaku is MIT. Either the client side is relicensed or rewritten under MIT, and the circuit artifacts are handled the way `@fatsolutions/privacy-pools-core-circuits` is, or the plugin stays outside Kohaku. This is the first thing to settle.
2. **Published dependencies.** frame-tx-sdk on npm (MIT, local today), and a built Relayless client with `.d.ts` files. The prototype links both from local checkouts, and relaxes `noUncheckedIndexedAccess` only because the client is linked as TypeScript source.
3. **The host's transport everywhere.** Relayless's client reads the pool through its own `fetch` to `rpcUrl`. It should take `host.provider`, and its event sync could use `externalSyncProvider`.
4. **Chains.** None of the chains Kohaku configures runs EIP-8141, EIP-8250 and EIP-8272. The plugin needs a chain config entry, gated so it can't be selected on mainnet or Sepolia, with chain 8141 as the first.
5. **Assurance.** Relayless's trusted setup is devnet-grade, and nothing is audited. Kohaku has just completed an audit (`b6a67fa`), and a new plugin would need one too.
6. **Conventions.** A tsup build, a changeset, a `docs/pages/relayless` page, and e2e projects per chain alongside `unit`. Storage values encrypted by the host as the docs ask, with keys under a `relayless-` prefix (done).
7. **The prover.** Relayless's Node prover (snarkjs over files) works in tests; a browser host needs a worker, like Tornado's.
8. **Association sets.** Relayless's `AssociationSetProvider` could take Kohaku's ASP services (IPFS and 0xbow) as providers. Not built.

## Open questions for the Kohaku team
1. **Where should this live?** A separate plugin for pool-as-sender protocols, or a frame-transaction unshield mode inside Privacy Pools once a 0xbow pool can run on frames? The second would need contract changes on their side.
2. **Is a `Broadcaster` the right home** for frame-transaction sending, or should the host offer a "send this raw transaction" capability that several plugins share, with the admission guard in one place?
3. **Should simulation go through `provider` or `network`?** `provider` matches the host contract, but it shows the withdrawal to the user's node before broadcast.
4. **Is purpose `29292'` acceptable,** and is there a list of purposes the bundled plugins reserve?
5. **Operations carry a signed transaction and bigints.** Do hosts persist operations, or pass them across a worker boundary, so they'd need a serialized form?
6. **Does `tailCalls` matter** for a native-ETH unshield to a fresh address? If it does, it's a validator layout change.
7. **The license question in item 1 of the upstreaming list:** is there a precedent in Kohaku for GPL circuit artifacts?
