# Shared-sender harness

Attacks a mempool the way a user of a shared sender can, with Relayless as the shared sender: every withdrawal is the pool's own frame transaction on its own EIP-8250 nonce key, so every user's actions land on the same sender's reputation or width. Results and their interpretation: [RESULTS.md](RESULTS.md).

**Local chains only.** Every target refuses to run unless its RPC is on localhost. Never point this at a public network.

## One command per target
| Target | Command | Needs |
|---|---|---|
| ERC-8421 sidecar, without the replacement fix | `research/shared-sender/run-sidecar.sh nofix` | The devnet: `scripts/local-stack.sh` |
| ERC-8421 sidecar, with the fix | `research/shared-sender/run-sidecar.sh fix` | The devnet |
| ethrex `64b8fc09` (chain 8141's revision, no width budget) | `research/shared-sender/run-ethrex.sh 64b8fc09` | Builds the chain itself (`scripts/local-stack-hegota.sh`) |
| ethrex `247e2dd2` (MATCHA) | `research/shared-sender/run-ethrex.sh 247e2dd2` | Builds ethrex `247e2dd2` with `patches/ethrex-dev-hegota-247e2dd2.patch` the first time (about 15 minutes) |

Each run writes `results/<target>.json`. `node research/shared-sender/static-check.mjs` writes `results/static-check.json`: which state-reading opcodes the pool's validator can reach.

## What each run does
On a fresh funded wallet, 52 deposits of 0.05 ETH, then:

| Step | What |
|---|---|
| Fresh pool (MATCHA only) | Three withdrawals at once from a pool that has never had a transaction finalize |
| Bootstrap (MATCHA only) | Three withdrawals in a row, reading width at landing and after finality |
| Honest throughput, before | Six honest withdrawals sent at once: how many are admitted, how fast they land, and how long refused ones take to get in |
| 1. Conflicts across nodes | The same note withdrawn twice, to different recipients, one version to each node (sidecar: A mines, B never does). On a single ethrex node, the second version at the same fee |
| 2. Replacement spam | One note, ten fee bumps of 15%, sent in a burst to one node. On MATCHA a baseline goes first, so the bumped one is an additional transaction |
| 3. Width draining | First, whether a withdrawal priced below the base fee can sit pending. Then ten withdrawals at the cheapest includable price, an honest one right after, and 30 blocks of watching |
| 3b. Replacement draining | A pending baseline, then four notes each bumped five times in one burst, then an honest withdrawal, retried every block until it gets in |
| 4. Mass invalidation | Six prepared withdrawals, re-simulated after a deposit, after another withdrawal lands, and after 20 blocks. On the sidecar they're also parked on node B and its revalidation is watched |
| Honest throughput, after | The same as before, after everything above |

## Setup notes
- **Sidecar targets:** upstream `forshtat/mempool-workshop-sidecar` at `2e22ff0a` with the patches in `sidecar-patches/` (the same changes as the upstream PR drafts in `docs/drafts/`). Two instances, no gossip between them, fresh data directories each run, no `precompiles` in the config. Both variants need the per-entity budgets patch, or the pool's withdrawals (about 228,000 gas of validation) aren't admitted at all.
- **ethrex targets run in dev mode.** One node, so there's no cross-node case on them. Blocks are produced about every second and are never full, so a transaction at an includable price lands in the next block.
- **Finality on the MATCHA chain.** MATCHA credits width only at finality, and ethrex's dev mode finalizes every block at once. The `247e2dd2` patch adds `ETHREX_DEV_FINALITY_LAG`, so finality trails the head by 64 blocks by default, about two epochs as on a real chain. It touches only the dev block producer.
- **Below-base-fee pricing:** the SDK can't price a transaction the node won't simulate, so for that probe only, the harness over-estimates `maxCost` itself.
