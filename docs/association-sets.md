# Association sets: the provider interface

A pool with an association set lets a note leave privately only if its label is in a set approved by an association set provider (ASP). Everyone else keeps the public exit (ragequit) to the address that deposited, and the exit never asks a provider anything.

Relayless doesn't pick the provider. The SDK talks to any ASP through one interface, `AssociationSetProvider` (`packages/sdk/src/association.ts`). This repo ships one reference implementation, an allowlist (`apps/asp`).

## What the chain enforces, whatever the provider
- **One source per pool.** The pool's immutable `ASP_SOURCE_ID` is an EIP-8272 source id, `keccak256(writer || salt)`. Its validator only accepts a withdrawal whose second recent-root reference comes from that source. Changing provider means deploying a new pool.
- **Root.** The validator checks the root against the recent-root predeploy, so a provider can't present a root it never wrote.
- **Membership.** The circuit checks the label against that root, so a provider can't approve a label by lying in a proof.
- **Exit.** Ragequit uses neither the provider nor its root.

So a provider can **withhold approval** or **over-approve**. It can't move money, fake a root or fake membership, and it can't block the public exit.

## The interface

```ts
interface AssociationSetProvider {
  sourceId(): Promise<Hex>;                                  // keccak256(writer || salt): must equal the pool's ASP_SOURCE_ID
  currentRoot(): Promise<RootRef | null>;                    // { sourceId, slot, root } of the newest root on the chain
  membershipProof(label: bigint): Promise<MembershipProof | null>; // { ref, index, siblings[20] }, or null if not in the set
  status(label: bigint): Promise<"approved" | "pending" | "declined" | "unknown">;
}
```

Before proving, the client:
1. checks `sourceId()` against the pool's `ASP_SOURCE_ID`, once per session;
2. asks for `membershipProof(label)`, and if there isn't one, asks for `status(label)` so it can say "waiting for review", "declined" or "not approved yet";
3. recomputes the root from the proof (`proofMatchesRoot`), so a bad proof never reaches the prover;
4. simulates the transaction, so a root the chain doesn't hold fails before anything is broadcast.

`checkRecentRoot(rpc, ref)` reads the predeploy directly, for anyone who wants to check a provider's root out of band, such as a wallet, a dashboard or `demo-prep`.

**The tree format** is the one the circuit expects: a LeanIMT over labels, with `poseidon2` for hashing, at most 2^20 leaves, and 20 positional siblings where `0` means "no sibling at this level" (`packages/sdk/src/tree.ts`). It's the same structure as 0xbow's Privacy Pools ASP tree, since our membership template is adapted from theirs.

## The reference provider: an allowlist
`apps/asp` is a small HTTP server. Its operator signs `Allow on pool <pool>: <addresses>`, and every deposit from those addresses is approved.

| Route | What |
|---|---|
| `GET /config` | `{ policy: "allowlist", pool, operator, sourceId }` |
| `GET /set` | `{ sourceId, labels, ref }`: every approved label, and the root's recent-root reference |
| `POST /allow` | `{ depositors, signature }`, signed by the operator. Publishes one root per batch |

The server writes each new root to the recent-root predeploy, using the same key that signs approvals, under the salt `keccak256("relayless.asp")`. It republishes every 6 hours and on restart, because a root stops being referenceable after 8191 slots, about 13.6 hours.

The SDK side is `allowlistProvider(url)`. It builds on `publishedSetProvider`: it downloads the whole set and builds proofs locally, so the server never learns which label is about to be spent.

## Writing a provider for another ASP
Any ASP that can do the following can back a Relayless pool:
1. **write its root to EIP-8272** from a key it controls, under a salt it picks, so that `sourceId = keccak256(writer || salt)`;
2. **make the approved labels available**, either as a full list or as per-label proofs;
3. **say how it decides**, and optionally expose review states.

Then:
- **If it publishes the full list:** wrap it with `publishedSetProvider(load)`, where `load` returns `{ sourceId, labels, ref }`. That's all.
- **If it only serves proofs:** implement the four methods directly. `membershipProof` must return the 20-sibling positional form above, and `ref` must be the reference the root was written under.
- **Deploy a pool** with `ASP_SOURCE_ID` set to that source (`scripts/deploy.ts` reads `ASP_SOURCE_ID`).

### Example: 0xbow's ASP
This describes 0xbow's public contracts as of `privacy-pools-core@main` (2026-11-16). It hasn't been built or agreed with 0xbow.

**What 0xbow does today:** an authorized `ASP_POSTMAN` calls `Entrypoint.updateRoot(root, ipfsCID)` on 0xbow's own deployment. The root is a Poseidon LeanIMT over approved labels, and the CID points to the off-chain set. Their review service, which decides pending, approved or declined, is hosted, and isn't in the open-source repo.

**What would change for a Relayless pool:**

| Piece | 0xbow today | For a Relayless pool |
|---|---|---|
| Labels reviewed | Deposits into 0xbow's pools, labelled `keccak256(scope, nonce) % p` | Deposits into the Relayless pool, using its own labels. 0xbow's existing sets don't contain them |
| Where the root goes | `Entrypoint.updateRoot` storage | The EIP-8272 recent-root predeploy, as a plain call from the postman key. Roots expire after 8191 slots, so the postman must republish at least every few hours |
| Source id | n/a | `keccak256(postman || salt)`, fixed at pool deployment. Rotating the postman key means a new pool |
| Set data | IPFS CID | The same CID works: `publishedSetProvider` can load labels from IPFS and the latest reference from the postman's recent-root writes |
| Review states | Hosted API | Map them onto `status`: pending, approved, declined |
| Tree | Poseidon LeanIMT | Same. The 20-level depth bound must hold |

**Trust stays where it is with 0xbow:** the postman decides the set. Relayless adds nothing to trust, and removes nothing.

**One consequence of the current design:** a pool takes roots from exactly one source. A pool that accepts several ASPs, each note proving against the provider of its choice, would need a contract and validator change, and isn't built.

## Spec note
Where the root reference travels depends on the pool's spec profile. On `devnet-8421` it's an envelope field. On `hegota-8141` (chain 8141) both references, the pool's and the ASP's, go in one EIP-8272 verifier frame at index 0. The interface, the storage layout `checkRecentRoot` reads, and the predeploy at `0x…8272` are the same on both. Pass the profile's `recentRoot` to `checkRecentRoot`. The current EIP-8272 text moves the contract to `0x8272D9679689Ea2f307140CdF9002D27dC00Ffff`, which a future `eips-current` profile would use. See `docs/spec-port.md`.
