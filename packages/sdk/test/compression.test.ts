import test from "node:test";
import assert from "node:assert/strict";
import { size } from "viem";
import { R } from "../src/crypto.js";
import { alphaOfWords, compressedPublics, statementWords, type WithdrawStatement } from "../src/compression.js";
import { EMPTY_WITHDRAW_PROOF, encodeWithdrawProof } from "../src/frame.js";

const s: WithdrawStatement = { rootCommit: 1n, nullifierHash: 2n, changeCommitment: 3n, withdrawnValue: 4n, sigHash: 5n, k: 6n, aspRoot: 7n };

// The same vector is checked against the circuit's definitions in packages/circuits/test/withdraw.test.mjs, whose
// other tests check those definitions against the circuit's actual outputs.
const GOLDEN = [
  12748163991115452309045839028154629052133952896122405799815156419278439301912n,
  14335058640695747573098135164001598527004110696582996617710454205422870310228n,
  11982740049380154027498567933170918564169889233405350335887191805825922577731n,
];

test("compression: a fixed statement gives the golden [beta, gamma, alpha]", () => {
  assert.deepEqual(compressedPublics(s), GOLDEN);
});

test("compression: a statement value outside the field is refused before proving", () => {
  assert.throws(() => statementWords({ ...s, withdrawnValue: s.withdrawnValue + R }), RangeError);
  assert.throws(() => statementWords({ ...s, k: -1n }), RangeError);
});

test("compression: an aliased value (x + r) changes alpha, which is why the validator range-checks every value", () => {
  const words = statementWords(s);
  for (let i = 0; i < words.length; i++) {
    const aliased = [...words];
    aliased[i] += R;
    assert.notEqual(alphaOfWords(aliased), alphaOfWords(words));
  }
});

test("compression: a withdrawal's signature is the 256-byte proof plus beta", () => {
  const proof = { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] };
  const sig = encodeWithdrawProof(proof, GOLDEN[0]);
  assert.equal(size(sig), 288);
  assert.equal(BigInt(`0x${sig.slice(2 + 512)}`), GOLDEN[0]);
  assert.equal(size(EMPTY_WITHDRAW_PROOF), 288);
});
