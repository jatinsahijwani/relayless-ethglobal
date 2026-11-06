import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ANNOUNCER_ABI, announceCall, aspSourceOf, crossCheckRoot, decodeRoles, deriveStealthPayment, dnsEncode, isMetaAddress, metaAddressOf, publishRootCall, recentRootKey, recentRootValue, REGISTRY_ROLES, RESOLVER_ROLES, RECENT_ROOT_WINDOW, scanAnnouncements, stealthAccount, stealthKeysFromSignature, stealthPrivateKey, type EnsConfig } from "../src/index.js";

const sig = (n: number) => `0x${n.toString(16).padStart(2, "0").repeat(65)}` as Hex;
const alice = stealthKeysFromSignature(sig(1));
const bob = stealthKeysFromSignature(sig(2));

// ---- Stealth ----

test("stealth: keys are stable, separate, and the record is ERC-5564 shaped", () => {
  assert.deepEqual(stealthKeysFromSignature(sig(1)), alice);
  assert.notEqual(alice.spendingPrivateKey, alice.viewingPrivateKey);
  assert.notEqual(alice.appKey, alice.viewingPrivateKey);
  assert.ok(isMetaAddress(metaAddressOf(alice)));
  assert.ok(!isMetaAddress("st:eth:0x1234"));
  assert.ok(!isMetaAddress("0x0000000000000000000000000000000000000001"));
  assert.ok(!isMetaAddress(null));
});

test("stealth: each payment gets a new address, and the recipient's key controls it", () => {
  const uri = metaAddressOf(alice);
  const a = deriveStealthPayment(uri);
  const b = deriveStealthPayment(uri);
  assert.notEqual(a.stealthAddress, b.stealthAddress);
  assert.notEqual(a.ephemeralPublicKey, b.ephemeralPublicKey);
  for (const p of [a, b]) assert.equal(stealthAccount(p.ephemeralPublicKey, alice).address, p.stealthAddress);
  assert.notEqual(privateKeyToAccount(stealthPrivateKey(a.ephemeralPublicKey, bob)).address, a.stealthAddress);
});

test("stealth: refuses a name that doesn't hold a meta-address", () => {
  assert.throws(() => deriveStealthPayment("0x0000000000000000000000000000000000000001"), /valid stealth meta-address/);
});

// A fake node: serves the given announcements, and can pretend some blocks lost their number lookup, as ethrex does.
function fakeNode(logs: any[], lostBlocks: number[] = [], head = 100) {
  const seen: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_: any, init: any) => {
    const { method, params } = JSON.parse(init.body);
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    if (method === "eth_blockNumber") return reply(`0x${head.toString(16)}`);
    if (method === "eth_getLogs") {
      seen.push(params[0]);
      const lo = Number(params[0].fromBlock), hi = Number(params[0].toBlock);
      if (lostBlocks.some((b) => b >= lo && b <= hi)) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "could not get header" } }));
      return reply(logs.filter((l) => Number(l.blockNumber) >= lo && Number(l.blockNumber) <= hi));
    }
    throw new Error(`unexpected ${method}`);
  }) as any;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

const ANNOUNCER: Address = "0x00000000000000000000000000000000000000aa";
function announcementLog(p: { stealthAddress: Address; ephemeralPublicKey: Hex; viewTag: Hex }, block: number, schemeId = 1n) {
  return {
    address: ANNOUNCER,
    blockNumber: `0x${block.toString(16)}`,
    transactionHash: `0x${block.toString(16).padStart(64, "0")}`,
    topics: encodeEventTopics({ abi: ANNOUNCER_ABI, eventName: "Announcement", args: { schemeId, stealthAddress: p.stealthAddress, caller: "0x00000000000000000000000000000000000000cc" } }),
    data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [p.ephemeralPublicKey, p.viewTag]),
  };
}

test("scan: finds exactly the recipient's payments, and fetches everyone's so the node can't tell which", async () => {
  const mine1 = deriveStealthPayment(metaAddressOf(alice));
  const mine2 = deriveStealthPayment(metaAddressOf(alice));
  const theirs = deriveStealthPayment(metaAddressOf(bob));
  const node = fakeNode([announcementLog(mine1, 10), announcementLog(theirs, 20), announcementLog(mine2, 30)]);
  try {
    const a = await scanAnnouncements("http://node", ANNOUNCER, alice);
    assert.deepEqual(a.received.map((r) => r.stealthAddress), [mine1.stealthAddress, mine2.stealthAddress]);
    assert.equal(a.scanned, 3);
    assert.deepEqual(a.unreadableBlocks, []);
    const b = await scanAnnouncements("http://node", ANNOUNCER, bob);
    assert.deepEqual(b.received.map((r) => r.stealthAddress), [theirs.stealthAddress]);
    // The filter names the event only: no recipient, stealth address or view tag.
    assert.equal(node.seen[0].topics.filter(Boolean).length, 1);
  } finally { node.restore(); }
});

test("scan: a viewing key alone is enough to find a payment", async () => {
  const p = deriveStealthPayment(metaAddressOf(alice));
  const node = fakeNode([announcementLog(p, 10)]);
  try {
    const r = await scanAnnouncements("http://node", ANNOUNCER, { viewingPrivateKey: alice.viewingPrivateKey, spendingPublicKey: alice.spendingPublicKey });
    assert.equal(r.received.length, 1);
  } finally { node.restore(); }
});

test("scan: junk announcements can't stop a scan", async () => {
  const p = deriveStealthPayment(metaAddressOf(alice));
  const badKey = { ...p, ephemeralPublicKey: `0x05${"11".repeat(32)}` as Hex };
  const shortKey = { ...p, ephemeralPublicKey: "0x1234" as Hex };
  const noTag = { ...p, viewTag: "0x" as Hex };
  const node = fakeNode([announcementLog(badKey, 1), announcementLog(shortKey, 2), announcementLog(noTag, 3), announcementLog(p, 4, 2n), announcementLog(p, 5)]);
  try {
    const r = await scanAnnouncements("http://node", ANNOUNCER, alice);
    assert.equal(r.received.length, 1);
    assert.equal(r.received[0].blockNumber, 5);
  } finally { node.restore(); }
});

test("scan: reads around lost blocks and says which ones it couldn't read", async () => {
  const p = deriveStealthPayment(metaAddressOf(alice));
  const node = fakeNode([announcementLog(p, 40)], [50, 51]);
  try {
    const r = await scanAnnouncements("http://node", ANNOUNCER, alice);
    assert.equal(r.received.length, 1);
    assert.deepEqual(r.unreadableBlocks, [50, 51]);
  } finally { node.restore(); }
});

test("announcement carries the view tag as its first metadata byte", () => {
  const p = deriveStealthPayment(metaAddressOf(alice));
  const { args } = decodeFunctionData({ abi: ANNOUNCER_ABI, data: announceCall(p) });
  assert.deepEqual(args, [1n, p.stealthAddress, p.ephemeralPublicKey, p.viewTag]);
  assert.equal(p.viewTag.length, 4);
});

// ---- Root cross-check ----

// Real values read from the running devnet's EIP-8272 predeploy, so a change to the layout would fail here.
const REAL = {
  source: "0xd333ec1ffaea9a00acda7f33ab1549cfc0bae5c144f81e02eead325db4450575" as Hex,
  slot: 584n,
  root: "0x0a9cf130fb309cad57f0a4a9039235db2f4a75962b81e247f6045de2b4e61b9b" as Hex,
  stored: "0x610d0427fcf36cef09fdd8967945ac741960404920f14f244977855f035361d0" as Hex,
};

test("cross-check: storage layout matches a value read from the real predeploy", () => {
  assert.equal(recentRootValue(REAL.source, REAL.slot, REAL.root), REAL.stored);
});

const OPERATOR: Address = "0x00000000000000000000000000000000000000dd";
const SALT = "relayless.asp";
const SOURCE = aspSourceOf(OPERATOR, SALT);
const ROOT = `0x${"ab".repeat(32)}` as Hex;
const POOL: Address = "0x00000000000000000000000000000000000000ee";
const asp = { root: ROOT, slot: 100n, pool: POOL, operator: OPERATOR };

function fakeChain({ poolSource = SOURCE as string, stored = recentRootValue(SOURCE, 100n, ROOT) as string, headSlot = 200n, down = false }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_: any, init: any) => {
    if (down) throw new TypeError("fetch failed");
    const { method, params } = JSON.parse(init.body);
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    if (method === "eth_call") return reply(poolSource);
    if (method === "eth_getBlockByNumber") return reply({ slotNumber: `0x${headSlot.toString(16)}` });
    if (method === "eth_getStorageAt") {
      assert.equal(params[1], recentRootKey(SOURCE, 100n));
      return reply(stored);
    }
    throw new Error(`unexpected ${method}`);
  }) as any;
  return () => { globalThis.fetch = original; };
}
const check = (extra: object = {}) => crossCheckRoot(asp, { rpc: "http://node", saltPreimage: SALT, ...extra });

test("cross-check: verified when the pool's chain holds this root from this operator", async () => {
  const restore = fakeChain({});
  try { assert.equal((await check()).status, "verified"); } finally { restore(); }
});

test("cross-check: a root the chain doesn't hold is a mismatch", async () => {
  const restore = fakeChain({ stored: `0x${"00".repeat(32)}` });
  try { assert.equal((await check()).status, "mismatch"); } finally { restore(); }
});

test("cross-check: a name whose operator isn't the pool's ASP is flagged, even with a valid root", async () => {
  const restore = fakeChain({ poolSource: `0x${"99".repeat(32)}` });
  try { assert.equal((await check()).status, "wrong-operator"); } finally { restore(); }
});

test("cross-check: a pool address with no contract is flagged", async () => {
  const restore = fakeChain({ poolSource: "0x" });
  try { assert.equal((await check()).status, "wrong-operator"); } finally { restore(); }
});

test("cross-check: a slot out of the window can't be confirmed, and is told apart from a mismatch", async () => {
  const restore = fakeChain({ stored: `0x${"00".repeat(32)}`, headSlot: 100n + RECENT_ROOT_WINDOW });
  try { assert.equal((await check()).status, "expired-slot"); } finally { restore(); }
});

test("cross-check: a server already on a newer root is stale, not forged", async () => {
  const restore = fakeChain({});
  try { assert.equal((await check({ serverRoot: `0x${"cd".repeat(32)}` })).status, "stale"); } finally { restore(); }
});

test("cross-check: no chain from here is reported as unverified, never as passing", async () => {
  const restore = fakeChain({ down: true });
  try { assert.equal((await check()).status, "devnet-unreachable"); } finally { restore(); }
});

test("cross-check: an ASP with no published root says so", async () => {
  assert.equal((await crossCheckRoot({ ...asp, root: null }, { rpc: "http://node", saltPreimage: SALT })).status, "no-root");
});

// ---- Encoding ----

test("dnsEncode matches the wire format", () => {
  assert.equal(dnsEncode("alice.relayless.eth"), "0x05616c6963650972656c61796c6573730365746800");
});

test("role bitmaps decode to names, admin roles included", () => {
  assert.deepEqual(decodeRoles((1n << 4n) | ((1n << 4n) << 128n), RESOLVER_ROLES), ["SET_TEXT", "SET_TEXT_ADMIN"]);
  assert.deepEqual(decodeRoles((1n << 0n) | (1n << 16n), REGISTRY_ROLES), ["REGISTRAR", "RENEW"]);
  assert.deepEqual(decodeRoles((1n << 28n) << 128n, REGISTRY_ROLES), ["CAN_TRANSFER_ADMIN"]);
});

test("publishing writes root and slot in one call", () => {
  const cfg = { recordKeys: { aspRoot: "asp.root", aspSlot: "asp.slot" } } as EnsConfig;
  const abi = parseAbi(["function multicall(bytes[] calls)", "function setText(bytes name, string key, string value)"]);
  const { args } = decodeFunctionData({ abi, data: publishRootCall(cfg, "world.asp.relayless.eth", ROOT, 7n) });
  const writes = (args![0] as Hex[]).map((c) => decodeFunctionData({ abi, data: c }).args);
  assert.deepEqual(writes, [[dnsEncode("world.asp.relayless.eth"), "asp.root", ROOT], [dnsEncode("world.asp.relayless.eth"), "asp.slot", "7"]]);
});
