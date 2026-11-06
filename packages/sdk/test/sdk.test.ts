import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { POOL_ABI, fetchPoolState, nonceSettled, anonymity, planPayment, depositSecrets, changeSecrets, masterFromSignature, nonceSlot, MemoryStore, siblings, rootOf, TREE_DEPTH, type Note } from "../src/index.js";
import type { PoolState, DepositEvent } from "../src/chain.js";

const A = "0x00000000000000000000000000000000000000a1" as const;
const deposit = (i: number, value: bigint, depositor: `0x${string}` = `0x${(i + 16).toString(16).padStart(40, "0")}`, blockNumber = 100): DepositEvent => ({ depositor, label: BigInt(i), value, precommitment: BigInt(i + 1), commitment: BigInt(i + 100), leafIndex: i, blockNumber, txHash: "0x" });
const stateOf = (deposits: DepositEvent[]): PoolState => ({ deposits, leaves: deposits.map((d) => d.commitment), withdrawals: [], ragequits: [], roots: [] });

test("meter: n equal deposits give log2(n) bits on both measures", () => {
  const r = anonymity({ state: stateOf(Array.from({ length: 8 }, (_, i) => deposit(i, 10n))) });
  assert.equal(r.setSize, 8);
  assert.ok(Math.abs(r.shannonBits - 3) < 1e-9);
  assert.ok(Math.abs(r.minEntropyBits - 3) < 1e-9);
  assert.ok(Math.abs(r.effectiveSetSize - 8) < 1e-9);
});

test("meter: min-entropy never exceeds Shannon, and an outlier lowers it", () => {
  const ds = Array.from({ length: 8 }, (_, i) => deposit(i, 100n));
  ds[0] = deposit(0, 10n);
  const r = anonymity({ state: stateOf(ds), amount: 10n });
  assert.ok(r.minEntropyBits <= r.shannonBits + 1e-9);
  assert.ok(r.minEntropyBits < Math.log2(8));
});

test("meter: deposits too small to cover the amount are excluded", () => {
  const r = anonymity({ state: stateOf([deposit(0, 5n), deposit(1, 50n), deposit(2, 60n)]), amount: 40n });
  assert.equal(r.setSize, 2);
});

test("meter: older deposits are less suspicious", () => {
  const r = anonymity({ state: stateOf([deposit(0, 10n, undefined, 0), deposit(1, 10n, undefined, 7200)]), atBlock: 7200 });
  const p = Object.fromEntries(r.candidates.map((c) => [c.leafIndex, c.p]));
  assert.ok(p[1] > p[0]);
});

test("meter: a reused address and a labeled address stand out, with advice", () => {
  const ds = [deposit(0, 10n, A), deposit(1, 10n, A), deposit(2, 10n), deposit(3, 10n)];
  const reused = anonymity({ state: stateOf(ds), own: { depositor: A } });
  assert.ok(reused.advice.some((a) => /several times from one address/.test(a)));
  const labeled = anonymity({ state: stateOf([deposit(0, 10n, A), deposit(1, 10n), deposit(2, 10n)]), labels: new Set([A]), own: { depositor: A } });
  assert.ok(labeled.advice.some((a) => /labeled/.test(a)));
  assert.ok(labeled.minEntropyBits < Math.log2(3));
});

test("meter: advice always names an action, including for an empty pool", () => {
  assert.match(anonymity({ state: stateOf([]), amount: 1n }).advice[0], /Lower the amount or wait/);
  assert.match(anonymity({ state: stateOf([deposit(0, 10n)]) }).advice[0], /Wait for about 31 more deposits/);
});

test("keys: deterministic from the signature, and every note gets distinct secrets", () => {
  const sig = `0x${"ab".repeat(65)}` as const;
  const m = masterFromSignature(sig);
  assert.equal(m, masterFromSignature(sig));
  assert.notEqual(m, masterFromSignature(`0x${"ac".repeat(65)}`));
  const d = depositSecrets(m, 0n);
  assert.deepEqual(d, depositSecrets(m, 0n));
  const all = [d.nullifier, d.secret, depositSecrets(m, 1n).nullifier, changeSecrets(m, d.nullifier).nullifier, changeSecrets(m, d.nullifier).secret];
  assert.equal(new Set(all).size, all.length);
});

test("nonce slot matches keccak(pad32(sender) || key)", () => {
  assert.equal(nonceSlot("0x0000000000000000000000000000000000000001", 1n).length, 66);
  assert.notEqual(nonceSlot(A, 1n), nonceSlot(A, 2n));
});

test("tree: siblings are positional and padded to the circuit's depth", () => {
  const s = siblings([1n, 2n, 3n, 4n, 5n], 4);
  assert.equal(s.length, TREE_DEPTH);
  assert.equal(s[0], 0n);
  assert.equal(s[1], 0n);
  assert.notEqual(s[2], 0n);
  assert.equal(rootOf([7n]), 7n);
});

test("in-flight store tracks one entry per nullifier", () => {
  const st = new MemoryStore();
  st.set({ nullifierHash: "5", txHash: "0x", sentAt: 1, maxFeePerGas: "1", maxPriorityFeePerGas: "1" });
  assert.ok(st.get(5n));
  st.delete(5n);
  assert.equal(st.get(5n), undefined);
});

const note = (leafIndex: number, value: bigint, spent = false) => ({ leafIndex, value, spent, nullifierHash: BigInt(leafIndex) } as unknown as Note);

test("pay: picks the smallest note that covers it", () => {
  const plan = planPayment([note(0, 10n), note(1, 5n), note(2, 7n)], 6n, 0n, 3, () => false);
  assert.deepEqual(plan.map((p) => [p.note.leafIndex, p.amount]), [[2, 6n]]);
});

test("pay: splits across notes, largest first, when no single note covers it", () => {
  const plan = planPayment([note(0, 10n), note(1, 5n), note(2, 7n)], 15n, 0n, 3, () => false);
  assert.deepEqual(plan.map((p) => [p.note.leafIndex, p.amount]), [[0, 10n], [2, 5n]]);
});

test("pay: skips spent notes, pending notes and notes failing the k-gate", () => {
  const notes = [note(0, 10n, true), note(1, 5n), note(2, 7n)];
  assert.deepEqual(planPayment(notes, 3n, 0n, 3, (n) => n.leafIndex === 1).map((p) => p.note.leafIndex), [2]);
  assert.throws(() => planPayment(notes, 3n, 2n, 3, () => false).length && planPayment(notes, 20n, 0n, 3, () => false), /not enough available balance/);
  assert.deepEqual(planPayment(notes, 3n, 2n, 3, () => false).map((p) => p.note.leafIndex), [1]);
});

// A fake node for fetchPoolState: serves logs, and errors for any range touching `holes`, as ethrex does.
function fakeNode(logsByBlock: Record<number, any[]>, holes: number[], head: number) {
  const original = globalThis.fetch;
  const calls: [number, number][] = [];
  globalThis.fetch = (async (_: string, init: any) => {
    const { method, params } = JSON.parse(init.body);
    const reply = (body: object) => ({ json: async () => ({ jsonrpc: "2.0", id: 1, ...body }) });
    if (method === "eth_blockNumber") return reply({ result: `0x${head.toString(16)}` });
    const lo = Number(params[0].fromBlock);
    const hi = Number(params[0].toBlock);
    calls.push([lo, hi]);
    const hole = holes.find((h) => h >= lo && h <= hi);
    if (hole !== undefined) return reply({ error: { code: -32603, message: `Internal Error: Could not get header for block ${hole}` } });
    const result = Object.entries(logsByBlock).filter(([b]) => Number(b) >= lo && Number(b) <= hi).flatMap(([, l]) => l);
    return reply({ result });
  }) as any;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

const leafLog = (index: bigint, commitment: bigint, block: number) => ({
  data: encodeAbiParameters([{ type: "uint256" }], [commitment]),
  topics: encodeEventTopics({ abi: POOL_ABI, eventName: "LeafInserted", args: { leafIndex: index } }),
  blockNumber: `0x${block.toString(16)}`,
  transactionHash: "0x01",
});

test("fetchPoolState: reads around blocks the node can't serve", async () => {
  const node = fakeNode({ 10: [leafLog(0n, 111n, 10)], 90: [leafLog(1n, 222n, 90)] }, [49, 50, 51], 100);
  try {
    const s = await fetchPoolState("http://node", A);
    assert.deepEqual(s.leaves, [111n, 222n]);
    assert.ok(node.calls.length > 1);
  } finally {
    node.restore();
  }
});

test("fetchPoolState: fails loudly when a gap hid one of the pool's leaves", async () => {
  // Leaf 1 is in a block the node can't serve, so leaf 2 leaves a gap behind it.
  const node = fakeNode({ 10: [leafLog(0n, 111n, 10)], 50: [leafLog(1n, 222n, 50)], 90: [leafLog(2n, 333n, 90)] }, [50], 100);
  try {
    await assert.rejects(fetchPoolState("http://node", A), /missing pool data \(leaf 1\)/);
  } finally {
    node.restore();
  }
});

test("fetchPoolState: other node errors are not swallowed", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_: string, init: any) => {
    const { method } = JSON.parse(init.body);
    const body = method === "eth_blockNumber" ? { result: "0x10" } : { error: { code: -32000, message: "rate limited" } };
    return { json: async () => ({ jsonrpc: "2.0", id: 1, ...body }) };
  }) as any;
  try {
    await assert.rejects(fetchPoolState("http://node", A), /rate limited/);
  } finally {
    globalThis.fetch = original;
  }
});

test("nonceSettled: returns at once for a frame transaction, which has no account nonce", async () => {
  const original = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (async (_: string, init: any) => {
    const { method } = JSON.parse(init.body);
    methods.push(method);
    return { json: async () => ({ jsonrpc: "2.0", id: 1, result: { hash: "0x01", from: A, type: "0x6" } }) };
  }) as any;
  try {
    await nonceSettled("http://node", "0x01");
    assert.deepEqual(methods, ["eth_getTransactionByHash"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("nonceSettled: waits until the account nonce has moved past a normal transaction", async () => {
  const original = globalThis.fetch;
  let counts = 0;
  globalThis.fetch = (async (_: string, init: any) => {
    const { method } = JSON.parse(init.body);
    const result = method === "eth_getTransactionByHash" ? { from: A, nonce: "0x5" } : ++counts <= 2 ? "0x5" : "0x6";
    return { json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  }) as any;
  try {
    await nonceSettled("http://node", "0x01");
    assert.ok(counts >= 4);
  } finally {
    globalThis.fetch = original;
  }
});
