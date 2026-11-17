# Public testnet run (chain 8141)

The run that puts a Relayless pool on the Hegotá privacy testnet and exercises it. **Status: done twice, 5/5 each time:** on 2026-11-16 with the first pool, and on 2026-11-17 with a new pool for the compressed withdrawal statement. Results and explorer links are in the README's [Public testnet](../README.md#public-testnet) section.

## The network
| | |
|---|---|
| Chain | 8141, the Hegotá privacy testnet, run by the ethrex team |
| RPC | `https://rpc1.privacy.ethrex.xyz`. Open to anyone. Its proxy serves `eth`, `net`, `web3`, `txpool` and `ethrex` |
| Explorer | [dora.privacy.ethrex.xyz](https://dora.privacy.ethrex.xyz). Decodes type-0x06 transactions with per-frame receipts. Links: `/tx/<hash>`, `/address/<address>` |
| Faucet | [faucet.privacy.ethrex.xyz](https://faucet.privacy.ethrex.xyz): `POST /api/claim {"address": "0x..."}`, rate-limited, 1 ETH a claim by default |
| Client | ethrex `64b8fc09` (`v23.0.0-hegota-testnet-hotfix`), so the pool uses the `hegota-8141` profile |
| Admission | Permissionless for transactions; only validators need an access token. Verify budget 500,000 (`--mempool.max-verify-gas`). One pending transaction per sender is relaxed for disjoint nonce keys. **No MATCHA width budget** on this revision |

## What it costs
About **0.15 ETH** of testnet ETH, most of which stays in the pool:

| | ETH |
|---|---|
| Deploys: Poseidon T3, T4, validator, pool (about 60M gas at a base fee of a few wei) | under 0.001 |
| The pool's gas reserve | 0.02 |
| Five deposits of 0.02 | 0.10 |
| Gas held by each withdrawal at APPROVE, mostly refunded | about 0.003 each |

## The sequence
```sh
scripts/testnet-key.sh                                    # once: a fresh throwaway key in .env.hegota-8141 (git-ignored), prints its address
# fund that address with about 0.15 ETH on chain 8141
set -a; . ./.env.hegota-8141; set +a
npx tsx scripts/testnet-preflight.ts hegota-8141          # sends nothing: chain, client revision, predeploys, our encoding, balance
pnpm build:contracts
npx tsx scripts/deploy.ts hegota-8141                     # writes config/hegota-8141.deployed.json
npx tsx scripts/testnet-run.ts hegota-8141                # the five steps below, recorded with explorer links
```

`testnet-run.ts` asserts each step, writes `.relayless-testnet-hegota-8141.json` (git-ignored; each run's copy is kept in [testnet-runs/](testnet-runs/) with its deployed config), and prints the rows for the README's [Public testnet](../README.md#public-testnet) table:

1. **Deposit:** five notes of 0.02 ETH.
2. **Private withdrawal** of 0.015 ETH to a derived address with no balance and no history, checked at 0 ETH before. Every frame must succeed.
3. **Double spend:** the spent note, forced past the SDK's own check. It must be refused by the node's simulation, on the nonce, **before anything is broadcast**. No transaction exists for this step.
4. **Concurrent withdrawals:** three notes paid together with `payMany`, each on its own nullifier key, checked as pending at the same time or mined in the same block. On this chain that shows the relaxed per-sender rule, not MATCHA.
5. **Public exit:** a ragequit to the depositor.

## What the runs cost
| Run | Spent from the deployer | Left in the pool |
|---|---|---|
| 2026-11-16, first pool | 0.1180 ETH (1.0 from the faucet to 0.8820) | its change notes |
| 2026-11-17, compressed | 0.1179 ETH (0.8820 to 0.7641) | 0.0729 ETH |

Before deploying a new pool, rerun the safety checks on the local `hegota-8141` chain: `scripts/gas-floors.ts`, `scripts/adversarial.ts`, `scripts/alias.ts`, and the five steps with `npx tsx scripts/testnet-run.ts local-hegota`.

## Already checked without funds
- `testnet-preflight.ts` passes against the live chain: chain id 8141, ethrex `64b8fc09`, the recent-root contract's code hash `0xcd1c…75a5`, the nonce manager installed, and slots in the headers.
- The live node decodes a `hegota-8141` withdrawal built by our codec and reads its recent-root frame: it refuses the dummy only for its expired root.
- The whole sequence passes 5/5 on the local `hegota-8141` chain (`npx tsx scripts/testnet-run.ts local-hegota`), on the same client revision.

## Stop conditions
- Preflight fails: don't deploy.
- Any step fails: stop, and don't retry withdrawals blindly. A refused withdrawal costs nothing, but a broadcast one that isn't mined would count against the pool in any reputation-tracking mempool.
- The deploy key holds testnet ETH only. Never reuse it.
