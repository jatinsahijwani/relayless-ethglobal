// The three-call API: connect, deposit, withdraw. Plus anonymity, recovery and fee bumps.
//
// Rules this file enforces, because reputation drops for every transaction broadcast but not mined:
//  - proofs always use the latest committed root, which has the longest life left;
//  - fees are generous, with the unused part refunded by a DEFAULT frame;
//  - the pool's solvency is checked before anything is sent;
//  - the transaction is simulated before it is broadcast;
//  - a nullifier is never sent twice, except as a fee bump replacing the pending transaction.
import { concat, encodeFunctionData, keccak256, numberToHex, parseEther, type Address, type Hex } from "viem";
import { POOL_ABI, RpcError, fetchPoolState, rpc, type PoolState, type RootEvent } from "./chain.js";
import { anonymity, type AnonymityReport } from "./anonymity.js";
import { R, changeSecrets, commitment, depositSecrets, freshAccount, masterFromSignature, nonceSlot, nullifierHash as hashNullifier, precommitment, seedTypedData, type NoteSecrets } from "./crypto.js";
import { EMPTY_PROOF, LIMITS, NONCE_MANAGER, buildRagequit, buildWithdrawal, encodeProof, rawOf, sigHashOf, toWire, txHashOf, type FrameTx, type RootRef } from "./frame.js";
import { MemoryStore, type InFlightStore } from "./store.js";
import { TREE_DEPTH, rootOf, siblings } from "./tree.js";

export interface Signer {
  address: Address;
  signTypedData(args: ReturnType<typeof seedTypedData>): Promise<Hex>;
  /** Used to join an association set. */
  signMessage?(message: string): Promise<Hex>;
  sendTransaction(args: { to: Address; value: bigint; data: Hex }): Promise<Hex>;
}

/** Runs the Groth16 prover. Browsers should pass one backed by a Web Worker. */
export interface Prover {
  prove(circuit: "withdraw" | "ragequit", input: Record<string, unknown>): Promise<{ proof: any; publicSignals: string[] }>;
}

export function fileProver(dir: string): Prover {
  return {
    prove: async (c, input) => {
      const snarkjs = await import("snarkjs");
      return snarkjs.groth16.fullProve(input, `${dir}/${c}_js/${c}.wasm`, `${dir}/${c}.zkey`);
    },
  };
}

export interface ConnectOptions {
  /** Chain reads. */
  rpc: string;
  /** The alt mempool node. */
  mempool: string;
  pool: Address;
  signer: Signer;
  prover: Prover;
  store?: InFlightStore;
  chainId?: number;
  /** Must match the validator's fee range, if the pool was built with one. */
  feeRange?: { min: bigint; max: bigint };
  /** Where to read the association set. Required when the pool has one. */
  asp?: AssociationSet;
}

/** The association set: labels approved by the ASP, and its root's recent-root reference. */
export interface AssociationSet {
  load(): Promise<{ labels: bigint[]; ref: RootRef }>;
}

export interface Note extends NoteSecrets {
  value: bigint;
  label: bigint;
  leafIndex: number;
  commitment: bigint;
  nullifierHash: bigint;
  spent: boolean;
  depositor: Address;
}

export interface WithdrawOptions {
  to: Address;
  amount: bigint;
  /** Require at least this many notes added after yours, enforced in the proof. */
  minAnon?: number;
  /** Spend this specific note instead of picking one. */
  note?: Note;
  maxFeePerGas?: bigint;
}

export interface WithdrawHandle {
  hash: Hex;
  nullifierHash: bigint;
  recipient: Address;
  amount: bigint;
  fee: bigint;
  proveMs: number;
  sentAt: number;
  /** Resolves once mined. Does not resend anything. */
  wait(): Promise<any>;
}

export interface FeeCaps {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export class SolvencyError extends Error {}
export class NullifierInFlightError extends Error {}
export class NotAdmittedError extends Error {}
export class NotApprovedError extends Error {}

/** Base-fee multiple for the default max fee: enough to survive a run of full blocks without a replacement. */
const FEE_HEADROOM = 10n;
/** The lowest default max fee: generous, because the unused part is refunded. Not a limit. */
const DEFAULT_MIN_MAX_FEE = 1_000_000_000n;
const PRIORITY_FEE = 1_000_000n;
/** Replacements must raise both fees by at least 10%. Slightly more, to survive integer rounding. */
const BUMP_PERCENT = 125n;
/** Generous fees mean a bump should be rare; a bump costs the pool reputation, so it is not the first response. */
const MIN_PENDING_BEFORE_BUMP_MS = 120_000;
const PREFLIGHT_RETRIES = 5;
const PREFLIGHT_RETRY_MS = 3_000;
const ZERO: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Smallest covering note if there is one, otherwise largest notes first until the amount is met. */
export function planPayment(notes: Note[], amount: bigint, k: bigint, leafCount: number, isPending: (n: Note) => boolean): { note: Note; amount: bigint }[] {
  const usable = notes.filter((n) => !n.spent && !isPending(n) && BigInt(n.leafIndex) + k <= BigInt(leafCount));
  const ascending = [...usable].sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  const single = ascending.find((n) => n.value >= amount);
  if (single) return [{ note: single, amount }];
  const plan: { note: Note; amount: bigint }[] = [];
  let left = amount;
  for (const note of ascending.reverse()) {
    if (left === 0n) break;
    const part = note.value < left ? note.value : left;
    plan.push({ note, amount: part });
    left -= part;
  }
  if (left > 0n) throw new Error("not enough available balance for that amount");
  return plan;
}

export class Relayless {
  private master?: bigint;
  private state?: PoolState;
  private store: InFlightStore;
  private rootSalt?: Hex;
  private aspSource?: Hex;
  private chainId = 0;

  private constructor(private o: ConnectOptions) {
    this.store = o.store ?? new MemoryStore();
  }

  static async connect(o: ConnectOptions): Promise<Relayless> {
    const rl = new Relayless(o);
    rl.chainId = o.chainId ?? Number(await rpc(o.rpc, "eth_chainId", []));
    rl.rootSalt = await rl.call("ROOT_SALT");
    rl.aspSource = await rl.call("ASP_SOURCE_ID");
    return rl;
  }

  private async call(functionName: "ROOT_SALT" | "ASP_SOURCE_ID" | "reserve" | "liabilities"): Promise<any> {
    return rpc(this.o.rpc, "eth_call", [{ to: this.o.pool, data: encodeFunctionData({ abi: POOL_ABI, functionName }) }, "latest"]);
  }

  /** Asks the wallet for the one signature everything derives from. Kept in memory only. */
  async unlock(): Promise<void> {
    if (this.master !== undefined) return;
    this.master = masterFromSignature(await this.o.signer.signTypedData(seedTypedData(this.chainId, this.o.pool)));
  }

  private get seed(): bigint {
    if (this.master === undefined) throw new Error("call unlock() first");
    return this.master;
  }

  async sync(): Promise<PoolState> {
    this.state = await fetchPoolState(this.o.rpc, this.o.pool);
    return this.state;
  }

  /** A receive-only address from the seed, holding 0 ETH until it is paid. */
  freshAddress(index: number): Address {
    return freshAccount(this.seed, index).address;
  }

  // ---- Deposit ----

  async deposit({ amount }: { amount: bigint }): Promise<{ hash: Hex; index: bigint }> {
    await this.unlock();
    const state = await this.sync();
    const index = this.nextDepositIndex(state);
    const data = encodeFunctionData({ abi: POOL_ABI, functionName: "deposit", args: [precommitment(depositSecrets(this.seed, index))] });
    const hash = await this.o.signer.sendTransaction({ to: this.o.pool, value: amount, data });
    return { hash, index };
  }

  private nextDepositIndex(state: PoolState): bigint {
    const known = new Set(state.deposits.map((d) => d.precommitment));
    let i = 0n;
    while (known.has(precommitment(depositSecrets(this.seed, i)))) i++;
    return i;
  }

  // ---- Recovery ----

  /** Rebuilds every note and its spent status from the chain and one signature. Nothing else is needed. */
  async notes(): Promise<Note[]> {
    await this.unlock();
    const state = await this.sync();
    const byPre = new Map(state.deposits.map((d) => [d.precommitment, d]));
    const notes: Note[] = [];
    let misses = 0;
    for (let i = 0n; misses < 20; i++) {
      const secrets = depositSecrets(this.seed, i);
      const d = byPre.get(precommitment(secrets));
      if (!d) {
        misses++;
        continue;
      }
      misses = 0;
      notes.push(...(await this.walk(state, { ...secrets, value: d.value, label: d.label, leafIndex: d.leafIndex, commitment: d.commitment, depositor: d.depositor })));
    }
    return notes;
  }

  /** Follows one note through its spends: each withdrawal shows the amount, which gives the change note's value. */
  private async walk(state: PoolState, start: Omit<Note, "spent" | "nullifierHash">): Promise<Note[]> {
    const out: Note[] = [];
    let cur = start;
    for (;;) {
      const nh = hashNullifier(cur.nullifier);
      const w = state.withdrawals.find((x) => x.nullifierHash === nh);
      const rq = state.ragequits.find((x) => x.nullifierHash === nh);
      out.push({ ...cur, nullifierHash: nh, spent: Boolean(w || rq) || (await this.isSpent(nh)) });
      if (!w) return out;
      const next = changeSecrets(this.seed, cur.nullifier);
      const value = cur.value - w.amount;
      const c = commitment(value, cur.label, precommitment(next));
      const leafIndex = state.leaves.indexOf(c);
      if (c !== w.changeCommitment || leafIndex < 0) return out;
      cur = { ...next, value, label: cur.label, leafIndex, commitment: c, depositor: cur.depositor };
    }
  }

  async isSpent(nh: bigint): Promise<boolean> {
    return BigInt(await rpc(this.o.rpc, "eth_getStorageAt", [NONCE_MANAGER, nonceSlot(this.o.pool, nh), "latest"])) !== 0n;
  }

  async balance(): Promise<bigint> {
    return (await this.notes()).filter((n) => !n.spent).reduce((s, n) => s + n.value, 0n);
  }

  // ---- Withdraw ----

  /** The latest root the pool has committed, with the slot a reference needs. */
  private async latestRootRef(state: PoolState): Promise<{ ref: RootRef; root: RootEvent }> {
    const root = state.roots[state.roots.length - 1];
    if (!root) throw new Error("the pool has no root yet: nothing has been deposited");
    const block = await rpc(this.o.rpc, "eth_getBlockByNumber", [`0x${root.blockNumber.toString(16)}`, false]);
    // A root written in slot S cannot be referenced until a later slot. Waiting costs at most a slot or two, and
    // keeps the newest root, which has the longest life left.
    const deadline = Date.now() + 60_000;
    for (;;) {
      const head = await rpc(this.o.rpc, "eth_getBlockByNumber", ["latest", false]);
      if (BigInt(head.slotNumber) > BigInt(block.slotNumber)) break;
      if (Date.now() > deadline) throw new Error("no new slot in 60s: the chain may be stalled");
      await new Promise((r) => setTimeout(r, 1000));
    }
    return {
      root,
      ref: {
        sourceId: keccak256(concat([this.o.pool, this.rootSalt!])),
        slot: BigInt(block.slotNumber),
        root: numberToHex(root.rootCommit, { size: 32 }),
      },
    };
  }

  /** Generous on purpose: a cap the base fee overtakes means a transaction admitted but never mined. */
  private async feeCaps(override?: bigint) {
    if (override) return { maxFeePerGas: override, maxPriorityFeePerGas: PRIORITY_FEE < override ? PRIORITY_FEE : override };
    const block = await rpc(this.o.rpc, "eth_getBlockByNumber", ["latest", false]);
    const baseFee = BigInt(block.baseFeePerGas);
    const range = this.o.feeRange;
    if (range && baseFee >= range.max) throw new Error("network fees are above what this pool accepts right now: try again later");
    const floor = range?.min ?? DEFAULT_MIN_MAX_FEE;
    const wanted = baseFee * FEE_HEADROOM + PRIORITY_FEE;
    const capped = range && wanted > range.max ? range.max : wanted;
    return { maxFeePerGas: capped > floor ? capped : floor, maxPriorityFeePerGas: PRIORITY_FEE };
  }

  /** What the transaction escrows from the pool at APPROVE. The fee must cover it. */
  private async maxCostOf(tx: FrameTx): Promise<bigint> {
    const sim = await rpc(this.o.rpc, "ethrex_simulateFrameTransaction", [rawOf(tx), "latest", { trace: false }]);
    return BigInt(sim.maxCost);
  }

  /** Refuses to send what the pool could not pay for. A dropped pending tx would cost the pool reputation. */
  async checkSolvency(maxCost: bigint, pay: bigint): Promise<void> {
    const balance = BigInt(await rpc(this.o.rpc, "eth_getBalance", [this.o.pool, "latest"]));
    if (balance < maxCost + pay) throw new SolvencyError(`the pool holds ${balance} wei but this withdrawal needs ${maxCost + pay} wei right now: try again shortly`);
  }

  private pickNote(notes: Note[], amount: bigint, k: bigint, state: PoolState): Note {
    const usable = notes
      .filter((n) => !n.spent && !this.store.get(n.nullifierHash))
      .filter((n) => n.value >= amount)
      .filter((n) => BigInt(n.leafIndex) + k <= BigInt(state.leaves.length));
    // The smallest note that covers it keeps large notes whole.
    usable.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
    if (usable.length) return usable[0];
    const covering = notes.filter((n) => !n.spent && n.value >= amount);
    if (covering.some((n) => this.store.get(n.nullifierHash))) throw new NullifierInFlightError("that note has a withdrawal pending: wait for it, or bump its fee");
    if (covering.length) throw new Error(`not enough notes after yours yet to meet minAnon ${k}: wait for more deposits, or lower minAnon`);
    throw new Error("no single note covers that amount: send several smaller payments");
  }

  /**
   * Pays any amount. If no single note covers it, the payment splits across notes as separate withdrawals, all pending
   * at once. Each is an independent proof, and the recipient sees several payments rather than one.
   */
  async pay(opts: { to: Address; amount: bigint; minAnon?: number }): Promise<WithdrawHandle[]> {
    await this.unlock();
    await this.settleInFlight();
    const k = BigInt(opts.minAnon ?? 0);
    const plan = planPayment(await this.notes(), opts.amount, k, this.state!.leaves.length, (n) => Boolean(this.store.get(n.nullifierHash)));
    const handles: WithdrawHandle[] = [];
    // One at a time: if a later part is refused, the earlier ones are already out, and the caller knows which.
    for (const part of plan) handles.push(await this.withdraw({ to: opts.to, amount: part.amount, note: part.note, minAnon: opts.minAnon }));
    return handles;
  }

  async withdraw(opts: WithdrawOptions): Promise<WithdrawHandle> {
    await this.unlock();
    await this.settleInFlight();
    const notes = await this.notes();
    const state = this.state!;
    const k = BigInt(opts.minAnon ?? 0);
    const note = opts.note ?? this.pickNote(notes, opts.amount, k, state);
    if (note.value < opts.amount) throw new Error("that note does not cover the amount");
    if (note.spent) throw new Error("that note is already spent");
    if (this.store.get(note.nullifierHash)) throw new NullifierInFlightError("that note has a withdrawal pending: wait for it, or bump its fee");
    return this.send(note, opts, k, state, await this.feeCaps(opts.maxFeePerGas));
  }

  /**
   * The only way a nullifier is ever sent twice: both fees up, same note, replacing the pending transaction.
   * Held back until the transaction has really been pending, because the sidecar counts each replacement against the
   * pool's reputation (see docs/reputation-analysis.md).
   */
  async bumpFee(handle: WithdrawHandle, { minPendingMs = MIN_PENDING_BEFORE_BUMP_MS }: { minPendingMs?: number } = {}): Promise<WithdrawHandle> {
    await this.unlock();
    const pending = this.store.get(handle.nullifierHash);
    if (!pending) throw new Error("nothing pending for that withdrawal");
    if (Date.now() - pending.sentAt < minPendingMs) throw new Error(`still within its first ${minPendingMs / 1000}s: give it time to land before bumping`);
    const notes = await this.notes();
    const note = notes.find((n) => n.nullifierHash === handle.nullifierHash);
    if (!note || note.spent) {
      this.store.delete(handle.nullifierHash);
      throw new Error("that withdrawal has already landed");
    }
    const caps = await this.feeCaps();
    const bump = (old: string, floor: bigint) => {
      const raised = (BigInt(old) * BUMP_PERCENT) / 100n;
      return raised > floor ? raised : floor;
    };
    const maxFeePerGas = bump(pending.maxFeePerGas, caps.maxFeePerGas);
    if (this.o.feeRange && maxFeePerGas > this.o.feeRange.max) throw new Error("this withdrawal has reached the pool's highest fee: it can only wait");
    return this.send(note, { to: handle.recipient, amount: handle.amount }, 0n, this.state!, {
      maxFeePerGas,
      maxPriorityFeePerGas: bump(pending.maxPriorityFeePerGas, caps.maxPriorityFeePerGas),
    });
  }

  private async send(note: Note, opts: WithdrawOptions, k: bigint, state: PoolState, caps: FeeCaps): Promise<WithdrawHandle> {
    const { tx, fee, proveMs } = await this.prepare(note, opts, k, state, caps);
    await this.preflight(tx);
    const hash = await this.submit(tx, note.nullifierHash, caps);
    return { hash, nullifierHash: note.nullifierHash, recipient: opts.to, amount: opts.amount, fee, proveMs, sentAt: Date.now(), wait: () => this.waitFor(hash, note.nullifierHash) };
  }

  /** Null if the pool has no association set. Throws a plain error if this note isn't in it. */
  private async aspWitness(label: bigint): Promise<{ ref: RootRef; index: number; siblings: bigint[] } | null> {
    if (BigInt(this.aspSource!) === 0n) return null;
    if (!this.o.asp) throw new Error("this pool needs an association set, and none was provided");
    const { labels, ref } = await this.o.asp.load();
    const index = labels.indexOf(label);
    if (index < 0) throw new NotApprovedError("this money isn't in the pool's approved set yet. You can get approved, or exit publicly back to the wallet that added it");
    return { ref, index, siblings: siblings(labels, index) };
  }

  /** Builds and proves a withdrawal without sending it. */
  async prepare(note: Note, opts: WithdrawOptions, k: bigint, state: PoolState, caps: FeeCaps): Promise<{ tx: FrameTx; fee: bigint; proveMs: number }> {
    const leaves = state.leaves;
    const { ref, root } = await this.latestRootRef(state);
    const treeLeaves = leaves.slice(0, root.leafCount);
    if (rootOf(treeLeaves) !== root.treeRoot) throw new Error("the local tree does not match the pool's root");

    const next = changeSecrets(this.seed, note.nullifier);
    const changeCommitment = commitment(note.value - opts.amount, note.label, precommitment(next));
    const asp = await this.aspWitness(note.label);
    const base = { pool: this.o.pool, chainId: this.chainId, recipient: opts.to, amount: opts.amount, changeCommitment, nullifierHash: note.nullifierHash, k, refs: asp ? [ref, asp.ref] : [ref], ...caps };

    // Fee = the most this can cost, rounded up. The unused part comes back to the recipient from frame 2.
    const fee = ((await this.maxCostOf(buildWithdrawal({ ...base, fee: opts.amount }, EMPTY_PROOF))) * 101n) / 100n;
    if (fee >= opts.amount) throw new Error(`the amount must be above the refundable gas deposit of ${fee} wei`);
    await this.checkSolvency(fee, opts.amount - fee);

    const params = { ...base, fee };
    const input = {
      rootCommit: BigInt(ref.root).toString(),
      nullifierHash: note.nullifierHash.toString(),
      changeCommitment: changeCommitment.toString(),
      withdrawnValue: opts.amount.toString(),
      sigHash: (BigInt(sigHashOf(buildWithdrawal(params, "0x"))) % R).toString(),
      k: k.toString(),
      aspRoot: asp ? BigInt(asp.ref.root).toString() : "0",
      value: note.value.toString(),
      label: note.label.toString(),
      nullifier: note.nullifier.toString(),
      secret: note.secret.toString(),
      newNullifier: next.nullifier.toString(),
      newSecret: next.secret.toString(),
      treeRoot: root.treeRoot.toString(),
      leafCount: root.leafCount.toString(),
      leafIndex: note.leafIndex.toString(),
      siblings: siblings(treeLeaves, note.leafIndex).map(String),
      aspIndex: asp ? asp.index.toString() : "0",
      aspSiblings: asp ? asp.siblings.map(String) : Array(TREE_DEPTH).fill("0"),
    };
    const t = Date.now();
    const { proof } = await this.o.prover.prove("withdraw", input);
    const proveMs = Date.now() - t;
    return { tx: buildWithdrawal(params, encodeProof(proof)), fee, proveMs };
  }

  /** Simulates first: a transaction that would fail must never be broadcast. */
  private async preflight(tx: FrameTx): Promise<void> {
    let sim = await rpc(this.o.rpc, "ethrex_simulateFrameTransaction", [rawOf(tx), "latest", { trace: false }]);
    // ethrex treats this one as transient, and a young chain can show it after the head has moved on. Nothing has been
    // broadcast, so waiting a few slots costs no reputation.
    for (let i = 0; i < PREFLIGHT_RETRIES && /not yet referenceable/.test(sim.executionError ?? ""); i++) {
      await new Promise((r) => setTimeout(r, PREFLIGHT_RETRY_MS));
      sim = await rpc(this.o.rpc, "ethrex_simulateFrameTransaction", [rawOf(tx), "latest", { trace: false }]);
    }
    if (sim.executionError) {
      const head = await rpc(this.o.rpc, "eth_getBlockByNumber", ["latest", false]);
      const refs = (tx as any).recentRootReferences?.map((r: RootRef) => r.slot).join(", ");
      throw new NotAdmittedError(`simulation failed, not broadcast: ${sim.executionError} (head slot ${BigInt(head.slotNumber)}, root slots ${refs})`);
    }
    // Frame 2 is only the refund: its failure costs nothing but the refund itself.
    const failed = (sim.frames ?? []).slice(0, 2).findIndex((f: any) => !f.succeeded);
    if (failed >= 0) throw new NotAdmittedError(`simulation failed at frame ${failed}, not broadcast`);
  }

  /** Sends once and records it. Never retries: if this throws, the transaction was refused, not lost. */
  private async submit(tx: FrameTx, nh: bigint, caps: FeeCaps): Promise<Hex> {
    let hash: Hex;
    try {
      hash = await rpc<Hex>(this.o.mempool, "eth_sendFrameTransaction", [toWire(tx)]);
    } catch (e) {
      if (e instanceof RpcError) throw new NotAdmittedError(e.message);
      throw e; // A network failure leaves the outcome unknown, so the caller must not assume it can resend.
    }
    this.store.set({ nullifierHash: nh.toString(), txHash: hash, sentAt: Date.now(), maxFeePerGas: caps.maxFeePerGas.toString(), maxPriorityFeePerGas: caps.maxPriorityFeePerGas.toString() });
    return hash;
  }

  private async waitFor(hash: Hex, nh: bigint, timeoutMs = 180_000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const receipt = await rpc(this.o.rpc, "eth_getTransactionReceipt", [hash]);
      if (receipt) {
        this.store.delete(nh);
        return receipt;
      }
      // A fee bump can replace this hash, and the nullifier landing is what matters.
      if (await this.isSpent(nh)) {
        this.store.delete(nh);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`not mined after ${timeoutMs / 1000}s: it stays pending, so use bumpFee rather than sending again`);
  }

  /** Clears ledger entries whose nullifier has landed. */
  private async settleInFlight(): Promise<void> {
    for (const e of this.store.all()) {
      if (await this.isSpent(BigInt(e.nullifierHash))) this.store.delete(BigInt(e.nullifierHash));
    }
  }

  // ---- Ragequit ----

  /** Public exit to the original depositor: reveals the note, needs no association set. */
  async ragequit(note: Note): Promise<WithdrawHandle> {
    await this.unlock();
    await this.settleInFlight();
    if (note.spent) throw new Error("that note is already spent");
    if (this.store.get(note.nullifierHash)) throw new NullifierInFlightError("that note has a withdrawal pending");
    const state = await this.sync();
    const { ref, root } = await this.latestRootRef(state);
    const treeLeaves = state.leaves.slice(0, root.leafCount);
    const caps = await this.feeCaps();
    const base = { pool: this.o.pool, chainId: this.chainId, label: note.label, value: note.value, nullifierHash: note.nullifierHash, ref, ...caps };
    const fee = ((await this.maxCostOf(buildRagequit({ ...base, fee: note.value }, EMPTY_PROOF))) * 101n) / 100n;
    if (fee >= note.value) throw new Error("this note is smaller than the gas deposit");
    await this.checkSolvency(fee, note.value - fee);
    const params = { ...base, fee };
    const t = Date.now();
    const { proof } = await this.o.prover.prove("ragequit", {
      rootCommit: BigInt(ref.root).toString(),
      nullifierHash: note.nullifierHash.toString(),
      label: note.label.toString(),
      value: note.value.toString(),
      sigHash: (BigInt(sigHashOf(buildRagequit(params, "0x"))) % R).toString(),
      nullifier: note.nullifier.toString(),
      secret: note.secret.toString(),
      treeRoot: root.treeRoot.toString(),
      leafCount: root.leafCount.toString(),
      leafIndex: note.leafIndex.toString(),
      siblings: siblings(treeLeaves, note.leafIndex).map(String),
    });
    const tx = buildRagequit(params, encodeProof(proof));
    await this.preflight(tx);
    const hash = await this.submit(tx, note.nullifierHash, caps);
    return { hash, nullifierHash: note.nullifierHash, recipient: note.depositor, amount: note.value, fee, proveMs: Date.now() - t, sentAt: Date.now(), wait: () => this.waitFor(hash, note.nullifierHash) };
  }

  // ---- Anonymity ----

  /** Fetches all deposits, never just the user's, so the query itself reveals nothing. */
  async anonymity({ amount, note }: { amount?: bigint; note?: Note } = {}): Promise<AnonymityReport> {
    const state = await this.sync();
    return anonymity({ state, amount, own: note ? { depositor: note.depositor, leafIndex: note.leafIndex } : undefined });
  }
}

/** A recent-root source id: the same derivation the EIP-8272 predeploy uses. */
export const sourceIdOf = (writer: Address, salt: Hex): Hex => keccak256(concat([writer, salt]));

export { parseEther, ZERO };
export const SENDER_LIMITS = LIMITS;
