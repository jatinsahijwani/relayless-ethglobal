// The association set: which deposits may withdraw privately. A verified unique human joins with one depositor address,
// and every deposit from that address is approved. Anyone else keeps the public exit.
//
// World's verify API only confirms a proof is valid, so three checks live here:
//  - the proof's signal must be this depositor, so a proof can't be lifted and reused for another address;
//  - a nullifier joins once, so one human can't approve many addresses;
//  - the depositor must sign, so nobody can be enrolled without consent.
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { hashSignal } from "@worldcoin/idkit-core/hashing";

export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

export interface WorldClient {
  rpContext(): RpContext;
  /** Server-side verification. An unverified client response must never authorize anything. */
  verify(result: any): Promise<boolean>;
}

export interface Chain {
  /** Every deposit's depositor and label, in deposit order. */
  deposits(): Promise<{ depositor: Address; label: bigint }[]>;
  /** Publishes a root and resolves once a reference to it is usable. */
  publish(labels: bigint[]): Promise<{ sourceId: Hex; slot: bigint; root: Hex }>;
}

export interface AspState {
  /** nullifier (decimal) -> depositor */
  members: Record<string, Address>;
  ref: { sourceId: Hex; slot: string; root: Hex } | null;
  publishedLabels: string[];
}

export interface AspOptions {
  pool: Address;
  action: string;
  environment: string;
  appId: string | null;
  world: WorldClient | null;
  chain: Chain;
  state: AspState;
  save(state: AspState): void;
}

export class AspError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const joinMessage = (pool: Address, depositor: Address) => `Join the Relayless approved set for pool ${pool.toLowerCase()} as ${depositor.toLowerCase()}`;
export const emptyState = (): AspState => ({ members: {}, ref: null, publishedLabels: [] });

export function createAsp(o: AspOptions) {
  // One change at a time, so two requests can't both pass the nullifier check.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => {});
    return run;
  };

  async function approvedLabels(): Promise<bigint[]> {
    const members = new Set(Object.values(o.state.members).map((a) => a.toLowerCase()));
    return (await o.chain.deposits()).filter((d) => members.has(d.depositor.toLowerCase())).map((d) => d.label);
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
    config: () => ({ enabled: Boolean(o.world && o.appId), app_id: o.appId, action: o.action, environment: o.environment }),

    rpContext() {
      if (!o.world) throw new AspError(503, "world_not_configured", "World ID isn't set up on this server yet.");
      return o.world.rpContext();
    },

    /** The approved set, for any client to build a membership proof. Checks for new deposits from members first. */
    set: () =>
      serial(async () => {
        await publishIfChanged();
        return { labels: o.state.publishedLabels, ref: o.state.ref };
      }),

    /** Anyone may ask: recent roots expire after 8191 slots, and the set must stay usable. */
    republish: () => serial(() => publishIfChanged(true)),

    join: (body: { depositor?: string; signature?: Hex; result?: any }) =>
      serial(async () => {
        if (!o.world) throw new AspError(503, "world_not_configured", "World ID isn't set up on this server yet.");
        const { depositor, signature, result } = body ?? {};
        if (!depositor || !isAddress(depositor) || !signature || !result) throw new AspError(400, "bad_request", "A depositor address, a signature and a World ID result are required.");
        const address = getAddress(depositor);

        const signed = await verifyMessage({ address, message: joinMessage(o.pool, address), signature }).catch(() => false);
        if (!signed) throw new AspError(401, "bad_signature", "That signature isn't from this depositor.");

        if (result.environment !== o.environment) throw new AspError(400, "wrong_environment", `This server expects World ID ${o.environment} proofs.`);
        const responses: any[] = Array.isArray(result.responses) ? result.responses : [];
        if (responses.length === 0) throw new AspError(400, "bad_request", "The World ID result has no proofs.");

        // Fail closed: a proof with no signal hash isn't bound to anyone.
        const expected = BigInt(hashSignal(address));
        for (const r of responses) {
          if (!r.signal_hash || BigInt(r.signal_hash) !== expected) throw new AspError(400, "signal_mismatch", "This proof wasn't made for this depositor.");
          if (!r.nullifier) throw new AspError(400, "bad_request", "The World ID result has no nullifier.");
        }

        const deposits = await o.chain.deposits();
        if (!deposits.some((d) => d.depositor.toLowerCase() === address.toLowerCase())) throw new AspError(400, "no_deposit", "This address hasn't added money to the pool yet.");

        // Decimal, so the same nullifier in hex and decimal can't count as two.
        const nullifiers = responses.map((r) => BigInt(r.nullifier).toString());
        for (const n of nullifiers) {
          const holder = o.state.members[n];
          if (holder && holder.toLowerCase() !== address.toLowerCase()) throw new AspError(409, "already_used", "This World ID has already approved a different address.");
        }

        if (!(await o.world.verify(result))) throw new AspError(400, "verification_failed", "World ID didn't accept this proof.");

        for (const n of nullifiers) o.state.members[n] = address;
        o.save(o.state);
        await publishIfChanged();
        return { approved: true, labels: o.state.publishedLabels.length };
      }),
  };
}
