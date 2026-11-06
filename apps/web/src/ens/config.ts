import type { EnsConfig } from "@relayless/sdk/ens";
import type { Address } from "viem";

declare const __ENS__: { cfg: EnsConfig; announcer: { address: Address; deployBlock: number } | null } | null;

/** Null until the directory is deployed, which hides every ENS screen in the local app. */
export const ens = __ENS__;
