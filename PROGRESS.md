# Progress

## What works
Local stack: ethrex `9aa3645d` plus sidecar with `patches/sidecar-budget-010.patch` and a `precompiles` config. The alt mempool authors confirmed a local sidecar is fine for judging.

| Phase | Status | Evidence |
|---|---|---|
| 0: prove the path | Done | All 13 workshop steps pass on the public devnet |
| 1: minimal withdrawal | Done locally | Mined from the staked pool to a 0-ETH address. Double spend invalid. Canonical mempool rejects it, patched alt mempool admits it. `docs/gas-report.md` |
| 2: product core | Done | Recovery, partial and split payments, 3+ pending at once, web app in phone-size Chrome |
| 3: anonymity | Done except Anon-RPC | Meter, k-gate in circuit and UI, comparison view |
| 4: polish | Mostly done | README, CROPS, threat model, demo script, license, one-command setup. Demo video and GIF not made |
| 5: compliance | Partly done | Association set, public exit and World ID work locally, verified by World's **staging** service. Production not tested. ENSv2: see below |

## Test results
Last full run: a fresh `git clone`, empty stack directory, `scripts/local-stack.sh`, then every suite on that chain.

| Suite | Result |
|---|---|
| `scripts/local-stack.sh` from a fresh clone | Passed in about 13 minutes |
| `scripts/e2e.ts` | 29/29 |
| `scripts/e2e-asp.ts` | 7/7 |
| `scripts/e2e-world.ts` (World's verdict faked) | 7/7 |
| Browser run, 390px Chrome | Full flow; no errors, no outside hosts, no horizontal overflow |
| Circuits | 13/13 |
| Contracts (Foundry, including fuzz) | 26/26 |
| SDK | 18/18 |
| ASP server | 17/17 |
| Sidecar: mempool, validation and `eth` suites only | 213/213 |

With the optional fee-bump limit on, `scripts/e2e.ts` last passed 30/30, on an earlier run.

## World ID against the real staging service
Browser, real World proofs through the simulator, on the local chain:

| Path | Result |
|---|---|
| Verified | `POST /join` 200, approved root published, private payment landed |
| Invalid proof | World rejected it: `POST /join` 400, nothing approved, payment stayed refused |
| Same World ID, second wallet | `POST /join` 409, refused |
| Window closed, or cancelled then closed | "You cancelled", public exit offered, retry works |
| Never approved | Private payment refused; public exit returned the money to the depositor |

The app contacted no outside host until Verify was clicked. **Not tested:** production, or a real World App.

## ENSv2
**Deployed to Sepolia.** Live demo: https://relayless-ens.vercel.app. Addresses and a command to check the role limits are in the [README](README.md#ensv2).

| Check | Result |
|---|---|
| `scripts/e2e-ens.ts`: real Sepolia plus the live devnet | 48/48 |
| Foundry, on forked Sepolia with the deployed ENSv2 contracts | 16/16 |
| SDK | 38/38 |
| ASP server | 23/23 |
| `scripts/e2e.ts`: existing pool on the running chain, after the ENS work | 29/29 |
| Live link at 390px, logged out: browse ASPs, roles, look up `alice`, derive twice, bad names | No overflow. Only the page and the Sepolia RPC contacted. Console shows the RPC's 429s, which retry |
| Local app at 390px: verdicts on real records | `world` and `allowlist` checked, `forged-demo` warned |
| World ID ASP server restarted with a stale record | [Published by itself](https://sepolia.etherscan.io/tx/0x17d50267d237591b0aeefde7df44086601c24440e9b8178454c47c9ec378ea00) |
| Approving a depositor on the second ASP | [Published by itself](https://sepolia.etherscan.io/tx/0x5320d9afd562ba5713c9cfe174d00b290e2637234008596ada4e31e6f34a071a) |

Key transactions: [register `relayless.eth`](https://sepolia.etherscan.io/tx/0xd8da7a14f61c6e90709a638b435cf15547ea8ea26d4db37f1b7a08b10a9aaed4), [register `asp`](https://sepolia.etherscan.io/tx/0x498e39e8242fbd46f10d7f54dc6fd5dad48eb45911c3929387aa2c7f90be0d2e), [register `world`](https://sepolia.etherscan.io/tx/0x831d30c21853fda6c58890526bf6550a69169dc709a2d0b23619389e7016c42c), [operator role and records](https://sepolia.etherscan.io/tx/0x77a66869be169e3c0de0344901a9862d5588e4dc08d898ba2e983fd758ad2db5).

Gas was about 18 wei, so the whole deployment and test run used under 0.000001 ETH. Almost all of the 0.499 ETH is still in the throwaway keys.

**Not tested yet:**
- A real browser wallet: an injected test wallet stood in, on a fork.
- Claiming through the live page on real Sepolia: the e2e script claimed through the same SDK call.
- The World ID ASP publishing after a real World ID approval: the restart above and the second ASP's approval use the same publisher.
- The private payment and scan through the browser screens: the e2e script covers those paths.
- `/join` in the browser after the ENS work: `scripts/e2e.ts` covers the pool, not the World ID screen.
- ENSIP-26 agent records: not added.

## Griefing, measured
| Experiment | Result |
|---|---|
| 8 fee bumps from one note, before our fix | `seen` 0 → 8, `included` 1 |
| Same, after our fix | `seen` 0 → 1, `included` 1 |
| Same note sent to two nodes, 2 notes, after our fix | Non-mining node: `seen 2, included 0`. **Still open** |

Main e2e pool, settled: `seen 12, included 11`. **The gap of 1 is unexplained.** The run includes a deliberate fee bump, which may be why.

## Links
**Public devnet** ([explorer](https://explorer.altmempool.wtf/): search by hash, and its history is in memory, so these can disappear):
- Contract sender with a nonce key and a root reference, block 401126: `0x6f39d1fe8c3828025fe8f21baf3ac012acedc6a2d7b87371eae9f54d62ccef99`
- Keyed nonces, workshop step 12: `0x8fc566abddd6a77a4dc6fd26eb31285c44eabb4d0df4851495fd7108ea0d2acd`
- Recent root reference, workshop step 13: `0x8eb575751505fdc906729eeefbf0657da34a9aad618afaa76d0f3a291cf2377e`

**Withdrawals have no public link.** The public gateway refuses them (`docs/repro-gateway.md`), and our chains are private. A real one from the last run, on a chain you can recreate with `scripts/local-stack.sh`: `0x2abddb9619581975ce02e6cfc95a83140897e0970e265d96abb74be9b65452ad`.

## Still to do
- World ID in production with a real World App, if it's part of the demo. Fill in the blanks in `docs/world-id-debrief.md`.
- Demo video and GIF.
- Test a real browser wallet: only the test wallet has been exercised.
- Time proving on a real phone.
- Anon-RPC: docs list no devnet support, so this is probably a documented gap.
- ENSv2: revoke the last parent role. It is permanent, so it waits for the author's decision.

## Known issues
- **ethrex loses block numbers.** On 2 of 2 fresh chains, blocks from about 149 lost their number lookup, about 15 minutes after genesis. Cause unknown. The SDK reads around it and fails loudly if a gap hid pool data. Written up in `docs/upstream-pr.md`.
- **Unexplained, seen once:** on one chain, large deployments stopped mining while small transactions kept going. That chain also held a stale transaction from a nonce race, since fixed. A fresh chain past its hole deployed normally in 24 s, so the hole isn't the cause. If deploys hang, start a fresh chain.
- A young chain can briefly report a root as not yet referenceable. The SDK retries before broadcasting.
- Griefing across nodes is limited, not solved. Throttle and ban thresholds were calculated, not reached in a run.
- Same seed on two devices can still race on one note.
- `docs/research-notes.md` describes the Phase 0 state, so its gas numbers are for the spike circuit.
