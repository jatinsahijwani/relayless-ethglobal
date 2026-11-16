// EIP-8272 recent roots, read straight from the predeploy's storage. Nothing here trusts whoever published a root: a
// client can confirm that the chain holds exactly (source, slot, root) before proving against it.
//
// The storage layout below was read from the predeploy's bytecode on ethrex `9aa3645d`, and is the same in ethrex
// `64b8fc09` (chain 8141) and in the current EIP-8272 text: only the contract's address moves between spec profiles, so
// callers pass their profile's `recentRoot`. It has no getter, but its layout is deterministic.
import { concat, keccak256, numberToHex, type Address, type Hex } from "viem";
import { rpc } from "./chain.js";
import type { RootRef } from "./frame.js";

/** The recent-root contract on devnet-8421 and hegota-8141. Use your profile's `recentRoot`. */
export const RECENT_ROOT_ADDRESS: Address = "0x0000000000000000000000000000000000008272";
const VALUE_TAG: Hex = "0x8f42481679c8e6fefa040974b3c905e0ce3f2e464ba93acdb074a41181617efc";
const KEY_TAG: Hex = "0xbdc897da2177d260ff5f4be5d4b2aad43f89c3347a305b584fa5a2546d053daa";
/** Slots a root stays referenceable: the ring is 8192 entries, and one is the current slot. */
export const RECENT_ROOT_WINDOW = 8191n;

/** A recent-root source id: keccak256(writer || salt), the same derivation the predeploy uses. */
export const sourceIdOf = (writer: Address, salt: Hex): Hex => keccak256(concat([writer, salt]));
export const recentRootKey = (source: Hex, slot: bigint): Hex => keccak256(concat([KEY_TAG, source, numberToHex(slot & 0x1fffn, { size: 8 })]));
export const recentRootValue = (source: Hex, slot: bigint, root: Hex): Hex => keccak256(concat([VALUE_TAG, source, numberToHex(slot, { size: 8 }), root]));

export type RootCheck =
  /** The chain holds exactly this root, from this source, at this slot. */
  | { status: "verified" }
  /** The chain has no such root from this source at this slot. Don't prove against it. */
  | { status: "mismatch"; stored: Hex; expected: Hex }
  /** The slot has left the recent-root window, so the chain can't confirm it any more. */
  | { status: "expired-slot"; slot: bigint; headSlot: bigint }
  /** The chain can't be reached from here. Nothing has been verified. */
  | { status: "unreachable" };

/** Tests a root reference against the chain. Never reports "verified" unless the chain says so. */
export async function checkRecentRoot(rpcUrl: string, ref: RootRef, recentRoot: Address = RECENT_ROOT_ADDRESS): Promise<RootCheck> {
  let stored: Hex;
  let headSlot: bigint;
  try {
    headSlot = BigInt((await rpc<any>(rpcUrl, "eth_getBlockByNumber", ["latest", false])).slotNumber);
    stored = await rpc<Hex>(rpcUrl, "eth_getStorageAt", [recentRoot, recentRootKey(ref.sourceId, ref.slot), "latest"]);
  } catch {
    return { status: "unreachable" };
  }
  if (headSlot - ref.slot >= RECENT_ROOT_WINDOW) return { status: "expired-slot", slot: ref.slot, headSlot };
  const expected = recentRootValue(ref.sourceId, ref.slot, ref.root);
  if (stored.toLowerCase() !== expected.toLowerCase()) return { status: "mismatch", stored, expected };
  return { status: "verified" };
}
