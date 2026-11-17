import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { privateKeyToAccount } from "viem/accounts";
import { numberToHex, type Address, type Hex } from "viem";
import { allowlistProvider, proofMatchesRoot, rootOf } from "@relayless/sdk";
import { AspError, allowMessage, createAsp, emptyState, type AspState } from "../src/asp.js";
import { ASP_SALT, aspSourceOf } from "../src/chain.js";
import { handler } from "../src/server.js";

const POOL: Address = "0x00000000000000000000000000000000000000b1";
const alice = privateKeyToAccount(numberToHex(1n, { size: 32 }));
const bob = privateKeyToAccount(numberToHex(2n, { size: 32 }));
const stranger = privateKeyToAccount(numberToHex(3n, { size: 32 }));
const operator = privateKeyToAccount(numberToHex(4n, { size: 32 }));
const SOURCE = aspSourceOf(operator.address);

function setup() {
  const deposits = [{ depositor: alice.address, label: 11n }, { depositor: bob.address, label: 22n }, { depositor: alice.address, label: 33n }];
  const published: bigint[][] = [];
  const state: AspState = emptyState();
  let saves = 0;
  const asp = createAsp({
    pool: POOL,
    operator: operator.address,
    sourceId: SOURCE,
    chain: {
      deposits: async () => deposits,
      publish: async (labels) => (published.push(labels), { sourceId: SOURCE, slot: BigInt(published.length), root: numberToHex(rootOf(labels), { size: 32 }) }),
    },
    state,
    save: () => { saves++; },
  });
  return { asp, deposits, published, state, saves: () => saves };
}

const allow = async (asp: ReturnType<typeof setup>["asp"], depositors: Address[], signer = operator) => asp.allow({ depositors, signature: await signer.signMessage({ message: allowMessage(POOL, depositors) }) });
const refused = async (p: Promise<unknown>, code: string) => assert.rejects(p, (e: AspError) => e.code === code);

test("approving an address approves all of its deposits, in one root", async () => {
  const { asp, published } = setup();
  assert.deepEqual(await allow(asp, [alice.address]), { approved: true, labels: 2 });
  assert.deepEqual(published, [[11n, 33n]]);
  assert.deepEqual((await asp.set()).labels, ["11", "33"]);
});

test("a batch of addresses publishes one root", async () => {
  const { asp, published } = setup();
  await allow(asp, [alice.address, bob.address]);
  assert.deepEqual(published, [[11n, 22n, 33n]]);
});

test("a new deposit from an approved address is picked up, and an unchanged set isn't republished", async () => {
  const { asp, deposits, published } = setup();
  await allow(asp, [alice.address]);
  await asp.set();
  assert.equal(published.length, 1);
  deposits.push({ depositor: alice.address, label: 44n });
  assert.deepEqual((await asp.set()).labels, ["11", "33", "44"]);
  assert.equal(published.length, 2);
});

test("approving the same address twice is harmless", async () => {
  const { asp, published, state } = setup();
  await allow(asp, [alice.address]);
  await allow(asp, [alice.address]);
  assert.equal(published.length, 1);
  assert.deepEqual(state.approved, [alice.address]);
});

test("republish keeps the root alive with the same members", async () => {
  const { asp, published } = setup();
  await allow(asp, [alice.address]);
  await asp.republish();
  assert.equal(published.length, 2);
});

test("an address with no deposit can be approved, and appears once it deposits", async () => {
  const { asp, deposits, published } = setup();
  await allow(asp, [stranger.address]);
  assert.equal(published.length, 0);
  deposits.push({ depositor: stranger.address, label: 55n });
  assert.deepEqual((await asp.set()).labels, ["55"]);
});

test("only the operator can approve", async () => {
  const { asp, published } = setup();
  await refused(allow(asp, [alice.address], alice), "bad_signature");
  await refused(allow(asp, [alice.address], stranger), "bad_signature");
  assert.equal(published.length, 0);
});

test("a signature for one list can't approve another", async () => {
  const { asp } = setup();
  const signature = await operator.signMessage({ message: allowMessage(POOL, [alice.address]) });
  await refused(asp.allow({ depositors: [bob.address], signature }), "bad_signature");
  await refused(asp.allow({ depositors: [alice.address, bob.address], signature }), "bad_signature");
});

test("a signature for another pool can't approve on this one", async () => {
  const { asp } = setup();
  const signature = await operator.signMessage({ message: allowMessage("0x00000000000000000000000000000000000000b2", [alice.address]) });
  await refused(asp.allow({ depositors: [alice.address], signature }), "bad_signature");
});

test("malformed requests are refused", async () => {
  const { asp } = setup();
  await refused(asp.allow({}), "bad_request");
  await refused(asp.allow({ depositors: [], signature: "0x01" }), "bad_request");
  await refused(asp.allow({ depositors: ["not an address"], signature: "0x01" }), "bad_request");
  await refused(asp.allow({ depositors: [alice.address] }), "bad_request");
});

test("before anything is approved, the set is empty and has no root", async () => {
  const { asp } = setup();
  assert.deepEqual(await asp.set(), { sourceId: SOURCE, labels: [], ref: null });
});

test("the public config names the policy, operator and source, and nothing secret", () => {
  const { asp } = setup();
  assert.deepEqual(asp.config(), { policy: "allowlist", pool: POOL, operator: operator.address, sourceId: SOURCE });
});

test("the source id is keccak256(writer || salt), as the recent-root predeploy derives it", async () => {
  const { keccak256, concat } = await import("viem");
  assert.equal(SOURCE, keccak256(concat([operator.address, ASP_SALT])));
});

test("over HTTP, the SDK's reference provider reads this server and builds a proof that reaches its root", async () => {
  const { asp } = setup();
  await allow(asp, [alice.address]);
  const server = createServer(handler(asp, undefined));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const provider = allowlistProvider(url);
    assert.equal(await provider.sourceId(), SOURCE);
    const proof = await provider.membershipProof(33n);
    assert.ok(proof && proofMatchesRoot(33n, proof));
    assert.equal(await provider.status(33n), "approved");
    assert.equal(await provider.status(22n), "unknown");
    assert.equal(await provider.membershipProof(22n), null);
    const gone = await fetch(`${url}/join`, { method: "POST", body: "{}" });
    assert.equal(gone.status, 404);
  } finally {
    server.close();
  }
});

test("over HTTP, a bad body is refused without approving anything", async () => {
  const { asp, published } = setup();
  const server = createServer(handler(asp, undefined));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${url}/allow`, { method: "POST", body: "{not json" });
    assert.equal(res.status, 400);
    assert.equal(published.length, 0);
  } finally {
    server.close();
  }
});
