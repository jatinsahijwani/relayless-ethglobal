import test from "node:test";
import assert from "node:assert/strict";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { privateKeyToAccount } from "viem/accounts";
import { numberToHex, type Address } from "viem";
import { AspError, createAsp, emptyState, joinMessage, type AspState } from "../src/asp.js";
import { realWorld } from "../src/world.js";
import { directoryQueue } from "../src/directory.js";

const POOL: Address = "0x00000000000000000000000000000000000000b1";
const alice = privateKeyToAccount(numberToHex(1n, { size: 32 }));
const bob = privateKeyToAccount(numberToHex(2n, { size: 32 }));
const stranger = privateKeyToAccount(numberToHex(3n, { size: 32 }));

function setup({ verify = true, world = true, directory }: { verify?: boolean; world?: boolean; directory?: { publish(ref: { root: `0x${string}`; slot: bigint }): void } } = {}) {
  const deposits = [{ depositor: alice.address, label: 11n }, { depositor: bob.address, label: 22n }, { depositor: alice.address, label: 33n }];
  const published: bigint[][] = [];
  const state: AspState = emptyState();
  let verifyCalls = 0;
  const asp = createAsp({
    pool: POOL,
    action: "join-approved-set",
    environment: "production",
    appId: world ? "app_test" : null,
    world: world ? { rpContext: () => ({ rp_id: "rp", nonce: "n", created_at: 1, expires_at: 2, signature: "s" }), verify: async () => (verifyCalls++, verify) } : null,
    chain: { deposits: async () => deposits, publish: async (labels) => (published.push(labels), { sourceId: "0x01", slot: 5n, root: "0x02" }) },
    state,
    save: () => {},
    directory,
  });
  return { asp, deposits, published, state, calls: () => verifyCalls };
}

const proof = (address: Address, nullifier = "0x10", extra: object = {}) => ({ environment: "production", responses: [{ signal_hash: hashSignal(address), nullifier, ...extra }] });
const join = async (asp: any, who: typeof alice, result: any) => asp.join({ depositor: who.address, signature: await who.signMessage({ message: joinMessage(POOL, who.address) }), result });
const refused = async (p: Promise<unknown>, code: string) => assert.rejects(p, (e: AspError) => e.code === code);

test("a verified human joins, and all of that address's deposits are approved", async () => {
  const { asp, published } = setup();
  assert.deepEqual(await join(asp, alice, proof(alice.address)), { approved: true, labels: 2 });
  assert.deepEqual(published, [[11n, 33n]]);
  assert.deepEqual((await asp.set()).labels, ["11", "33"]);
});

test("a new deposit from a member is picked up, and an unchanged set isn't republished", async () => {
  const { asp, deposits, published } = setup();
  await join(asp, alice, proof(alice.address));
  await asp.set();
  assert.equal(published.length, 1);
  deposits.push({ depositor: alice.address, label: 44n });
  assert.deepEqual((await asp.set()).labels, ["11", "33", "44"]);
  assert.equal(published.length, 2);
});

test("republish keeps the root alive with the same members", async () => {
  const { asp, published } = setup();
  await join(asp, alice, proof(alice.address));
  await asp.republish();
  assert.equal(published.length, 2);
});

test("a proof made for another address is refused, before calling World", async () => {
  const { asp, calls } = setup();
  await refused(join(asp, bob, proof(alice.address)), "signal_mismatch");
  assert.equal(calls(), 0);
});

test("a proof with no signal hash fails closed", async () => {
  const { asp } = setup();
  await refused(join(asp, alice, { environment: "production", responses: [{ nullifier: "0x10" }] }), "signal_mismatch");
});

test("one human can't approve a second address, even writing the nullifier differently", async () => {
  const { asp } = setup();
  await join(asp, alice, proof(alice.address, "0x10"));
  await refused(join(asp, bob, proof(bob.address, "16")), "already_used");
});

test("two simultaneous joins with one nullifier: only one succeeds", async () => {
  const { asp, state } = setup();
  const results = await Promise.allSettled([join(asp, alice, proof(alice.address)), join(asp, bob, proof(bob.address))]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(Object.keys(state.members).length, 1);
});

test("joining again with the same human and address is harmless", async () => {
  const { asp, published } = setup();
  await join(asp, alice, proof(alice.address));
  await join(asp, alice, proof(alice.address));
  assert.equal(published.length, 1);
});

test("World rejecting the proof approves nothing", async () => {
  const { asp, state, published } = setup({ verify: false });
  await refused(join(asp, alice, proof(alice.address)), "verification_failed");
  assert.deepEqual(state.members, {});
  assert.equal(published.length, 0);
});

test("the wrong environment is refused, so staging proofs can't pass in production", async () => {
  const { asp, calls } = setup();
  await refused(join(asp, alice, { ...proof(alice.address), environment: "staging" }), "wrong_environment");
  assert.equal(calls(), 0);
});

test("a signature from someone else is refused", async () => {
  const { asp } = setup();
  const signature = await bob.signMessage({ message: joinMessage(POOL, alice.address) });
  await refused(asp.join({ depositor: alice.address, signature, result: proof(alice.address) }), "bad_signature");
});

test("an address with no deposit is ineligible", async () => {
  const { asp } = setup();
  await refused(join(asp, stranger, proof(stranger.address)), "no_deposit");
});

test("malformed requests are refused", async () => {
  const { asp } = setup();
  await refused(asp.join({}), "bad_request");
  await refused(join(asp, alice, { environment: "production", responses: [] }), "bad_request");
  await refused(join(asp, alice, { environment: "production", responses: [{ signal_hash: hashSignal(alice.address) }] }), "bad_request");
});

test("with no World ID configured, joining answers clearly and the rest still works", async () => {
  const { asp } = setup({ world: false });
  assert.equal(asp.config().enabled, false);
  await refused(join(asp, alice, proof(alice.address)), "world_not_configured");
  assert.throws(() => asp.rpContext(), (e: AspError) => e.code === "world_not_configured");
  assert.deepEqual((await asp.set()).labels, []);
});

test("the public config never contains the signing key", () => {
  const { asp } = setup();
  assert.deepEqual(Object.keys(asp.config()).sort(), ["action", "app_id", "enabled", "environment"]);
});

test("real client: posts to World's v4 endpoint and requires success in the right environment", async () => {
  const seen: { url: string; body: any }[] = [];
  const answer = (body: object, ok = true) => (async (url: string, init: any) => (seen.push({ url, body: JSON.parse(init.body) }), { ok, json: async () => body })) as any;
  const cfg = { rpId: "rp_abc", signingKey: "0x" + "11".repeat(32), action: "a", environment: "production" };
  assert.equal(await realWorld(cfg, answer({ success: true, environment: "production" })).verify({ x: 1 }), true);
  assert.equal(seen[0].url, "https://developer.world.org/api/v4/verify/rp_abc");
  assert.equal(seen[0].body.x, 1);
  assert.equal(await realWorld(cfg, answer({ success: true, environment: "staging" })).verify({}), false);
  assert.equal(await realWorld(cfg, answer({ success: false, environment: "production" })).verify({}), false);
  assert.equal(await realWorld(cfg, answer({}, false)).verify({}), false);
});

test("real client: signs an rp_context locally", () => {
  const c = realWorld({ rpId: "rp_abc", signingKey: "0x" + "11".repeat(32), action: "a", environment: "production" }).rpContext();
  assert.equal(c.rp_id, "rp_abc");
  assert.ok(c.signature && c.nonce && c.expires_at > c.created_at);
});

// ---- Publishing to ENS ----

const ref = (n: number) => ({ root: `0x${String(n).padStart(64, "0")}` as `0x${string}`, slot: BigInt(n) });

test("an approved set is told to the directory once the chain has it, and an unchanged set isn't", async () => {
  const told: unknown[] = [];
  const { asp } = setup({ directory: { publish: (r) => told.push(r) } });
  await join(asp, alice, proof(alice.address));
  assert.deepEqual(told, [{ root: "0x02", slot: 5n }]);
  await asp.set();
  assert.equal(told.length, 1);
});

test("the recent-root refresh also reaches the directory, because an old slot can no longer be checked", async () => {
  const told: unknown[] = [];
  const { asp } = setup({ directory: { publish: (r) => told.push(r) } });
  await join(asp, alice, proof(alice.address));
  await asp.republish();
  assert.equal(told.length, 2);
});

test("a Sepolia outage doesn't touch joining: it still approves, and the error is only logged", async () => {
  const errors: unknown[] = [];
  const directory = directoryQueue(async () => { throw new Error("sepolia is down"); }, (e) => errors.push(e));
  const { asp } = setup({ directory });
  assert.deepEqual(await join(asp, alice, proof(alice.address)), { approved: true, labels: 2 });
  await directory.settled();
  assert.equal(errors.length, 1);
});

test("a slow Sepolia doesn't hold up joining", async () => {
  let release = () => {};
  const directory = directoryQueue(() => new Promise<void>((r) => { release = r; }), () => {});
  const { asp } = setup({ directory });
  assert.deepEqual(await join(asp, alice, proof(alice.address)), { approved: true, labels: 2 });
  release();
  await directory.settled();
});

test("directory queue: one at a time, and only the newest of a burst goes out", async () => {
  const sent: bigint[] = [];
  const gates: (() => void)[] = [];
  const q = directoryQueue((r) => new Promise<void>((res) => { sent.push(r.slot); gates.push(res); }), () => {});
  q.publish(ref(1));
  q.publish(ref(2));
  q.publish(ref(3));
  assert.deepEqual(sent, [1n]);
  gates[0]();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [1n, 3n]);
  gates[1]();
  await q.settled();
  assert.deepEqual(sent, [1n, 3n]);
});

test("directory queue: keeps working after a failure", async () => {
  const sent: bigint[] = [];
  let fail = true;
  const q = directoryQueue(async (r) => {
    if (fail) { fail = false; throw new Error("once"); }
    sent.push(r.slot);
  }, () => {});
  q.publish(ref(1));
  await q.settled();
  q.publish(ref(2));
  await q.settled();
  assert.deepEqual(sent, [2n]);
});
