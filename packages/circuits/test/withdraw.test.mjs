import test, { after } from "node:test";
import assert from "node:assert/strict";
import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import { poseidon2 } from "poseidon-lite";
import { commit, compressedProof, inputs, nullifierHash, publicsOf, scenario, statementOf } from "./helpers.mjs";

// snarkjs keeps curve worker threads alive; without this the test process never exits.
after(() => globalThis.curve_bn128?.terminate());

const wasm = "build/withdraw_js/withdraw.wasm";
const zkey = "build/withdraw.zkey";
const vk = JSON.parse(readFileSync("build/withdraw.vk.json", "utf8"));
const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** True if the witness satisfies the circuit; every constraint failure surfaces here. */
async function satisfies(w) {
  try {
    await snarkjs.wtns.calculate(inputs(w), wasm, { type: "mem" });
    return true;
  } catch {
    return false;
  }
}

test("a valid partial withdrawal proves and verifies, with the compressed signals [beta, gamma, alpha]", async () => {
  const w = scenario();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs(w), wasm, zkey);
  assert.equal(vk.nPublic, 3);
  assert.deepEqual(publicSignals, publicsOf(statementOf(w)).map(String));
  assert.equal(await snarkjs.groth16.verify(vk, publicSignals, proof), true);
});

test("compression binds the statement: the proof fails for any other statement's alpha or gamma", async () => {
  const w = scenario();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs(w), wasm, zkey);
  for (const i of [0, 1, 2, 3, 4, 5, 6]) {
    const other = statementOf(w);
    other[i] = (other[i] + 1n) % R;
    assert.equal(await snarkjs.groth16.verify(vk, publicsOf(other).map(String), proof), false, `statement value ${i}`);
  }
  const [beta, gamma, alpha] = publicSignals;
  assert.equal(await snarkjs.groth16.verify(vk, [beta, gamma, String((BigInt(alpha) + 1n) % R)], proof), false);
});

// Why the validator range-checks every statement value: an aliased value (x + r) gives a different alpha, but the
// circuit only sees x mod r, so a prover can make a proof that verifies. The validator must refuse it, and the e2e
// suites check that it does on both profiles.
test("an aliased statement value (x + r) still proves: only the validator's range checks stop it", async () => {
  const w = scenario();
  for (const i of [1, 2, 3, 5]) { // nullifierHash, changeCommitment, withdrawnValue, k: the ones a sender chooses
    const words = statementOf(w);
    words[i] += R;
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs(w, words), wasm, zkey);
    assert.deepEqual(publicSignals, publicsOf(words).map(String));
    assert.notEqual(publicSignals[2], publicsOf(statementOf(w))[2].toString());
    assert.equal(await snarkjs.groth16.verify(vk, publicSignals, proof), true, `aliased value ${i}`);
  }
});

test("full withdrawal leaves a zero-value change note", async () => {
  const w = scenario({ withdrawn: 1000n });
  assert.equal(await satisfies(w), true);
});

test("wrong root is rejected", async () => {
  assert.equal(await satisfies({ ...scenario(), rootCommit: 999n }), false);
  assert.equal(await satisfies({ ...scenario(), treeRoot: 999n }), false);
});

test("wrong nullifier hash is rejected", async () => {
  assert.equal(await satisfies({ ...scenario(), nullifierHash: nullifierHash(12n) }), false);
});

test("over-withdrawal is rejected", async () => {
  const w = scenario({ value: 1000n, withdrawn: 1001n });
  assert.equal(await satisfies(w), false);
});

test("wrong leaf count in the root commitment is rejected", async () => {
  const w = scenario({ size: 8 });
  assert.equal(await satisfies({ ...w, leafCount: 100n, rootCommit: poseidon2([w.treeRoot, 100n]) }), false);
});

test("change note must carry the remaining value", async () => {
  const w = scenario();
  assert.equal(await satisfies({ ...w, changeCommitment: commit(w.value, w.label, w.newNullifier, w.newSecret) }), false);
});

test("change note may not reuse the spent nullifier", async () => {
  const w = scenario();
  assert.equal(await satisfies({ ...w, newNullifier: w.nullifier, changeCommitment: commit(w.value - w.withdrawnValue, w.label, w.nullifier, w.newSecret) }), false);
});

test("k-gate: boundary passes, one over fails", async () => {
  assert.equal(await satisfies(scenario({ size: 8, index: 2, k: 6n })), true);
  assert.equal(await satisfies(scenario({ size: 8, index: 2, k: 7n })), false);
});

test("k-gate cannot be bypassed with a compressed path (claiming a smaller index)", async () => {
  // Index 4 of 5: levels 0 and 1 have no sibling. Compressed, it claims index 1 under the same root.
  const honest = scenario({ size: 5, index: 4, k: 1n });
  const { siblings, index } = compressedProof(honest._leaves, 4);
  assert.equal(index, 1);
  assert.equal(await satisfies(honest), true);
  assert.equal(await satisfies({ ...honest, siblings, leafIndex: BigInt(index) }), false);
  // ...and the honest position cannot pass a k it does not meet.
  assert.equal(await satisfies(scenario({ size: 5, index: 4, k: 2n })), false);
});

test("every position of an odd-sized tree proves honestly", async () => {
  for (const [size, index] of [[1, 0], [2, 1], [3, 2], [5, 4], [7, 6], [9, 8], [6, 5]]) {
    assert.equal(await satisfies(scenario({ size, index })), true, `size ${size} index ${index}`);
  }
});

test("ASP: off when aspRoot is 0, membership enforced when it is set", async () => {
  assert.equal(await satisfies(scenario({ label: 77n, aspLabels: [5n, 77n, 9n] })), true);
  const w = scenario({ label: 77n, aspLabels: [5n, 77n, 9n] });
  assert.equal(await satisfies({ ...w, aspRoot: w.aspRoot + 1n }), false);
  // A label outside the set, trying the real root with a member's path.
  const notListed = scenario({ label: 78n });
  assert.equal(await satisfies({ ...notListed, aspRoot: w.aspRoot, aspIndex: w.aspIndex, aspSiblings: w.aspSiblings }), false);
});

test("amount above 2^128 cannot be withdrawn, and the field cannot wrap", async () => {
  assert.equal(await satisfies(scenario({ value: 1000n, withdrawn: R - 1n })), false);
});

test("the circuit's compression definitions match the SDK's golden vector (packages/sdk/test/compression.test.ts)", () => {
  assert.deepEqual(publicsOf([1n, 2n, 3n, 4n, 5n, 6n, 7n]), [
    12748163991115452309045839028154629052133952896122405799815156419278439301912n,
    14335058640695747573098135164001598527004110696582996617710454205422870310228n,
    11982740049380154027498567933170918564169889233405350335887191805825922577731n,
  ]);
});
