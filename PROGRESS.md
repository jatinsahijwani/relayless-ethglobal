# Progress: final status

Last checked 2026-11-06, on the running stack: ethrex `9aa3645d` plus sidecar with `patches/sidecar-budget-010.patch` and a `precompiles` config. The alt mempool authors confirmed a local sidecar is fine for judging.

## What works
| What | Evidence |
|---|---|
| Withdrawal to a 0-ETH wallet: no relayer, pool pays gas from the note | `scripts/e2e.ts`, browser run below, [gas report](docs/gas-report.md) |
| Canonical mempool rejects it, patched alt mempool admits it | **Compare mempools** panel, on live nodes. `scripts/e2e.ts` |
| One sender, many users: 3 pending at once, each with its own nonce key | **Live mempool** panel. `scripts/e2e.ts` |
| Recovery from one signature, any-amount payments, change notes | `scripts/e2e.ts` |
| Anonymity meter, and a k-gate in the circuit | Circuit tests, `scripts/e2e.ts` |
| SENDER frame can't revert after APPROVE | Foundry fuzz and adversarial tests, `scripts/e2e.ts` |
| Association set and public exit | `scripts/e2e-asp.ts` |
| World ID, on **staging** with the simulator | [Below](#world-id-against-the-real-staging-service) |
| ENSv2 directory and private names, on Sepolia | [Live page](https://relayless-ens.vercel.app), `scripts/e2e-ens.ts`, [addresses](README.md#on-sepolia) |
| Nym route for ENS reads, off by default | [Below](#nym-mixnet), [notes](docs/nym-notes.md) |
| Findings, each reproducible | [Repro](docs/repro-gateway.md), [upstream write-up](docs/upstream-pr.md), [analysis](docs/reputation-analysis.md) |

## Test results
Every suite was run on 2026-11-06, after the demo aids were added.

| Suite | Result |
|---|---|
| Circuits | 13/13 |
| Contracts (Foundry, including fuzz) | 26/26 |
| SDK | 43/43 |
| ASP server | 26/26 |
| ENS (Foundry, on forked Sepolia with the deployed contracts) | 16/16 |
| `scripts/e2e.ts`, on the running stack | 34/34 |
| `scripts/e2e-asp.ts` | 7/7 |
| `scripts/e2e-world.ts` (World's verdict faked) | 7/7 |
| `scripts/e2e-ens.ts`, real Sepolia plus the live devnet | 48/48 |
| Sidecar: mempool, validation and `eth` suites only | 213/213, **from an earlier run, not repeated** |

**Fresh clone, in a temporary folder, with the running stack left alone:** install, circuits 13, contracts 26, SDK 43, ASP 26, ENS 16, web typecheck and the ENS page build all passed. The ENS suite failed once on an RPC error (`block not found`) and passed on rerun.

**`scripts/local-stack.sh` from that clone was skipped this time.** It needs ports 18545 and 14337 and the same Docker project as the running stack, and the chain mustn't be restarted, so it stopped at its port check, as designed. Its last full run from a fresh clone passed in about 13 minutes, before the ENS, Nym and demo work. Those added no steps to it.

With the optional fee-bump limit on, `scripts/e2e.ts` last passed 30/30, on an earlier run with fewer checks.

## Browser runs
| Run | Result |
|---|---|
| Whole demo path at 1280×720 and 390px: 0 ETH to 0.05 ETH, proving counter, compare panel, 3 pending at once, meter | Worked. No console errors, no horizontal overflow, only the local app contacted, no key rendered |
| Landing and `/findings` at both widths | Worked, no console errors, no overflow |
| Live link, 390px, Nym off: directory, `alice.relayless.eth`, derive twice | Directory in 6 s, lookup in 1 s. Console shows the public RPC's 429s, which retry |
| Live link, 390px, Nym on: same steps | Directory in 59 s, lookup in 2 s. No browser request to a Sepolia RPC, no console errors |
| `/findings` on a Vercel preview of the new build | Worked. **The live link needs a redeploy to have it** |

These are headless Chromium runs on a laptop.

## World ID against the real staging service
Browser, real World proofs through the simulator, on the local chain:

| Path | Result |
|---|---|
| Verified | `POST /join` 200, approved root published, private payment landed |
| Invalid proof | World rejected it: `POST /join` 400, nothing approved, payment stayed refused |
| Same World ID, second wallet | `POST /join` 409, refused |
| Window closed, or cancelled then closed | "You cancelled", public exit offered, retry works |
| Never approved | Private payment refused; public exit returned the money to the depositor |

The app contacted no outside host until Verify was clicked.

## ENSv2
| Check | Result |
|---|---|
| World ID ASP server restarted with a stale record | [Published by itself](https://sepolia.etherscan.io/tx/0x17d50267d237591b0aeefde7df44086601c24440e9b8178454c47c9ec378ea00) |
| Approving a depositor on the second ASP | [Published by itself](https://sepolia.etherscan.io/tx/0x5320d9afd562ba5713c9cfe174d00b290e2637234008596ada4e31e6f34a071a) |

Key transactions: [register `relayless.eth`](https://sepolia.etherscan.io/tx/0xd8da7a14f61c6e90709a638b435cf15547ea8ea26d4db37f1b7a08b10a9aaed4), [register `asp`](https://sepolia.etherscan.io/tx/0x498e39e8242fbd46f10d7f54dc6fd5dad48eb45911c3929387aa2c7f90be0d2e), [register `world`](https://sepolia.etherscan.io/tx/0x831d30c21853fda6c58890526bf6550a69169dc709a2d0b23619389e7016c42c), [operator role and records](https://sepolia.etherscan.io/tx/0x77a66869be169e3c0de0344901a9862d5588e4dc08d898ba2e983fd758ad2db5).

## Nym mixnet
| Check | Result |
|---|---|
| Deployed preview, 6 full runs with Nym on, laptop | 4 worked, 2 ended in the failure message |
| Live link, Nym on, 3 runs across two sessions | All worked, about 53–70 s to the directory |
| Author's own check on the preview, by hand | Reported working in 4 tests, and on a phone. Not timed |
| Nym off | Default; 18 MB chunk not fetched, no Nym hosts contacted |
| Local app with Nym on | Sepolia routed, local chain and approval server direct, verdicts right |

## Griefing, measured
| Experiment | Result |
|---|---|
| 8 fee bumps from one note, before our fix | `seen` 0 → 8, `included` 1 |
| Same, after our fix | `seen` 0 → 1, `included` 1 |
| Same note sent to two nodes, 2 notes, after our fix | Non-mining node: `seen 2, included 0`. **Still open** |

## What's untested
- World ID in production, or with a real World App.
- A real browser wallet: an injected test wallet stood in, on a fork.
- Claiming through the live page on real Sepolia: the e2e script claimed through the same SDK call.
- The World ID ASP publishing after a real World ID approval: a restart and the second ASP's approval use the same publisher.
- The private payment and scan through the browser's ENS screens: the e2e script covers those paths.
- `/join` in the browser since the ENS work: `scripts/e2e.ts` covers the pool, not the World ID screen.
- Proving on a real phone.
- Nym on a slow connection, with a real wallet, with a claim, or over Tor.
- Throttle and ban thresholds, which are calculated, not reached in a run.
- Anon-RPC isn't integrated: its docs list no devnet support.
- ENSIP-26 agent records weren't added.

## Known issues
- **The last parent role isn't revoked.** The deployer still holds the subregistry role on `relayless.eth` and `asp`. Revoking it is permanent, so it waits for the author.
- **ethrex loses block numbers.** On 2 of 2 fresh chains, blocks from about 149 lost their number lookup, about 15 minutes after genesis. Cause unknown. The SDK reads around it and fails loudly if a gap hid pool data. Written up in `docs/upstream-pr.md`.
- **Griefing across nodes is limited, not solved.**
- **The main pool's reputation settles one short:** `seen 31, included 30` after this run, and the same gap of 1 before. **It's unexplained.** The run includes a deliberate fee bump, which may be why.
- **VERIFY gas varies by a few hundred between runs,** and the cause isn't pinned down. See the [gas report](docs/gas-report.md).
- **Unexplained, seen once:** on one chain, large deployments stopped mining while small transactions kept going. A fresh chain past its hole deployed normally. If deploys hang, start a fresh chain.
- A young chain can briefly report a root as not yet referenceable. The SDK retries before broadcasting.
- Same seed on two devices can still race on one note.
- A public Sepolia RPC rate-limits the live page, so the console shows 429s that retry.

## Links
**Public devnet** ([explorer](https://explorer.altmempool.wtf/): search by hash, and its history is in memory, so these can disappear):
- Contract sender with a nonce key and a root reference, block 401126: `0x6f39d1fe8c3828025fe8f21baf3ac012acedc6a2d7b87371eae9f54d62ccef99`
- Keyed nonces, workshop step 12: `0x8fc566abddd6a77a4dc6fd26eb31285c44eabb4d0df4851495fd7108ea0d2acd`
- Recent root reference, workshop step 13: `0x8eb575751505fdc906729eeefbf0657da34a9aad618afaa76d0f3a291cf2377e`

**Withdrawals have no public link.** The public gateway refuses them (`docs/repro-gateway.md`), and our chains are private. A real one from the last run, on a chain you can recreate with `scripts/local-stack.sh`: `0x6971448b24aa413325b20c96c4afed464d5f8d3d6c62b2eb93da280e86182d3f`.
