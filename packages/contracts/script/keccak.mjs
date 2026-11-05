// keccak256 of a UTF-8 string, as hex without 0x. Node's "sha3-256" is NIST SHA-3, not Keccak, so viem provides it.
import { keccak256, toHex } from "viem";

export const keccak_256 = (s) => keccak256(toHex(s)).slice(2);
