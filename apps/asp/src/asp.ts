// The reference association set provider (ASP): an allowlist. Its operator approves depositor addresses by signature,
// and every deposit from an approved address is in the set. Anyone else keeps the public exit.
//
// This is one policy behind the SDK's `AssociationSetProvider` interface. Another ASP, with its own policy and its own
// server, plugs in the same way: see docs/association-sets.md.
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";

export interface Chain {
  /** Every deposit's depositor and label, in deposit order. */
  deposits(): Promise<{ depositor: Address; label: bigint }[]>;
  /** Publishes a root and resolves once a reference to it is usable. */
  publish(labels: bigint[]): Promise<{ sourceId: Hex; slot: bigint; root: Hex }>;
}

export interface AspState {
  /** Approved depositor addresses, checksummed. */
  approved: Address[];
  ref: { sourceId: Hex; slot: string; root: Hex } | null;
  publishedLabels: string[];
}

export interface AspOptions {
  pool: Address;
  /** Signs approvals. */
  operator: Address;
  /** keccak256(writer || salt): the EIP-8272 source this ASP's roots are written under. */
  sourceId: Hex;
  chain: Chain;
  state: AspState;
  save(state: AspState): void;
}

export class AspError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const allowMessage = (pool: Address, depositors: Address[]) => `Allow on pool ${pool.toLowerCase()}: ${depositors.map((a) => a.toLowerCase()).join(",")}`;
export const emptyState = (): AspState => ({ approved: [], ref: null, publishedLabels: [] });

export function createAsp(o: AspOptions) {
  // One change at a time, so two requests can't publish over each other.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => {});
    return run;
  };

  async function approvedLabels(): Promise<bigint[]> {
    const approved = new Set(o.state.approved.map((a) => a.toLowerCase()));
    return (await o.chain.deposits()).filter((d) => approved.has(d.depositor.toLowerCase())).map((d) => d.label);
  }

  async function publishIfChanged(force = false): Promise<void> {
    const labels = await approvedLabels();
    if (labels.length === 0) return;
    const asText = labels.map(String);
    if (!force && o.state.ref && asText.join() === o.state.publishedLabels.join()) return;
    const ref = await o.chain.publish(labels);
    o.state.ref = { sourceId: ref.sourceId, slot: ref.slot.toString(), root: ref.root };
    o.state.publishedLabels = asText;
    o.save(o.state);
  }

  return {
    config: () => ({ policy: "allowlist" as const, pool: o.pool, operator: o.operator, sourceId: o.sourceId }),

    /** The approved set, for any client to build a membership proof. Checks for new deposits from approved addresses first. */
    set: () =>
      serial(async () => {
        await publishIfChanged();
        return { sourceId: o.sourceId, labels: o.state.publishedLabels, ref: o.state.ref };
      }),

    /** Anyone may ask: recent roots expire after 8191 slots, and the set must stay usable. */
    republish: () => serial(() => publishIfChanged(true)),

    /** Publishes one root however many depositors are added. */
    allow: (body: { depositors?: string[]; signature?: Hex }) =>
      serial(async () => {
        const { depositors, signature } = body ?? {};
        if (!Array.isArray(depositors) || depositors.length === 0 || !depositors.every((d) => typeof d === "string" && isAddress(d)) || !signature) throw new AspError(400, "bad_request", "A list of depositors and the operator's signature are required.");
        const addresses = depositors.map((d) => getAddress(d));
        const signed = await verifyMessage({ address: o.operator, message: allowMessage(o.pool, addresses), signature }).catch(() => false);
        if (!signed) throw new AspError(401, "bad_signature", "That signature isn't from this ASP's operator.");
        const known = new Set(o.state.approved);
        for (const a of addresses) if (!known.has(a)) o.state.approved.push(a);
        o.save(o.state);
        await publishIfChanged();
        return { approved: true, labels: o.state.publishedLabels.length };
      }),
  };
}
