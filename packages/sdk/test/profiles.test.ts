import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, getAddress, keccak256, type Address, type Hex } from "viem";
import * as lib from "@forshtat/hegota-support/tx";
import type { FrameTx } from "@forshtat/hegota-support/tx";
import { encodeEnvelope, sigHash as hegotaSigHash } from "../src/codec-hegota.js";
import { PROFILES, profileOf } from "../src/profiles.js";
import { EMPTY_PROOF, EMPTY_WITHDRAW_PROOF, LIMITS, buildRagequit, buildWithdrawal, encodeRootTuples, rawOf, refsOf, sigHashOf, txHashOf, verifyIndex } from "../src/frame.js";
import { POOL_ABI } from "../src/chain.js";
import { DEVNET_TRACER } from "../src/profiles.js";

const devnet = PROFILES["devnet-8421"];
const hegota = PROFILES["hegota-8141"];
const pad = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}`;

// ethrex 64b8fc09, test/tests/common/frame_tx_wire_tests.rs: golden() and its two pinned strings.
test("hegota-8141 codec: byte-for-byte ethrex's golden vector, and its signature hash", () => {
  const golden: FrameTx = {
    chainId: 1n,
    nonceKeys: [0n],
    nonceSeq: 7n,
    sender: pad(0xabcd),
    frames: [
      { mode: 1, flags: 3, target: null, limits: { execution: 0x5208n, state: 0n }, value: 0n, data: "0x1122" },
      { mode: 2, flags: 0, target: pad(0x1234), limits: { execution: 0x9c40n, state: 0n }, value: 0n, data: "0x" },
    ],
    signatures: [{ scheme: 1, signer: pad(0xabcd), msg: "0x", signature: `0x${"01".repeat(65)}` }],
    fees: { maxPriorityFeePerGas: 0x3b9aca00n, maxFeePerGas: 0x6fc23ac00n, maxFeePerBlobGas: 0n },
    blobVersionedHashes: [],
    recentRootReferences: [],
  };
  assert.equal(
    encodeEnvelope(golden),
    "0xf8b201c1800794000000000000000000000000000000000000abcdeccc010380c48252088080821122de0280940000000000000000000000000000000000001234c4829c40808080f85cf85a0194000000000000000000000000000000000000abcd80b8410101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101cc843b9aca008506fc23ac0080c0",
  );
  assert.equal(hegotaSigHash(golden), "0x73827d510b0029220c237a46b27f6b6b8e7a3fd3b52c42a55c6c6e343fc45951");
});

test("hegota-8141 codec: refuses envelope-borne roots, which that chain doesn't have", () => {
  const tx = buildWithdrawal(devnet, params());
  assert.throws(() => hegota.codec.raw(tx), /VERIFY frame/);
});

function params(over: Partial<Parameters<typeof buildWithdrawal>[1]> = {}) {
  return {
    pool: pad(0xb1),
    chainId: 8141,
    recipient: pad(0xc0ffee),
    amount: 10n ** 17n,
    fee: 10n ** 15n,
    changeCommitment: 5n,
    nullifierHash: 77n,
    k: 3n,
    refs: [{ sourceId: `0x${"11".repeat(32)}` as Hex, slot: 900n, root: `0x${"22".repeat(32)}` as Hex }],
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
    ...over,
  };
}

test("devnet-8421: the same bytes as the library's own builder, so the profile refactor changed nothing", () => {
  const p = params({ chainId: 1337 });
  const old = {
    ...lib.newTx({
      chainId: p.chainId,
      sender: p.pool,
      nonceSeq: 0n,
      nonceKeys: [p.nullifierHash],
      frames: [
        lib.frame(DEVNET_TRACER, "VERIFY", { scope: "EXECUTION_AND_PAYMENT", target: null, execution: LIMITS.verifyExecution }),
        lib.frame(DEVNET_TRACER, "SENDER", { target: p.pool, execution: LIMITS.senderExecution, state: LIMITS.senderState, data: buildWithdrawal(devnet, p).frames[1].data }),
        lib.frame(DEVNET_TRACER, "DEFAULT", { target: p.pool, execution: LIMITS.refundExecution, data: buildWithdrawal(devnet, p).frames[2].data }),
      ],
      signatures: [{ scheme: lib.sigScheme(DEVNET_TRACER, "ARBITRARY"), signer: "0x", msg: "0x", signature: EMPTY_WITHDRAW_PROOF }],
      fees: { maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas },
    }),
    recentRootReferences: p.refs,
  };
  const now = buildWithdrawal(devnet, p);
  assert.equal(rawOf(devnet, now), lib.encodeTx(DEVNET_TRACER, old));
  assert.equal(sigHashOf(devnet, now), lib.sigHash(DEVNET_TRACER, old));
});

test("hegota-8141 withdrawal: root frame, then the pool's VERIFY, SENDER and refund frames", () => {
  const p = params();
  const tx = buildWithdrawal(hegota, p);
  assert.equal(tx.frames.length, 4);
  const [root, verify, sender, refund] = tx.frames;
  // EIP-8272's verifier frame, as ethrex identifies it.
  assert.deepEqual([root.mode, root.flags, root.target, root.value, root.limits.state], [1, 0, hegota.recentRoot, 0n, 0n]);
  assert.equal((root.data.length - 2) / 2, 72);
  assert.deepEqual(refsOf(hegota, tx), p.refs);
  assert.equal(tx.recentRootReferences.length, 0);
  // The pool's VERIFY frame declares the nullifier key's first-use state gas.
  assert.deepEqual([verify.mode, verify.flags, verify.target, verify.limits.state], [1, 3, null, 97_920n]);
  assert.equal(sender.mode, 2);
  assert.equal(sender.target, p.pool);
  const call = decodeFunctionData({ abi: POOL_ABI, data: sender.data });
  assert.equal(call.functionName, "withdraw");
  assert.deepEqual(call.args, [getAddress(p.recipient), p.amount, p.fee, p.changeCommitment, p.nullifierHash, p.k]);
  assert.equal(refund.mode, 0);
  assert.equal(verifyIndex(hegota), 1);
  assert.deepEqual(tx.nonceKeys, [77n]);
  assert.equal(tx.nonceSeq, 0n);
});

test("hegota-8141: an association-set pool sends both tuples in the one root frame, with a larger limit", () => {
  const asp = { sourceId: `0x${"33".repeat(32)}` as Hex, slot: 901n, root: `0x${"44".repeat(32)}` as Hex };
  const tx = buildWithdrawal(hegota, params({ refs: [params().refs[0], asp] }));
  assert.equal((tx.frames[0].data.length - 2) / 2, 144);
  assert.deepEqual(refsOf(hegota, tx)[1], asp);
  assert.ok(tx.frames[0].limits.execution > buildWithdrawal(hegota, params()).frames[0].limits.execution);
});

test("hegota-8141 ragequit: root frame, VERIFY and SENDER, no refund", () => {
  const ref = params().refs[0];
  const tx = buildRagequit(hegota, { pool: pad(0xb1), chainId: 8141, label: 9n, value: 10n ** 17n, fee: 10n ** 15n, nullifierHash: 78n, ref, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });
  assert.equal(tx.frames.length, 3);
  assert.deepEqual(refsOf(hegota, tx), [ref]);
  assert.equal(decodeFunctionData({ abi: POOL_ABI, data: tx.frames[2].data }).functionName, "ragequit");
});

test("tuples are source || uint64_be(slot) || root", () => {
  assert.equal(encodeRootTuples([{ sourceId: `0x${"aa".repeat(32)}`, slot: 0x0102n, root: `0x${"bb".repeat(32)}` }]), `0x${"aa".repeat(32)}0000000000000102${"bb".repeat(32)}`);
});

test("the proof commits to everything but itself: sigHash ignores the proof, the tx hash doesn't", () => {
  for (const profile of [devnet, hegota]) {
    const a = buildWithdrawal(profile, params());
    const b = buildWithdrawal(profile, params(), `0x${"ff".repeat(256)}`);
    assert.equal(sigHashOf(profile, a), sigHashOf(profile, b), profile.id);
    assert.notEqual(txHashOf(profile, a), txHashOf(profile, b), profile.id);
    // And it does move with the recipient, the fee and the root.
    assert.notEqual(sigHashOf(profile, a), sigHashOf(profile, buildWithdrawal(profile, params({ fee: 1n }))));
    assert.notEqual(sigHashOf(profile, a), sigHashOf(profile, buildWithdrawal(profile, params({ refs: [{ ...params().refs[0], slot: 901n }] }))));
  }
});

test("hegota-8141: the transaction hash is keccak256 of the raw bytes", () => {
  const tx = buildWithdrawal(hegota, params());
  assert.equal(txHashOf(hegota, tx), keccak256(rawOf(hegota, tx)));
  assert.ok(rawOf(hegota, tx).startsWith("0x06"));
});

test("profiles: unknown names are refused, and the default is the devnet", () => {
  assert.equal(profileOf(undefined).id, "devnet-8421");
  assert.throws(() => profileOf("eips-current"), /unknown spec profile/);
});
