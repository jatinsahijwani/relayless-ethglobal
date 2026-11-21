// EIP-8272 recent roots, read straight from the recent-root contract's storage, through frame-tx-sdk. Nothing here
// trusts whoever published a root: a client can confirm that the chain holds exactly (source, slot, root) before
// proving against it.
//
// The storage layout is the same on ethrex `9aa3645d`, `64b8fc09` (chain 8141) and the current EIP-8272 text: only the
// contract's address moves between spec profiles, so callers pass their profile's `recentRoot`.
import type { Address } from "viem";
import { checkRecentRoot as sdkCheck, fetchClient, PROFILES, type Profile, type RootCheck } from "frame-tx-sdk";
import type { RootRef } from "./frame.js";

export { RECENT_ROOT_WINDOW, sourceIdOf, recentRootKey, recentRootValue, type RootCheck } from "frame-tx-sdk";

/** The recent-root contract on devnet-8421 and hegota-8141. Use your profile's `recentRoot`. */
export const RECENT_ROOT_ADDRESS: Address = "0x0000000000000000000000000000000000008272";

/** Tests a root reference against the chain. Never reports "verified" unless the chain says so. */
export async function checkRecentRoot(rpcUrl: string, ref: RootRef, recentRoot: Address = RECENT_ROOT_ADDRESS): Promise<RootCheck> {
  const profile: Profile = { ...PROFILES["hegota-8141"], predeploys: { ...PROFILES["hegota-8141"].predeploys, recentRoot } };
  return sdkCheck(fetchClient(rpcUrl), profile, ref);
}
