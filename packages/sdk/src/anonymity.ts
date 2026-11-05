// The anonymity meter: how anonymous a withdrawal would be, against an attacker who sees only public data.
//
// This is a MODEL, not a guarantee. Each deposit i gets a suspicion weight w_i (the product of the factors below),
// normalized into p_i. The weights are explicit so anyone can argue with them.
import type { Address } from "viem";
import type { DepositEvent, PoolState } from "./chain.js";

export const WEIGHTS = {
  /** Older deposits are less likely to be the source: halves every this many blocks. */
  ageHalfLifeBlocks: 7200,
  /** A deposit too small to cover the withdrawal was not the source (change notes aside: see below). */
  cannotCover: 0,
  /** A deposit of exactly the withdrawn amount stands out. */
  exactAmountMatch: 8,
  /** Round amounts are common; a distinctive amount is a fingerprint if it matches closely. */
  closeAmountMatch: 3,
  /** An address that deposited repeatedly is easier to cluster. */
  addressReusePerExtraDeposit: 1.5,
  /** A deposit funded from a labeled address (exchange, known entity) is easier to attribute. */
  labeledFunding: 4,
};

/** The score the app calls good: the most suspicious candidate is at most 1 in 32. */
export const TARGET_BITS = 5;

export interface AnonymityInput {
  state: PoolState;
  /** The amount being withdrawn; omit to rate the pool in general. */
  amount?: bigint;
  /** The block to rate at (default: the last deposit). */
  atBlock?: number;
  /** Addresses known to be labeled, if any list is available. */
  labels?: Set<string>;
  /** The user's own deposit, to make the advice specific to them. */
  own?: { depositor?: Address; leafIndex?: number };
}

export interface Candidate { leafIndex: number; depositor: Address; p: number }

export interface AnonymityReport {
  /** Size of the candidate set: deposits that could have funded this withdrawal. */
  setSize: number;
  shannonBits: number;
  /** -log2(max p): the primary score. How exposed the single most suspicious candidate is. */
  minEntropyBits: number;
  /** 2^shannon: how many equally likely deposits this is worth. */
  effectiveSetSize: number;
  advice: string[];
  candidates: Candidate[];
}

export function weightOf(d: DepositEvent, input: AnonymityInput, counts: Map<string, number>, atBlock: number): number {
  const { amount, labels } = input;
  if (amount !== undefined && d.value < amount) return WEIGHTS.cannotCover;
  let w = Math.pow(0.5, Math.max(0, atBlock - d.blockNumber) / WEIGHTS.ageHalfLifeBlocks);
  if (amount !== undefined) {
    if (d.value === amount) w *= WEIGHTS.exactAmountMatch;
    else if (d.value - amount < amount / 10n) w *= WEIGHTS.closeAmountMatch;
  }
  const n = counts.get(d.depositor.toLowerCase()) ?? 1;
  if (n > 1) w *= Math.pow(WEIGHTS.addressReusePerExtraDeposit, n - 1);
  if (labels?.has(d.depositor.toLowerCase())) w *= WEIGHTS.labeledFunding;
  return w;
}

export function anonymity(input: AnonymityInput): AnonymityReport {
  const deposits = input.state.deposits;
  const atBlock = input.atBlock ?? deposits[deposits.length - 1]?.blockNumber ?? 0;
  const eligible = deposits.filter((d) => d.blockNumber <= atBlock);

  const counts = new Map<string, number>();
  for (const d of eligible) counts.set(d.depositor.toLowerCase(), (counts.get(d.depositor.toLowerCase()) ?? 0) + 1);

  const weighted = eligible.map((d) => ({ d, w: weightOf(d, input, counts, atBlock) })).filter((x) => x.w > 0);
  const total = weighted.reduce((s, x) => s + x.w, 0);
  const candidates: Candidate[] = weighted.map(({ d, w }) => ({ leafIndex: d.leafIndex, depositor: d.depositor, p: w / total }));

  const shannonBits = candidates.reduce((s, c) => s - c.p * Math.log2(c.p), 0);
  const maxP = candidates.reduce((m, c) => Math.max(m, c.p), 0);
  const minEntropyBits = maxP > 0 ? -Math.log2(maxP) : 0;

  return {
    setSize: candidates.length,
    shannonBits,
    minEntropyBits,
    effectiveSetSize: Math.pow(2, shannonBits),
    advice: adviceFor(input, candidates, minEntropyBits, counts),
    candidates,
  };
}

/** Plain-language next steps. Each names something the user can actually do. */
function adviceFor(input: AnonymityInput, candidates: Candidate[], minEntropyBits: number, counts: Map<string, number>): string[] {
  const advice: string[] = [];
  const { amount, own, labels, state } = input;
  const target = TARGET_BITS; // bits: the most suspicious candidate is at most 1 in 32

  if (candidates.length === 0) return ["No deposit in this pool can cover that amount yet. Lower the amount or wait for more deposits."];
  if (minEntropyBits < target) {
    const needed = Math.max(1, Math.ceil(Math.pow(2, target) - candidates.length));
    advice.push(`Wait for about ${needed} more deposit${needed === 1 ? "" : "s"}: right now you could be picked out of about ${Math.max(1, Math.round(Math.pow(2, minEntropyBits)))}.`);
  }
  if (amount !== undefined) {
    const exact = state.deposits.filter((d) => d.value === amount);
    if (exact.length > 0 && exact.length <= 3) advice.push(`Only ${exact.length} deposit${exact.length === 1 ? " is" : "s are"} exactly this amount. Change the amount, or split it into 2 payments.`);
    const larger = state.deposits.filter((d) => d.value >= amount).length;
    if (larger < state.deposits.length / 2) advice.push("Most deposits are smaller than this. Splitting it into 2 smaller payments would hide you among more of them.");
  }
  if (own?.depositor) {
    const a = own.depositor.toLowerCase();
    if (labels?.has(a)) advice.push("Your deposit came from a labeled address, so it is easier to attribute. Next time, deposit from an unlabeled one.");
    if ((counts.get(a) ?? 1) > 1) advice.push("You have deposited several times from one address, which links those deposits. Next time, use a different one.");
  }
  if (own?.leafIndex !== undefined) {
    const after = state.leaves.length - own.leafIndex - 1;
    if (after < 8) advice.push(after === 0 ? "Nothing has been added since yours. Paying right after adding money is the easiest link to spot." : `Only ${after} note${after === 1 ? " has" : "s have"} been added since yours. Paying right after adding money is the easiest link to spot.`);
  }
  if (advice.length === 0) advice.push("Looks good: nothing obvious singles you out.");
  return advice;
}

/** The anonymity lost to the funding link alone: a fresh address funded by a known account is linked no matter the pool. */
export function fundingComparison(report: AnonymityReport) {
  return {
    selfFunded: { minEntropyBits: 0, note: "The gas transfer links the fresh address directly to whoever funded it." },
    relayer: { minEntropyBits: report.minEntropyBits, note: "No on-chain link, but a relayer sees your IP and recipient, can refuse you, and must exist." },
    relayless: { minEntropyBits: report.minEntropyBits, note: "No on-chain link and no relayer. The node you submit to still sees your IP." },
  };
}
