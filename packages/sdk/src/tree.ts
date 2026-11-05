// LeanIMT, matching the pool and the circuit: a node with no right sibling moves up unchanged.
import { poseidon2 } from "poseidon-lite";

export const TREE_DEPTH = 20;

export function levels(leaves: bigint[]): bigint[][] {
  const out = [leaves];
  while (out[out.length - 1].length > 1) {
    const cur = out[out.length - 1];
    const next: bigint[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? poseidon2([cur[i], cur[i + 1]]) : cur[i]);
    out.push(next);
  }
  return out;
}

export const rootOf = (leaves: bigint[]): bigint => {
  if (leaves.length === 0) return 0n;
  const ls = levels(leaves);
  return ls[ls.length - 1][0];
};

/** Positional siblings: level i always holds the sibling at level i, or 0. The circuit rejects any other form. */
export function siblings(leaves: bigint[], index: number): bigint[] {
  const ls = levels(leaves);
  const out: bigint[] = [];
  let idx = index;
  for (let i = 0; i < ls.length - 1; i++) {
    const sib = idx ^ 1;
    out.push(sib < ls[i].length ? ls[i][sib] : 0n);
    idx >>= 1;
  }
  while (out.length < TREE_DEPTH) out.push(0n);
  return out;
}
