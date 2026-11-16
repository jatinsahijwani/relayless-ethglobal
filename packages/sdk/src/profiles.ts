// Spec profiles: which version of EIP-8141, EIP-8250 and EIP-8272 a chain follows. A pool is deployed for exactly one,
// because its validator's bytecode depends on it (packages/contracts/script/gen-validator.mjs has the same table).
//
// Everything that differs between profiles lives here and in each profile's codec. The circuits, the pool contract,
// recovery, the meter, the k-gate and the association set are shared. See docs/spec-port.md.
//
// To add a profile (the next one is `eips-current`, today's EIP texts, on Nethermind master): add an entry here with its
// addresses, codec and RPC behaviour, and the same entry to the validator generator. Nothing else changes.
import type { Address, Hex } from "viem";
import type { FrameTx } from "@forshtat/hegota-support/tx";
import * as tracer from "@forshtat/hegota-support/tx";
import { getProfile } from "@forshtat/hegota-support/profiles";
import * as hegota from "./codec-hegota.js";

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
}

const tracerProfile = getProfile("ethrex-eip8141-tracer");

/** Exported for the devnet's wire form (the sidecar's `eth_sendFrameTransaction` takes JSON, not raw bytes). */
export const DEVNET_TRACER = tracerProfile;

export const PROFILES: Record<ProfileId, Profile> = {
  "devnet-8421": {
    id: "devnet-8421",
    follows: "ethrex 9aa3645d (eip8141-tracer) with the ERC-8421 sidecar 2e22ff0a: recent roots as an envelope field",
    recentRoot: "0x0000000000000000000000000000000000008272",
    nonceManager: "0x0000000000000000000000000000000000008250",
    nonceSeq: 0n,
    rootCarrier: "envelope",
    submit: "alt-mempool",
    codec: {
      raw: (tx) => tracer.encodeTx(tracerProfile, tx),
      sigHash: (tx) => tracer.sigHash(tracerProfile, tx),
      txHash: (tx) => tracer.txHash(tracerProfile, tx),
    },
    simulateParams: (raw) => [raw, "latest", { trace: false }],
    // The devnet charges a first-use nonce as 20,000 execution inside the VERIFY frame.
    verifyState: 0n,
    rootFrameExecution: () => 0n,
  },
  "hegota-8141": {
    id: "hegota-8141",
    follows: "ethrex 64b8fc09 (chain 8141): EIP-8141 7d1c8bfb94, EIP-8250 f3079a09e8, EIP-8272 824cbc0b0e",
    recentRoot: "0x0000000000000000000000000000000000008272",
    nonceManager: "0x0000000000000000000000000000000000008250",
    nonceSeq: 0n,
    rootCarrier: "frame",
    submit: "public-mempool",
    codec: { raw: hegota.rawTx, sigHash: hegota.sigHash, txHash: hegota.txHash },
    simulateParams: (raw) => [raw, "latest"],
    // EIP-8250 f3079a09e8 and EIP-8037: one new storage slot, 64 bytes at 1,530 gas per byte, from the VERIFY frame's
    // state limit at APPROVE. Too little only makes the transaction invalid; it can't burn the note.
    verifyState: 64n * 1530n,
    // minimal-shielded-pool measured 5,579 for one tuple on ethrex; a second adds a cold SLOAD and two keccaks.
    rootFrameExecution: (tuples) => (tuples > 1 ? 12_000n : 8_000n),
  },
};

export const DEFAULT_PROFILE: ProfileId = "devnet-8421";

export function profileOf(id: string | undefined): Profile {
  const p = PROFILES[(id ?? DEFAULT_PROFILE) as ProfileId];
  if (!p) throw new Error(`unknown spec profile ${id}: one of ${Object.keys(PROFILES).join(", ")}`);
  return p;
}
