import { concat, keccak256, toHex } from "viem";
import { poseidon7, poseidon1, poseidon2, poseidon3 } from "poseidon-lite";

export const D = 20;
export const pad = (a, n = D) => [...a, ...Array(n - a.length).fill(0n)].slice(0, n);
export const commit = (value, label, nullifier, secret) => poseidon3([value, label, poseidon2([nullifier, secret])]);
export const nullifierHash = (n) => poseidon1([n]);

/** LeanIMT levels, bottom up: a node with no right sibling moves up unchanged. */
export function levels(leaves) {
  const out = [leaves];
  while (out.at(-1).length > 1) {
    const cur = out.at(-1);
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? poseidon2([cur[i], cur[i + 1]]) : cur[i]);
    out.push(next);
  }
  return out;
}
export const rootOf = (leaves) => levels(leaves).at(-1)[0];

/** Positional siblings: level i always holds the sibling at level i, or 0 if there is none. */
export function positionalProof(leaves, index) {
  const ls = levels(leaves);
  const siblings = [];
  let idx = index;
  for (let i = 0; i < ls.length - 1; i++) {
    const sib = idx ^ 1;
    siblings.push(sib < ls[i].length ? ls[i][sib] : 0n);
    idx >>= 1;
  }
  return pad(siblings);
}

/** The compressed form an attacker would use: empty levels removed, index rebuilt from the remaining bits. */
export function compressedProof(leaves, index) {
  const ls = levels(leaves);
  const siblings = [];
  let idx = index;
  let compact = 0;
  for (let i = 0; i < ls.length - 1; i++) {
    const sib = idx ^ 1;
    if (sib < ls[i].length) {
      if (idx & 1) compact |= 1 << siblings.length;
      siblings.push(ls[i][sib]);
    }
    idx >>= 1;
  }
  return { siblings: pad(siblings), index: compact };
}

/** A valid witness: `spend` of a `value` note at `index` in a tree of `size` leaves. */
export function scenario({ size = 8, index = 2, value = 1000n, withdrawn = 400n, k = 0n, label = 77n, aspLabels = null, sigHash = 123456n } = {}) {
  const nullifier = 11n, secret = 22n, newNullifier = 33n, newSecret = 44n;
  const leaves = Array.from({ length: size }, (_, i) => BigInt(1000 + i));
  leaves[index] = commit(value, label, nullifier, secret);
  const treeRoot = rootOf(leaves);
  const aspProof = aspLabels ? positionalProof(aspLabels, aspLabels.indexOf(label)) : pad([]);
  return {
    rootCommit: poseidon2([treeRoot, BigInt(size)]),
    nullifierHash: nullifierHash(nullifier),
    changeCommitment: commit(value - withdrawn, label, newNullifier, newSecret),
    withdrawnValue: withdrawn,
    sigHash,
    k,
    aspRoot: aspLabels ? rootOf(aspLabels) : 0n,
    value,
    label,
    nullifier,
    secret,
    newNullifier,
    newSecret,
    treeRoot,
    leafCount: BigInt(size),
    leafIndex: BigInt(index),
    siblings: positionalProof(leaves, index),
    aspIndex: aspLabels ? BigInt(aspLabels.indexOf(label)) : 0n,
    aspSiblings: aspProof,
    _leaves: leaves,
  };
}

// Hybrid compression (eprint 2025/1500): the same definitions as packages/sdk/src/compression.ts.
export const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const statementOf = (w) => [w.rootCommit, w.nullifierHash, w.changeCommitment, w.withdrawnValue, w.sigHash, w.k, w.aspRoot].map(BigInt);
/** The validator's alpha over the raw 32-byte words, so a test can feed it an aliased (value + r) word. */
export const alphaOf = (words) => BigInt(keccak256(concat(words.map((x) => toHex(x, { size: 32 }))))) % R;
export const fingerprint = (sigma, words) => words.reduceRight((acc, x) => (acc * sigma + x) % R, 0n);
export function publicsOf(words) {
  const alpha = alphaOf(words);
  const beta = poseidon7(words.map((x) => x % R));
  return [beta, fingerprint((alpha + beta) % R, words.map((x) => x % R)), alpha];
}

/** The circuit's input: the witness plus alpha, computed from `words` (the statement itself unless a test aliases it). */
export const inputs = ({ _leaves, ...w }, words = statementOf(w)) => ({ ...w, alpha: alphaOf(words) });
