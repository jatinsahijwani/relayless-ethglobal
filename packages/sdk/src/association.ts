// Association sets, provider-agnostic. A pool with an association set accepts private withdrawals only for labels in a
// set whose root a provider (an ASP) writes to the EIP-8272 recent-root predeploy under one fixed source id. Anyone
// else keeps the public exit (ragequit), which never consults a provider.
//
// What a provider can and can't do: it decides who is approved, so it can withhold approval or over-approve. It can't
// fake membership, because the circuit checks the label against the root, and it can't fake the root, because the
// validator checks the root against the chain. It can't touch anyone's money.
//
// How to write a provider for another ASP, such as 0xbow's: docs/association-sets.md.
import type { Hex } from "viem";
import type { RootRef } from "./frame.js";
import { rootFromProof, siblings, TREE_DEPTH } from "./tree.js";

/** "pending" and "declined" are for providers that review deposits. A plain allowlist only knows approved or not. */
export type ApprovalStatus = "approved" | "pending" | "declined" | "unknown";

/** A LeanIMT inclusion proof for one label, against the root that `ref` points to. */
export interface MembershipProof {
  ref: RootRef;
  /** The label's position in the set. */
  index: number;
  /** One per level, `TREE_DEPTH` long. 0 means "no sibling at this level". */
  siblings: bigint[];
}

export interface AssociationSetProvider {
  /**
   * The EIP-8272 source this provider writes roots under: keccak256(writer || salt). A pool accepts exactly one, its
   * immutable `ASP_SOURCE_ID`, so the client checks this before proving.
   */
  sourceId(): Promise<Hex>;
  /** The newest root the chain holds from this provider, or null if nothing has been approved yet. */
  currentRoot(): Promise<RootRef | null>;
  /** A membership proof for this label against the current root, or null if the label isn't in the set. */
  membershipProof(label: bigint): Promise<MembershipProof | null>;
  /** Whether this label is approved, so a client can explain a refusal before proving anything. */
  status(label: bigint): Promise<ApprovalStatus>;
}

/** Recomputes the root from a proof. A client runs this before proving, so a bad proof never reaches the prover. */
export const proofMatchesRoot = (label: bigint, p: MembershipProof): boolean =>
  p.siblings.length === TREE_DEPTH && p.index >= 0 && p.index < 2 ** TREE_DEPTH && rootFromProof(label, p.index, p.siblings) === BigInt(p.ref.root);

/** What a provider that publishes its whole set needs to supply. The proofs are then built locally. */
export interface PublishedSet {
  sourceId: Hex;
  labels: bigint[];
  ref: RootRef | null;
}

/**
 * A provider for any ASP that publishes its full list of approved labels. Building proofs locally means the client asks
 * for the whole set, never for one label, so the provider doesn't learn which note is about to be spent.
 */
export function publishedSetProvider(load: () => Promise<PublishedSet>): AssociationSetProvider {
  return {
    sourceId: async () => (await load()).sourceId,
    currentRoot: async () => (await load()).ref,
    async membershipProof(label) {
      const { labels, ref } = await load();
      const index = labels.indexOf(label);
      if (!ref || index < 0) return null;
      return { ref, index, siblings: siblings(labels, index) };
    },
    async status(label) {
      const { labels, ref } = await load();
      return ref && labels.includes(label) ? "approved" : "unknown";
    },
  };
}

/**
 * The reference provider: the allowlist ASP server in `apps/asp`, whose operator approves depositors directly. It
 * serves `GET /set` with every approved label and the root's recent-root reference.
 */
export function allowlistProvider(url: string, http: typeof fetch = (...a) => fetch(...a)): AssociationSetProvider {
  return publishedSetProvider(async () => {
    const res = await http(`${url}/set`);
    if (!res.ok) throw new Error("couldn't read the pool's approved set: try again shortly");
    const body = (await res.json()) as { sourceId: Hex; labels: string[]; ref: { sourceId: Hex; slot: string; root: Hex } | null };
    return {
      sourceId: body.sourceId,
      labels: body.labels.map(BigInt),
      ref: body.ref ? { sourceId: body.ref.sourceId, slot: BigInt(body.ref.slot), root: body.ref.root } : null,
    };
  });
}
