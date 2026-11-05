// Reads the association set from an ASP server. Anyone can check the labels against the root, and the circuit refuses a
// label that isn't in it, so this server can withhold approval but can't fake it.
import type { Hex } from "viem";
import type { AssociationSet } from "./client.js";

export function httpAssociationSet(url: string, http: typeof fetch = (...a) => fetch(...a)): AssociationSet {
  return {
    async load() {
      const res = await http(`${url}/set`);
      if (!res.ok) throw new Error("couldn't read the pool's approved set: try again shortly");
      const body = (await res.json()) as { labels: string[]; ref: { sourceId: Hex; slot: string; root: Hex } | null };
      if (!body.ref) return { labels: [], ref: { sourceId: "0x", slot: 0n, root: "0x" } };
      return { labels: body.labels.map(BigInt), ref: { sourceId: body.ref.sourceId, slot: BigInt(body.ref.slot), root: body.ref.root } };
    },
  };
}
