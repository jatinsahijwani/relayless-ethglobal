// Hybrid public-input compression for the withdrawal proof, from eprint 2025/1500, adapted from minimal-shielded-pool
// (see NOTICE.md). The proof exposes three public signals instead of the seven statement values:
//   alpha = keccak256(the seven values as 32-byte words) mod r   computed by the validator, the circuit's one input
//   beta  = Poseidon(the seven values)                           a circuit output, carried after the proof
//   gamma = x0 + x1*s + ... + x6*s^6 at s = alpha + beta         a circuit output, recomputed by the validator
// circom puts outputs first, so the verifier's order is [beta, gamma, alpha].
//
// The verifier no longer sees the values, so the validator range-checks each one itself: a value plus r would give a
// different alpha but the same field element in the circuit, and the proof would verify.
import { concat, keccak256, toHex, type Hex } from "viem";
import { poseidon7 } from "poseidon-lite";
import { R } from "./crypto.js";

/** The withdrawal statement, in the order the circuit, the validator and this file agree on. */
export interface WithdrawStatement {
  rootCommit: bigint;
  nullifierHash: bigint;
  changeCommitment: bigint;
  withdrawnValue: bigint;
  sigHash: bigint; // already reduced mod r
  k: bigint;
  aspRoot: bigint;
}

export const STATEMENT_LENGTH = 7;

export function statementWords(s: WithdrawStatement): bigint[] {
  const words = [s.rootCommit, s.nullifierHash, s.changeCommitment, s.withdrawnValue, s.sigHash, s.k, s.aspRoot];
  if (words.some((x) => x < 0n || x >= R)) throw new RangeError("every statement value must be a field element");
  return words;
}

/** The validator's side. Takes raw words so tests can show what an aliased (value + r) statement would produce. */
export const alphaOfWords = (words: readonly bigint[]): bigint => BigInt(keccak256(concat(words.map((x) => toHex(x, { size: 32 }))))) % R;
export const compressionAlpha = (s: WithdrawStatement): bigint => alphaOfWords(statementWords(s));

/** The circuit's side. */
export const compressionBeta = (s: WithdrawStatement): bigint => poseidon7(statementWords(s));

/** x0 + x1*s + ... + xn*s^n mod r, by Horner. */
export const fingerprint = (sigma: bigint, words: readonly bigint[]): bigint => words.reduceRight((acc, x) => (acc * sigma + x) % R, 0n);

/** The three public signals, in the verifier's order. */
export function compressedPublics(s: WithdrawStatement): [beta: bigint, gamma: bigint, alpha: bigint] {
  const alpha = compressionAlpha(s);
  const beta = compressionBeta(s);
  return [beta, fingerprint((alpha + beta) % R, statementWords(s)), alpha];
}

/** beta as the 32-byte word that follows the proof in the withdrawal's signature. */
export const betaWord = (beta: bigint): Hex => toHex(beta, { size: 32 });
