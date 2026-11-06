# Relayless research notes: Phase 0 (2026-11-05)

This records the Phase 0 spikes, which were throwaway and kept outside this repo.

> **These are historical numbers from a 7-constraint spike circuit with 6 public inputs**, not the shipped pool. For today's figures (253,176 gas to verify, 7 public inputs, a 24,965-constraint circuit, about 2 s to prove), see [gas-report.md](gas-report.md).

## Bottom line
**The withdrawal mechanism works, but only on a local stack today.** A real Groth16 proof verified in a VERIFY frame, a staked pool paid the gas, and a fresh 0-ETH address received funds. **The public gateway cannot admit this tx yet, because of two independent rules.** Both need EF's help or a local patch.

| Check | Public gateway (unpatched) | Local stack (patched sidecar) |
|---|---|---|
| Workshop steps 1–13 | Pass | Not run |
| Contract sender + nonce key + root ref ([tx](#evidence)) | Admitted, mined, 17/17 checks | Covered by the Groth16 tx |
| Groth16 withdrawal | **Rejected** (`MAX_VERIFY_GAS`) | **Admitted, mined**, 17/17 checks |
| Same tx in ethrex simulate | Frames succeed; canonical verdict false | Frames succeed; canonical verdict false |
| Same tx to canonical mempool | Not sent | Rejected: exceeds `MAX_VERIFY_GAS` |
| Double-spend | Not reached | Rejected: `Nonce mismatch: expected 1, got 0` |
| 4 concurrent withdrawals, one sender | Not reached | 4 of 4 pending at once, all mined in one block |

## The two gateway blockers
1. **100k cap, even when staked.** A wallet with a real 0.012 ETH stake (`isStaked: true`) was rejected at 250,100 gas (dry run), and the actual withdrawal tx at 400,100 declared. The check runs before stake is looked up. `MAX_VERIFY_GAS_STAKED_ENTITY` appears in docs but nowhere in sidecar code, and the README's description of it doesn't match behavior.
2. **Precompiles count as "un-deployed" (`COD-010`).** A VERIFY frame calling `0x06` was rejected at 60k gas, well under the cap. The gateway's `precompiles` config is empty. ERC-8421's CALLING-040 allows `0x01–0x11` and `P256VERIFY`, so this is config, not code.

## Local sidecar changes
- **Patch** (`results/sidecar-budget-010.patch`, about 80 lines; MIT repo): per-entity budgets per BUDGET-010, default 100k/1M and configurable. Also stops the canonical budget message from masking the real failure reason.
- **Config:** `precompiles` set to CALLING-040's list.
- **Tests:** 138 unit tests pass across the 5 affected test files, including 3 new; the full suite was not run. Enforcement was also checked live against the patched sidecar's RPC.

## Measured gas (Phase 0: 6 public inputs, spike circuit, not the shipped pool)
| Item | Gas |
|---|---|
| VERIFY frame, including the 20k first-use nonce key | **241,441** |
| SENDER frame execution, plain transfer | 3,000 |
| SENDER frame state gas, new account | 183,600 |
| **Total** | **457,209** |

Budget need is 241,541 with signature cost: fits the landing page's 250k even unstaked, but not the draft's 100k, so stake matters only under the draft. The real pool adds tree insertion and root publishing in the SENDER frame, and a larger circuit doesn't change verifier gas. Proving took about 240 ms for this 7-constraint circuit, which says **nothing** about real circuit proving time.

## Design points confirmed
- A contract can stake itself in its constructor (`msg.sender` = pool).
- A standalone Yul validator using `verbatim` works with `RECENTROOTREFLOAD` (`0xB6`), `SIGDATACOPY`, `TXPARAM` and `APPROVE`, reading no storage.
- **The snarkjs `sub(gas(), 2000)` pattern is rejected** (`payer uses banned opcode: GAS`); `staticcall(gas(), …)` is admitted.
- The proof binds `sigHash`, and the devnet empties the signature bytes before hashing.

## Where sources contradict the brief
- **RPC:** `devnet1-3`/`gateway1-3` fail TLS from here. Live: `altmempoolgateway.forshtat.com/rpc` (sidecar), `altmempool.forshtat.com` (ethrex), chain 1337.
- **Spec drift:** the devnet (ethrex `9aa3645d`) predates today's EIPs. Roots are an envelope field (today: a VERIFY frame), first-use nonce gas is 20k (today: 97,920 state + 12,100), signature bytes are emptied (today: replaced by length), and predeploys are at `0x…8250`/`0x…8272` (today: other addresses). Keep these behind one adapter.
- **Workshop:** 13 steps, not 11.
- **Anon-RPC:** docs list no devnet support; confirm in Phase 3.
- **Other design inputs:** new accounts need non-zero `state` gas; roots expire after 8191 slots (~13.6h), so add a permissionless `republishRoot()`; all users share the pool's reputation.

## Not tested
- Real Relayless contracts and circuit: this spike doesn't enforce the full frame lockdown, amounts or change notes, so **it is not safe to reuse as-is**.
- Anything mined on a public chain with a proof. `ethrex_submitPrivilegedFrameTransaction` is open, but deliberately unused on the shared devnet without EF's OK.
- Local chain differences: same ethrex commit and compose setup, but its own genesis.

## Questions for Pierre / Alex at the EF booth
1. "A staked sender is rejected at 250,100 gas with `exceeds MAX_VERIFY_GAS 100000`, and a VERIFY frame calling `0x06` is rejected by `COD-010` under the cap because `precompiles` is empty. Can the gateway get BUDGET-010 and CALLING-040's precompiles during the hackathon? Which budgets: 100k/1M or 250k/2.5M?"
2. "Are `devnet1-3` and `gateway1-3.altmempool.wtf` meant to be live? They fail TLS for us. Do they run different rules?"
3. "If the gateway can't change, does a tx admitted on a local stack with this patch qualify? Or may we relay from our patched sidecar to the public devnet? We won't use the privileged endpoint on a shared devnet without your OK, and we wouldn't call that admission by your mempool."
4. "Would you take our BUDGET-010 patch as a sidecar PR?"
5. "Will the devnet stay on envelope recent roots and ethrex `9aa3645d` through judging, or reset or upgrade first?"

## Evidence
The raw results were kept outside this repo. The public explorer's history is in memory, so these may disappear from it.
- **Public, combined tx:** `0x6f39d1fe8c3828025fe8f21baf3ac012acedc6a2d7b87371eae9f54d62ccef99` (block 401126), search at https://explorer.altmempool.wtf/
- **Local, Groth16 withdrawal:** `0x19a86c05bb1f555e19559981482d52f75fd766a79c70ea2f227ff8defd44e411` (private chain: no public link)
- **Public, rejected Groth16 tx (never mined):** `0xbef7c5b6078a219db854c30b66365dceb27116c160b6259414f5bc001a8de39d`
