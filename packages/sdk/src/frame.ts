// Builds withdrawal and ragequit frame transactions for a spec profile (profiles.ts).
//
// The frames are the same on every profile: the pool's VERIFY frame, a SENDER frame calling the pool, and an optional
// DEFAULT frame for the refund. The profiles differ in where recent roots go: an envelope field on devnet-8421, and a
// VERIFY frame to the recent-root contract in front of everything on hegota-8141. The codec does the rest.
import { encodeFunctionData, toHex, concat, numberToHex, type Address, type Hex } from "viem";
import type { Frame, FrameTx } from "@forshtat/hegota-support/tx";
import { toWire } from "@forshtat/hegota-support/rpc";
import { POOL_ABI } from "./chain.js";
import { PROFILES, type Profile } from "./profiles.js";

export type { FrameTx };
export { toWire };

const MODE = { DEFAULT: 0, VERIFY: 1, SENDER: 2 } as const;
/** APPROVE_EXECUTION_AND_PAYMENT: the pool's VERIFY frame may make the pool both sender and payer. */
const SCOPE_EXECUTION_AND_PAYMENT = 3;
const ARBITRARY = 0;

export const LIMITS = {
  verifyExecution: 300_000n,
  senderExecution: 1_500_000n, // must be at least the validator's minimum
  senderState: 1_000_000n, // must be at least the validator's minimum
  refundExecution: 150_000n,
};

export type FrameLimits = typeof LIMITS & { refundState?: bigint };

/**
 * What the sidecar's dry run (`eth_estimateFrameTransactionGas`) overwrites every frame after the validation prefix with.
 * Those limits are part of sigHash, which the proof commits to, so a dry-run proof has to be made for them. devnet-8421 only.
 */
const ESTIMATE_PLACEHOLDER = 10_000_000n;
export const DRY_RUN_LIMITS: FrameLimits = {
  verifyExecution: LIMITS.verifyExecution,
  senderExecution: ESTIMATE_PLACEHOLDER,
  senderState: ESTIMATE_PLACEHOLDER,
  refundExecution: ESTIMATE_PLACEHOLDER,
  refundState: ESTIMATE_PLACEHOLDER,
};

export interface RootRef { sourceId: Hex; slot: bigint; root: Hex }

export interface WithdrawalParams {
  pool: Address;
  chainId: number;
  recipient: Address;
  amount: bigint;
  fee: bigint;
  changeCommitment: bigint;
  nullifierHash: bigint;
  k: bigint;
  refs: RootRef[];
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface RagequitParams {
  pool: Address;
  chainId: number;
  label: bigint;
  value: bigint;
  fee: bigint;
  nullifierHash: bigint;
  ref: RootRef;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export const EMPTY_PROOF: Hex = `0x${"00".repeat(256)}`;
/** A withdrawal's signature is the proof followed by the compression's beta: 288 bytes. */
export const EMPTY_WITHDRAW_PROOF: Hex = `0x${"00".repeat(288)}`;

const frame = (mode: number, f: { flags?: number; target: Address | null; execution: bigint; state?: bigint; data?: Hex }): Frame => ({
  mode,
  flags: f.flags ?? 0,
  target: f.target,
  limits: { execution: f.execution, state: f.state ?? 0n },
  value: 0n,
  data: f.data ?? "0x",
});

/** EIP-8272 tuples: source_id (32) || uint64_be(slot) (8) || root (32), packed. */
export const encodeRootTuples = (refs: RootRef[]): Hex => concat(refs.flatMap((r) => [r.sourceId, numberToHex(r.slot, { size: 8 }), r.root]));

/** EIP-8272's verifier frame: VERIFY to the recent-root contract, zero flags, zero value, zero state limit. */
export const rootFrame = (profile: Profile, refs: RootRef[]): Frame =>
  frame(MODE.VERIFY, { target: profile.recentRoot, execution: profile.rootFrameExecution(refs.length), data: encodeRootTuples(refs) });

function assemble(profile: Profile, p: { pool: Address; chainId: number; nullifierHash: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }, refs: RootRef[], body: Frame[], proof: Hex, verifyExecution: bigint): FrameTx {
  const verify = frame(MODE.VERIFY, { flags: SCOPE_EXECUTION_AND_PAYMENT, target: null, execution: verifyExecution, state: profile.verifyState });
  const inFrame = profile.rootCarrier === "frame";
  return {
    chainId: BigInt(p.chainId),
    nonceKeys: [p.nullifierHash],
    nonceSeq: profile.nonceSeq,
    sender: p.pool,
    frames: inFrame ? [rootFrame(profile, refs), verify, ...body] : [verify, ...body],
    signatures: [{ scheme: ARBITRARY, signer: "0x", msg: "0x", signature: proof }],
    fees: { maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas, maxFeePerBlobGas: 0n },
    blobVersionedHashes: [],
    recentRootReferences: inFrame ? [] : refs,
  };
}

export function buildWithdrawal(profile: Profile, p: WithdrawalParams, proof: Hex = EMPTY_WITHDRAW_PROOF, limits: FrameLimits = LIMITS): FrameTx {
  const body = [
    frame(MODE.SENDER, {
      target: p.pool,
      execution: limits.senderExecution,
      state: limits.senderState,
      data: encodeFunctionData({ abi: POOL_ABI, functionName: "withdraw", args: [p.recipient, p.amount, p.fee, p.changeCommitment, p.nullifierHash, p.k] }),
    }),
    frame(MODE.DEFAULT, { target: p.pool, execution: limits.refundExecution, state: limits.refundState, data: encodeFunctionData({ abi: POOL_ABI, functionName: "refund" }) }),
  ];
  return assemble(profile, p, p.refs, body, proof, limits.verifyExecution);
}

export function buildRagequit(profile: Profile, p: RagequitParams, proof: Hex = EMPTY_PROOF): FrameTx {
  const body = [
    frame(MODE.SENDER, {
      target: p.pool,
      execution: LIMITS.senderExecution,
      state: LIMITS.senderState,
      data: encodeFunctionData({ abi: POOL_ABI, functionName: "ragequit", args: [p.label, p.value, p.fee, p.nullifierHash] }),
    }),
  ];
  return assemble(profile, p, [p.ref], body, proof, LIMITS.verifyExecution);
}

export const sigHashOf = (profile: Profile, tx: FrameTx): Hex => profile.codec.sigHash(tx);
export const txHashOf = (profile: Profile, tx: FrameTx): Hex => profile.codec.txHash(tx);
export const rawOf = (profile: Profile, tx: FrameTx): Hex => profile.codec.raw(tx);

/** The index of the pool's VERIFY frame, and so of the SENDER frame after it. */
export const verifyIndex = (profile: Profile): number => (profile.rootCarrier === "frame" ? 1 : 0);

/** The recent-root references a transaction carries, wherever its profile puts them. */
export function refsOf(profile: Profile, tx: FrameTx): RootRef[] {
  if (profile.rootCarrier === "envelope") return tx.recentRootReferences;
  const data = tx.frames[0].data.slice(2);
  const out: RootRef[] = [];
  for (let i = 0; i + 144 <= data.length; i += 144) {
    out.push({ sourceId: `0x${data.slice(i, i + 64)}`, slot: BigInt(`0x${data.slice(i + 64, i + 80)}`), root: `0x${data.slice(i + 80, i + 144)}` });
  }
  return out;
}

/** The fixed 256-byte Groth16 encoding the validator reads, in the G2 limb order the pairing precompile expects. */
export function encodeProof(proof: any): Hex {
  const w = (v: string) => toHex(BigInt(v), { size: 32 });
  return concat([w(proof.pi_a[0]), w(proof.pi_a[1]), w(proof.pi_b[0][1]), w(proof.pi_b[0][0]), w(proof.pi_b[1][1]), w(proof.pi_b[1][0]), w(proof.pi_c[0]), w(proof.pi_c[1])]);
}

/** A withdrawal's 288-byte signature: the proof, then beta (see compression.ts). */
export const encodeWithdrawProof = (proof: any, beta: bigint): Hex => concat([encodeProof(proof), toHex(beta, { size: 32 })]);

/** Kept for callers written before profiles: the devnet profile. */
export const DEVNET = PROFILES["devnet-8421"];
