// The in-flight ledger: one nullifier, one pending transaction. Reputation drops for every tx that is broadcast but not
// mined, so a nullifier is never sent twice, except as a deliberate fee bump that replaces the pending one.
export interface InFlight {
  nullifierHash: string;
  txHash: string;
  sentAt: number;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export interface InFlightStore {
  get(nullifierHash: bigint): InFlight | undefined;
  set(entry: InFlight): void;
  delete(nullifierHash: bigint): void;
  all(): InFlight[];
}

export class MemoryStore implements InFlightStore {
  private m = new Map<string, InFlight>();
  get(n: bigint) { return this.m.get(n.toString()); }
  set(e: InFlight) { this.m.set(e.nullifierHash, e); }
  delete(n: bigint) { this.m.delete(n.toString()); }
  all() { return [...this.m.values()]; }
}

/** Survives a reload, so reopening the app can't send a second transaction for a pending note. */
export class BrowserStore implements InFlightStore {
  constructor(private key = "relayless.inflight") {}
  private read(): Record<string, InFlight> {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(this.key) ?? "{}");
    } catch {
      return {};
    }
  }
  private write(m: Record<string, InFlight>) {
    try {
      globalThis.localStorage?.setItem(this.key, JSON.stringify(m));
    } catch {
      // Private window or blocked storage: the on-chain spent check still applies.
    }
  }
  get(n: bigint) { return this.read()[n.toString()]; }
  set(e: InFlight) { this.write({ ...this.read(), [e.nullifierHash]: e }); }
  delete(n: bigint) { const m = this.read(); delete m[n.toString()]; this.write(m); }
  all() { return Object.values(this.read()); }
}
