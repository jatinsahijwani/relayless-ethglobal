# Drafts: support for EIP-8250 and EIP-8272 in Hegotá

**Not posted.** Two posts, one per Ethereum Magicians thread, each under 200 words. EIP-8081 lists both as "Considered for Inclusion" and EIP-8141 as "Scheduled" (checked 2026-11-17).

| Post | Where | Order |
|---|---|---|
| EIP-8250 | Reply at the bottom of https://ethereum-magicians.org/t/eip-8250-keyed-nonces-for-frame-transactions/28437 | **3rd of 5.** Day 2, the day after the MATCHA reply |
| EIP-8272 | Reply at the bottom of https://ethereum-magicians.org/t/eip-8272-recent-roots-for-frame-transactions/28621 | **4th of 5.** Day 3 |

The ethresear.ch post follows on day 5.

Every number is from chain 8141 (the `hegota-8141` profile, ethrex `64b8fc09`) unless marked local.

## 1. EIP-8250 (Keyed Nonces for Frame Transactions)
---

**Support for Hegotá, from a working user on chain 8141**

[Relayless](https://github.com/jatinsahijwani/relayless-ethglobal) is a privacy pool where the pool is the frame transaction's sender and pays gas from the note being withdrawn, so a wallet holding 0 ETH can be paid privately without a relayer. Each withdrawal's nullifier hash is its EIP-8250 nonce key.

On chain 8141:

- **A double spend is refused by the protocol.** The node's simulation refused a second withdrawal of a spent note with `Nonce mismatch: expected 1, got 0`, and nothing was broadcast.
- **One sender serves many users at once.** Three withdrawals on three keys were pending together and mined in block 859307 ([1](https://dora.privacy.ethrex.xyz/tx/0x7dabc6e6d7d93be1e2a589f1458b0cce291cc8589b9eef7d19daadc134181e1b), [2](https://dora.privacy.ethrex.xyz/tx/0x1d02aa2465ea150ef9dded3c163d8515efb359d10a779ae604b0aaa39d9e62d4), [3](https://dora.privacy.ethrex.xyz/tx/0x8e87a40519350a210841ea1c2c6c56f2914b92da6411c2807819f5d121ad5f7f)).
- **The cost is clear:** 97,920 state gas for the key's first use, inside a 916,820-gas withdrawal.

One detail: ethrex lets keyed transactions from one sender be pending together only when the sender's validation reads none of its own storage. Without keyed nonces, the pool would need nullifier storage in validation, or a relayer. I'd like to see EIP-8250 scheduled with EIP-8141.

---

## 2. EIP-8272 (Recent Roots for Frame Transactions)
---

**Support for Hegotá, from a working user on chain 8141**

[Relayless](https://github.com/jatinsahijwani/relayless-ethglobal), a privacy pool on frame transactions, takes its Merkle root from an EIP-8272 recent-root frame on chain 8141, so its validation reads no storage at all. On Alex's question from July: yes, the frame form gives a privacy pool what it needs. The root frame goes first, and the pool's validator checks it and reads the tuples with `FRAMEPARAM` and `FRAMEDATALOAD`.

- **The frame is cheap:** 5,579 gas for one root on chain 8141 ([tx](https://dora.privacy.ethrex.xyz/tx/0x543a9ad335af2202d696d9bdae7c242c30f952f44f06b9eb512dbdfc24236ed8)). With two roots, the second being an association set's, it's 8,010 (local).
- **Pending withdrawals survive new deposits.** On local ethrex `64b8fc09` and `247e2dd2` chains, six prepared withdrawals all stayed valid after a deposit published a new root, after another withdrawal landed, and after 20 more blocks.
- **That's what makes concurrency safe.** Three withdrawals from the one pool sender were pending together on chain 8141 and mined in one block.
- **It composes with compliance:** an association set's root rides in the same frame.

Without recent roots, every deposit could invalidate every pending withdrawal. [Results](https://github.com/jatinsahijwani/relayless-ethglobal/blob/main/research/shared-sender/RESULTS.md). I'd like to see EIP-8272 scheduled with EIP-8141.

---

## Notes
- **Word counts** (the text between the `---` lines, heading included, link targets excluded): EIP-8250 is 179, EIP-8272 is 195. Recount after any edit.
- **Sources:**
  - Block 859307 and the three transactions: README "Public testnet", 2026-11-17 run.
  - 97,920 and 916,820: the chain 8141 withdrawal receipt.
  - 5,579: the same receipt's root frame.
  - 8,010: `docs/gas-report.md`, local `hegota-8141`.
  - The six-withdrawal check: `research/shared-sender/RESULTS.md` §4.
  - The ethrex concurrency rule: `KeyedConcurrency` in `crates/blockchain/mempool.rs` at `64b8fc09`, read 2026-11-22.
- **Neither post claims the pool design.** It follows soispoke's minimal-shielded-pool, which uses both EIPs. If you want to say so, add: "The pool design follows soispoke's minimal-shielded-pool."
- **Thread state, re-read 2026-11-22.**
  - EIP-8250: latest post 2026-10-23. Ankushin's open question there (keyed sequences in `NONCE_MANAGER` or in the sender's own storage) isn't one our data answers.
  - EIP-8272: latest post 2026-07-17. Alex Forshtat (the ERC-8421 sidecar's author) asked whether a recent-root validation frame gives a privacy pool everything it needs, and soispoke replied that it could work. The post answers him with a working pool.
- **If either thread has moved on** to another open question by posting day, answer that instead.
