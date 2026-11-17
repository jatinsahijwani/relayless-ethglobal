import test from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { RECENT_ROOT_WINDOW, allowlistProvider, checkRecentRoot, proofMatchesRoot, publishedSetProvider, recentRootKey, recentRootValue, rootFromProof, rootOf, siblings, type RootRef } from "../src/index.js";

// ---- Recent roots ----

// Real values read from the devnet's EIP-8272 predeploy, so a change to the layout would fail here.
const REAL = {
  source: "0xd333ec1ffaea9a00acda7f33ab1549cfc0bae5c144f81e02eead325db4450575" as Hex,
  slot: 584n,
  root: "0x0a9cf130fb309cad57f0a4a9039235db2f4a75962b81e247f6045de2b4e61b9b" as Hex,
  stored: "0x610d0427fcf36cef09fdd8967945ac741960404920f14f244977855f035361d0" as Hex,
};

test("recent root: storage layout matches a value read from the real predeploy", () => {
  assert.equal(recentRootValue(REAL.source, REAL.slot, REAL.root), REAL.stored);
});

const SOURCE = `0x${"d1".repeat(32)}` as Hex;
const ROOT = `0x${"ab".repeat(32)}` as Hex;
const REF: RootRef = { sourceId: SOURCE, slot: 100n, root: ROOT };

function fakeChain({ stored = recentRootValue(SOURCE, 100n, ROOT) as string, headSlot = 200n, down = false }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_: any, init: any) => {
    if (down) throw new TypeError("fetch failed");
    const { method, params } = JSON.parse(init.body);
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    if (method === "eth_getBlockByNumber") return reply({ slotNumber: `0x${headSlot.toString(16)}` });
    if (method === "eth_getStorageAt") {
      assert.equal(params[1], recentRootKey(SOURCE, 100n));
      return reply(stored);
    }
    throw new Error(`unexpected ${method}`);
  }) as any;
  return () => { globalThis.fetch = original; };
}

test("recent root: verified when the chain holds this root from this source at this slot", async () => {
  const restore = fakeChain({});
  try { assert.equal((await checkRecentRoot("http://node", REF)).status, "verified"); } finally { restore(); }
});

test("recent root: a root the chain doesn't hold is a mismatch", async () => {
  const restore = fakeChain({ stored: `0x${"00".repeat(32)}` });
  try { assert.equal((await checkRecentRoot("http://node", REF)).status, "mismatch"); } finally { restore(); }
});

test("recent root: a slot out of the window can't be confirmed, and is told apart from a mismatch", async () => {
  const restore = fakeChain({ stored: `0x${"00".repeat(32)}`, headSlot: 100n + RECENT_ROOT_WINDOW });
  try { assert.equal((await checkRecentRoot("http://node", REF)).status, "expired-slot"); } finally { restore(); }
});

test("recent root: no chain from here is reported as unreachable, never as verified", async () => {
  const restore = fakeChain({ down: true });
  try { assert.equal((await checkRecentRoot("http://node", REF)).status, "unreachable"); } finally { restore(); }
});

// ---- Membership proofs ----

test("membership: every position of odd and even sets gives a proof that reaches the root", () => {
  for (const n of [1, 2, 3, 5, 8, 13]) {
    const labels = Array.from({ length: n }, (_, i) => BigInt(100 + i));
    for (let i = 0; i < n; i++) assert.equal(rootFromProof(labels[i], i, siblings(labels, i)), rootOf(labels), `n=${n} i=${i}`);
  }
});

const LABELS = [5n, 77n, 9n];
const setRef: RootRef = { sourceId: SOURCE, slot: 7n, root: `0x${rootOf(LABELS).toString(16).padStart(64, "0")}` };
const provider = publishedSetProvider(async () => ({ sourceId: SOURCE, labels: LABELS, ref: setRef }));

test("membership: a published set gives a proof for a member, and null for anyone else", async () => {
  const p = await provider.membershipProof(77n);
  assert.ok(p && proofMatchesRoot(77n, p));
  assert.equal(p!.index, 1);
  assert.equal(await provider.membershipProof(78n), null);
  assert.equal(await provider.status(77n), "approved");
  assert.equal(await provider.status(78n), "unknown");
  assert.equal(await provider.sourceId(), SOURCE);
  assert.deepEqual(await provider.currentRoot(), setRef);
});

test("membership: a tampered proof, a wrong label or a wrong root is caught before proving", async () => {
  const p = (await provider.membershipProof(77n))!;
  assert.equal(proofMatchesRoot(78n, p), false);
  assert.equal(proofMatchesRoot(77n, { ...p, index: 0 }), false);
  assert.equal(proofMatchesRoot(77n, { ...p, siblings: p.siblings.slice(1) }), false);
  assert.equal(proofMatchesRoot(77n, { ...p, ref: { ...p.ref, root: ROOT } }), false);
});

test("membership: before any root, nothing is approved", async () => {
  const empty = publishedSetProvider(async () => ({ sourceId: SOURCE, labels: [], ref: null }));
  assert.equal(await empty.currentRoot(), null);
  assert.equal(await empty.membershipProof(5n), null);
  assert.equal(await empty.status(5n), "unknown");
});

test("allowlist provider: reads the reference server's /set, and asks for the whole set, never one label", async () => {
  const urls: string[] = [];
  const http = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ sourceId: SOURCE, labels: LABELS.map(String), ref: { sourceId: SOURCE, slot: "7", root: setRef.root } }));
  }) as any;
  const p = allowlistProvider("http://asp", http);
  const proof = await p.membershipProof(9n);
  assert.ok(proof && proofMatchesRoot(9n, proof));
  assert.equal(proof!.ref.slot, 7n);
  assert.ok(urls.every((u) => u === "http://asp/set"));
});

test("allowlist provider: a server error is reported, not read as an empty set", async () => {
  const p = allowlistProvider("http://asp", (async () => new Response("down", { status: 503 })) as any);
  await assert.rejects(p.membershipProof(5n), /couldn't read the pool's approved set/);
});
