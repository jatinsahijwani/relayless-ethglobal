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
| 5: compliance | Partly done | Association set, public exit and World ID path work locally. **World has never verified a real proof here.** ENSv2 not started |

## Test results
Last full run: a fresh `git clone`, empty stack directory, `scripts/local-stack.sh`, then every suite on that chain.

| Suite | Result |
|---|---|
| `scripts/local-stack.sh` from a fresh clone | Passed in about 13 minutes |
| `scripts/e2e.ts` | 29/29 |
| `scripts/e2e-asp.ts` | 7/7 |
| `scripts/e2e-world.ts` (**World's verdict faked**) | 7/7 |
| Browser run, 390px Chrome | Full flow; no errors, no outside hosts, no horizontal overflow |
| Circuits | 13/13 |
| Contracts (Foundry, including fuzz) | 26/26 |
| SDK | 16/16 |
| ASP server | 17/17 |
| Sidecar: mempool, validation and `eth` suites only | 213/213 |

With the optional fee-bump limit on, `scripts/e2e.ts` last passed 30/30, on an earlier run.

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

## Inputs needed
- For World ID: `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_SIGNING_KEY`. Steps: `docs/world-id-setup.md`.

## Still to do
- First real World ID verification, each alternative path against it, then fill in `docs/world-id-debrief.md`.
- Demo video and GIF.
- Test a real browser wallet: only the test wallet has been exercised.
- Time proving on a real phone.
- Decide the final license, given GPL-3.0 dependencies (`NOTICE.md`).
- Anon-RPC: docs list no devnet support, so this is probably a documented gap.
- ENSv2 and pay-to-ENS: not started, on hold.

## Known issues
- **ethrex loses block numbers.** On 2 of 2 fresh chains, blocks from about 149 lost their number lookup, about 15 minutes after genesis. Cause unknown. The SDK reads around it and fails loudly if a gap hid pool data. Written up in `docs/upstream-pr.md`.
- **Unexplained, seen once:** on one chain, large deployments stopped mining while small transactions kept going. That chain also held a stale transaction from a nonce race, since fixed. A fresh chain past its hole deployed normally in 24 s, so the hole isn't the cause. If deploys hang, start a fresh chain.
- A young chain can briefly report a root as not yet referenceable. The SDK retries before broadcasting.
- Griefing across nodes is limited, not solved. Throttle and ban thresholds were calculated, not reached in a run.
- Same seed on two devices can still race on one note.
- `docs/research-notes.md` describes the Phase 0 state, so its gas numbers are for the spike circuit.
