# Progress

## What works (local stack only)
Local stack: ethrex `9aa3645d` plus sidecar with `patches/sidecar-budget-010.patch` and a `precompiles` config.

| Phase | Status | Evidence |
|---|---|---|
| 0: prove the path | Done | Workshop steps 1–13 pass on the public devnet. Combined key-and-root tx mined, public block 401126: `0x6f39d1fe8c3828025fe8f21baf3ac012acedc6a2d7b87371eae9f54d62ccef99` |
| 1: minimal withdrawal | **Done locally** (authors confirmed a local sidecar is fine for judging) | Withdrawal mined from the staked pool to a 0-ETH address. Double spend invalid. Canonical mempool rejects it, patched alt mempool admits it. `docs/gas-report.md` |
| 2: product core | Done | Recovery, partial and split payments, 3+ pending at once, web app in phone-size Chrome |
| 3: anonymity | Done except Anon-RPC | Meter, k-gate in circuit and UI, comparison view |
| 4: polish | Mostly done | README, CROPS, threat model, demo script, license. See "Still to do" |
| 5: compliance | **Partly done** | Association set and public exit work locally. World ID and ENSv2 not started |

## Author feedback applied
All six items are done. See the table in `DECISIONS.md`, and `docs/reputation-analysis.md`.

## Test results (last run)
| Suite | Result |
|---|---|
| Circuits | 13/13 |
| Contracts (Foundry, including fuzz) | 26/26 |
| SDK units | 13/13 |
| `scripts/e2e.ts`, local | 30/30 |
| `scripts/e2e-asp.ts`, local | 7/7 |
| Sidecar patch, 5 affected test files only | 138/138 |
| Browser run, 390px Chrome | Full flow; no errors, no outside hosts, no horizontal overflow |

Local tx hashes aren't linkable because the chain is private. Last headline tx: `0x59868786ee22c0f6e449680abd79ab21f5a1f68538f757366b06269f6ff23f3a`.

## Public gateway
**Not a blocker for judging:** the alt mempool authors confirmed a local sidecar is fine. The public gateway still can't admit a withdrawal, so there's no public explorer link for one. Reproduction: `docs/repro-gateway.md`.

## Still to do
**Inputs needed:**
- For Phase 5: a World ID app ID, and an ENS name plus Sepolia ETH.

**Work remaining:**
- World ID and ENSv2 integration, and pay-to-ENS, once the above arrive.
- Run `scripts/local-stack.sh` from scratch. **Never run end to end.** Its parts were each run by hand, but "one-command setup" is unproven until this passes.
- Demo GIF and the 3-minute video.
- Anon-RPC: docs list no devnet support, so this is probably a documented gap.
- Time proving on a real phone. Test a real browser wallet: only the test wallet was exercised.
- Decide the final license, given GPL-3.0 dependencies (`NOTICE.md`).

## Known issues
- `docs/research-notes.md` describes the Phase 0 state, so its gas numbers are for the spike circuit.
- Griefing is bounded, not solved. Throttle and ban thresholds were calculated, not reached in a run.
- Same seed on two devices can still race on one note.
- The circuit keys were regenerated after the end-to-end and browser runs above, so those need repeating on a fresh deployment.
