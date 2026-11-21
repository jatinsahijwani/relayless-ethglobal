// Spec profiles: which version of EIP-8141, EIP-8250 and EIP-8272 a chain follows. A pool is deployed for exactly one,
// because its validator's bytecode depends on it (packages/contracts/script/gen-validator.mjs has the same table).
//
// The protocol side of each profile (addresses, codec, nonce rules, root carrier, simulate parameters) comes from
// frame-tx-sdk's profile table. This file only adds Relayless's own view of it: whether withdrawals go to an alt
// mempool or a public one, and the nullifier key's sequence. See docs/spec-port.md.
//
// To add a profile (the next one is `eips-current`, today's EIP texts, on Nethermind master): add it to frame-tx-sdk,
// then here and in the validator generator. Nothing else changes.
import type { Address, Hex } from "viem";
import { getProfile as hegotaSupportProfile } from "@forshtat/hegota-support/profiles";
import { PROFILES as SDK_PROFILES, frameSigHash, frameTxHash, serializeFrameTransaction, type FrameTransaction, type Profile as SdkProfile } from "frame-tx-sdk";
import type { FrameTx } from "./frame.js";

export type ProfileId = "devnet-8421" | "hegota-8141";

export interface Codec {
  raw(tx: FrameTx): Hex;
  sigHash(tx: FrameTx): Hex;
  txHash(tx: FrameTx): Hex;
}

export interface Profile {
  id: ProfileId;
  /** Which EIP commits it follows, for the record. */
  follows: string;
  /** EIP-8272's recent-root contract. */
  recentRoot: Address;
  /** EIP-8250's nonce manager, where a spent nullifier shows as a non-zero sequence. */
  nonceManager: Address;
  /**
   * The nullifier key's `nonce_seq`. Sequence 0 here: neither profile defines EIP-8250's single-use form
   * (`MAX_NONCE_SEQ`), so the validator pins sequence 0 itself. `eips-current` will use single-use.
   */
  nonceSeq: bigint;
  /** Where recent-root references travel: an envelope field, or a VERIFY frame to `recentRoot` at index 0. */
  rootCarrier: "envelope" | "frame";
  /** How a withdrawal reaches a block: the ERC-8421 alt mempool (sidecar), or the node's own public mempool. */
  submit: "alt-mempool" | "public-mempool";
  codec: Codec;
  /** Arguments for `ethrex_simulateFrameTransaction`. */
  simulateParams(raw: Hex): unknown[];
  /** State gas the pool's VERIFY frame must declare for the nullifier key's first use, where the protocol charges it there. */
  verifyState: bigint;
  /** Execution limit of the recent-root frame, by tuple count. Unused where roots travel in the envelope. */
  rootFrameExecution(tuples: number): bigint;
  /** frame-tx-sdk's profile, for its actions. */
  sdk: SdkProfile<ProfileId>;
}

/** Exported for tests that compare against hegota-support's own builder (the sidecar's layout). */
export const DEVNET_TRACER = hegotaSupportProfile("ethrex-eip8141-tracer");

function fromSdk(id: ProfileId): Profile {
  const sdk = SDK_PROFILES[id];
  // Transactions built by frame-tx-sdk carry their profile; this tags the ones that don't (or re-tags, so encoding a
  // transaction for the other profile fails the way it should, in that profile's codec).
  const tag = (tx: FrameTx): FrameTransaction => ({ ...tx, profile: id }) as FrameTransaction;
  return {
    id,
    follows: sdk.follows,
    recentRoot: sdk.predeploys.recentRoot,
    nonceManager: sdk.predeploys.nonceManager,
    nonceSeq: 0n,
    rootCarrier: sdk.rootCarrier,
    submit: sdk.defaultRoute === "sidecar" ? "alt-mempool" : "public-mempool",
    codec: { raw: (tx) => serializeFrameTransaction(tag(tx)), sigHash: (tx) => frameSigHash(tag(tx)), txHash: (tx) => frameTxHash(tag(tx)) },
    simulateParams: sdk.simulateParams!,
    verifyState: sdk.keyFirstUse.verifyState,
    rootFrameExecution: sdk.rootFrameExecution,
    sdk,
  };
}

export const PROFILES: Record<ProfileId, Profile> = {
  "devnet-8421": fromSdk("devnet-8421"),
  "hegota-8141": fromSdk("hegota-8141"),
};

export const DEFAULT_PROFILE: ProfileId = "devnet-8421";

export function profileOf(id: string | undefined): Profile {
  const p = PROFILES[(id ?? DEFAULT_PROFILE) as ProfileId];
  if (!p) throw new Error(`unknown spec profile ${id}: one of ${Object.keys(PROFILES).join(", ")}`);
  return p;
}
