// Builds withdrawal and ragequit frame transactions for a spec profile (profiles.ts), on frame-tx-sdk.
//
// The frames are the same on every profile: the pool's VERIFY frame, a SENDER frame calling the pool, and an optional
// DEFAULT frame for the refund. The profiles differ in where recent roots go: an envelope field on devnet-8421, and a
// VERIFY frame to the recent-root contract in front of everything on hegota-8141. frame-tx-sdk's builder places them,
// and its codecs do the rest. What stays here is what's about this pool: the calls, the limits and the proof encoding.
import { encodeFunctionData, toHex, concat, type Address, type Hex } from "viem";
import { arbitrary, buildFrameTransaction, defaultFrame, encodeRootTuples, recentRootFrame, refsOf as sdkRefsOf, senderFrame, toSidecarWire, verifyFrame, type Frame, type FrameTransaction } from "frame-tx-sdk";
import { POOL_ABI } from "./chain.js";
import { PROFILES, type Profile } from "./profiles.js";

/** A frame transaction as frame-tx-sdk builds it: hegota-support's `FrameTx` fields, tagged with its profile. */
export type FrameTx = Omit<FrameTransaction, "profile"> & { profile?: FrameTransaction["profile"] };

/** The sidecar's JSON wire form, for `eth_sendFrameTransaction` (devnet-8421). */
export const toWire = (tx: FrameTx): unknown => toSidecarWire({ ...tx, profile: "devnet-8421" } as FrameTransaction);

export { encodeRootTuples };

export const LIMITS = {
  // Declared, and counted against a node's verify budget. Worst case used: about 240,000 (a devnet-8421 ragequit, which
  // pays the nullifier key's 20,000 first use here). With the 8,000 root frame and the signature, hegota-8141 declares
  // 268,100, under Nethermind's 300,000 default. A VERIFY frame that ran out would only make the transaction invalid.
  verifyExecution: 260_000n,
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

/** EIP-8272's verifier frame: VERIFY to the recent-root contract, zero flags, zero value, zero state limit. */
export const rootFrame = (profile: Profile, refs: RootRef[]): Frame => recentRootFrame(profile.sdk, refs);

function assemble(profile: Profile, p: { pool: Address; chainId: number; nullifierHash: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }, refs: RootRef[], body: Frame[], proof: Hex, verifyExecution: bigint): FrameTransaction {
  return buildFrameTransaction(profile.id, {
    chainId: p.chainId,
    sender: p.pool,
    nonce: { keys: [p.nullifierHash], seq: profile.nonceSeq },
    recentRoots: refs,
    // The pool's VERIFY frame may make the pool both sender and payer.
    frames: [verifyFrame({ scope: "executionAndPayment", gas: verifyExecution, stateGas: profile.verifyState }), ...body],
    signatures: [arbitrary(proof)],
    fees: { maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas },
  });
}

export function buildWithdrawal(profile: Profile, p: WithdrawalParams, proof: Hex = EMPTY_WITHDRAW_PROOF, limits: FrameLimits = LIMITS): FrameTransaction {
  const body = [
    senderFrame({
      target: p.pool,
      gas: limits.senderExecution,
      stateGas: limits.senderState,
      data: encodeFunctionData({ abi: POOL_ABI, functionName: "withdraw", args: [p.recipient, p.amount, p.fee, p.changeCommitment, p.nullifierHash, p.k] }),
    }),
    defaultFrame({ target: p.pool, gas: limits.refundExecution, stateGas: limits.refundState, data: encodeFunctionData({ abi: POOL_ABI, functionName: "refund" }) }),
  ];
  return assemble(profile, p, p.refs, body, proof, limits.verifyExecution);
}

export function buildRagequit(profile: Profile, p: RagequitParams, proof: Hex = EMPTY_PROOF): FrameTransaction {
  const body = [
    senderFrame({
      target: p.pool,
      gas: LIMITS.senderExecution,
      stateGas: LIMITS.senderState,
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
export const refsOf = (profile: Profile, tx: FrameTx): RootRef[] => sdkRefsOf(profile.sdk, { ...tx, profile: profile.id } as FrameTransaction);

/** The fixed 256-byte Groth16 encoding the validator reads, in the G2 limb order the pairing precompile expects. */
export function encodeProof(proof: any): Hex {
  const w = (v: string) => toHex(BigInt(v), { size: 32 });
  return concat([w(proof.pi_a[0]), w(proof.pi_a[1]), w(proof.pi_b[0][1]), w(proof.pi_b[0][0]), w(proof.pi_b[1][1]), w(proof.pi_b[1][0]), w(proof.pi_c[0]), w(proof.pi_c[1])]);
}

/** A withdrawal's 288-byte signature: the proof, then beta (see compression.ts). */
export const encodeWithdrawProof = (proof: any, beta: bigint): Hex => concat([encodeProof(proof), toHex(beta, { size: 32 })]);

/** Kept for callers written before profiles: the devnet profile. */
export const DEVNET = PROFILES["devnet-8421"];
