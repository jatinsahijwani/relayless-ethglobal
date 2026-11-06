// Builds withdrawal frame transactions for the devnet's ethrex eip8141-tracer profile. If the devnet moves to the current
// EIP-8272 (references in a VERIFY frame), this file and the validator are what changes.
import { encodeFunctionData, toHex, concat, type Address, type Hex } from "viem";
import * as lib from "@forshtat/hegota-support/tx";
import { toWire } from "@forshtat/hegota-support/rpc";
import { getProfile } from "@forshtat/hegota-support/profiles";
import { POOL_ABI } from "./chain.js";

export const profile = getProfile("ethrex-eip8141-tracer");
export type FrameTx = ReturnType<typeof lib.newTx>;
export { toWire };

export const NONCE_MANAGER: Address = "0x0000000000000000000000000000000000008250";

export const LIMITS = {
  verifyExecution: 300_000n,
  senderExecution: 1_500_000n, // must be at least the validator's minimum
  senderState: 1_000_000n, // must be at least the validator's minimum
  refundExecution: 150_000n,
};

export type FrameLimits = typeof LIMITS & { refundState?: bigint };

/**
 * What the sidecar's dry run (`eth_estimateFrameTransactionGas`) overwrites every frame after the validation prefix with.
 * Those limits are part of sigHash, which the proof commits to, so a dry-run proof has to be made for them.
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

const ARBITRARY = () => lib.sigScheme(profile, "ARBITRARY");
export const EMPTY_PROOF: Hex = `0x${"00".repeat(256)}`;

export function buildWithdrawal(p: WithdrawalParams, proof: Hex = EMPTY_PROOF, limits: FrameLimits = LIMITS): FrameTx {
  const frames = [
    lib.frame(profile, "VERIFY", { scope: "EXECUTION_AND_PAYMENT", target: null, execution: limits.verifyExecution }),
    lib.frame(profile, "SENDER", {
      target: p.pool,
      execution: limits.senderExecution,
      state: limits.senderState,
      data: encodeFunctionData({ abi: POOL_ABI, functionName: "withdraw", args: [p.recipient, p.amount, p.fee, p.changeCommitment, p.nullifierHash, p.k] }),
    }),
    lib.frame(profile, "DEFAULT", { target: p.pool, execution: limits.refundExecution, state: limits.refundState, data: encodeFunctionData({ abi: POOL_ABI, functionName: "refund" }) }),
  ];
  return {
    ...lib.newTx({
      chainId: p.chainId,
      sender: p.pool,
      nonceSeq: 0n,
      nonceKeys: [p.nullifierHash],
      frames,
      signatures: [{ scheme: ARBITRARY(), signer: "0x", msg: "0x", signature: proof }],
      fees: { maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas },
    }),
    recentRootReferences: p.refs,
  } as FrameTx;
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

export function buildRagequit(p: RagequitParams, proof: Hex = EMPTY_PROOF): FrameTx {
  const frames = [
    lib.frame(profile, "VERIFY", { scope: "EXECUTION_AND_PAYMENT", target: null, execution: LIMITS.verifyExecution }),
    lib.frame(profile, "SENDER", {
      target: p.pool,
      execution: LIMITS.senderExecution,
      state: LIMITS.senderState,
      data: encodeFunctionData({ abi: POOL_ABI, functionName: "ragequit", args: [p.label, p.value, p.fee, p.nullifierHash] }),
    }),
  ];
  return {
    ...lib.newTx({
      chainId: p.chainId,
      sender: p.pool,
      nonceSeq: 0n,
      nonceKeys: [p.nullifierHash],
      frames,
      signatures: [{ scheme: ARBITRARY(), signer: "0x", msg: "0x", signature: proof }],
      fees: { maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas },
    }),
    recentRootReferences: [p.ref],
  } as FrameTx;
}

export const sigHashOf = (tx: FrameTx): Hex => lib.sigHash(profile, tx);
export const txHashOf = (tx: FrameTx): Hex => lib.txHash(profile, tx);
export const rawOf = (tx: FrameTx): Hex => lib.encodeTx(profile, tx);

/** The fixed 256-byte Groth16 encoding the validator reads, in the G2 limb order the pairing precompile expects. */
export function encodeProof(proof: any): Hex {
  const w = (v: string) => toHex(BigInt(v), { size: 32 });
  return concat([w(proof.pi_a[0]), w(proof.pi_a[1]), w(proof.pi_b[0][1]), w(proof.pi_b[0][0]), w(proof.pi_b[1][1]), w(proof.pi_b[1][0]), w(proof.pi_c[0]), w(proof.pi_c[1])]);
}
