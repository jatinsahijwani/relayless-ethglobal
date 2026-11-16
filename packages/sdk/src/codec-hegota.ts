// The type-0x06 envelope of the Hegotá testnet (chain 8141, ethrex `64b8fc09`), which follows EIP-8141 at `7d1c8bfb94`,
// EIP-8250 at `f3079a09e8` and EIP-8272 at `824cbc0b0e`:
//
//   raw       = 0x06 || rlp([chain_id, nonce_keys, nonce_seq, sender, frames, signatures, fees, blob_hashes])
//   fees      = [max_priority_fee_per_gas, max_fee_per_gas, max_fee_per_blob_gas]
//   frame     = [mode, flags, target or empty, [execution, state], value, data]
//   signature = [scheme, signer or empty, msg, signature]
//   sig_hash  = keccak256(0x06 || rlp(envelope with the signature bytes of every empty-msg entry elided to empty))
//
// No published library encodes this envelope (`@forshtat/hegota-support` 0.0.1 carries recent roots as an envelope
// field), so this is ours. `test/codec-hegota.test.ts` pins it to ethrex's golden vector.
import { concat, keccak256, toRlp, type Hex } from "viem";
import type { FrameTx } from "@forshtat/hegota-support/tx";

/** A non-negative integer as RLP wants it: minimal big-endian bytes, so 0 is the empty string. */
function int(n: bigint | number): Hex {
  const v = BigInt(n);
  if (v < 0n) throw new RangeError("negative integer");
  if (v === 0n) return "0x";
  const h = v.toString(16);
  return `0x${h.length % 2 ? "0" : ""}${h}`;
}

function envelope(tx: FrameTx, elide: boolean): Hex {
  if (tx.recentRootReferences.length) throw new Error("hegota-8141 carries recent roots in a VERIFY frame, not in the envelope");
  return toRlp([
    int(tx.chainId),
    tx.nonceKeys.map(int),
    int(tx.nonceSeq),
    tx.sender,
    tx.frames.map((f) => [int(f.mode), int(f.flags), f.target ?? "0x", [int(f.limits.execution), int(f.limits.state)], int(f.value), f.data]),
    tx.signatures.map((s) => [int(s.scheme), s.signer, s.msg, elide && s.msg === "0x" ? "0x" : s.signature]),
    [int(tx.fees.maxPriorityFeePerGas), int(tx.fees.maxFeePerGas), int(tx.fees.maxFeePerBlobGas)],
    tx.blobVersionedHashes,
  ]);
}

/** The envelope's RLP with every signature in place, without the type byte. */
export const encodeEnvelope = (tx: FrameTx): Hex => envelope(tx, false);
/** What `eth_sendRawTransaction` takes. */
export const rawTx = (tx: FrameTx): Hex => concat(["0x06", envelope(tx, false)]);
export const sigHash = (tx: FrameTx): Hex => keccak256(concat(["0x06", envelope(tx, true)]));
export const txHash = (tx: FrameTx): Hex => keccak256(rawTx(tx));
