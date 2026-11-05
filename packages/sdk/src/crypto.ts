// Field arithmetic and note derivation. Everything comes from one wallet signature, so there is nothing new to back up.
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite";
import { bytesToBigInt, hexToBytes, keccak256, concat, numberToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** What the wallet signs. Binding it to the pool and chain means a signature for one pool reveals nothing about another. */
export function seedTypedData(chainId: number, pool: Address) {
  return {
    domain: { name: "Relayless", version: "1", chainId, verifyingContract: pool },
    types: { Seed: [{ name: "purpose", type: "string" }] },
    primaryType: "Seed" as const,
    message: { purpose: "Unlock my Relayless notes. Only sign this on a site you trust." },
  };
}

export const masterFromSignature = (signature: Hex): bigint =>
  bytesToBigInt(hkdf(sha256, hexToBytes(signature), new TextEncoder().encode("relayless"), new TextEncoder().encode("master"), 64)) % R;

export interface NoteSecrets {
  nullifier: bigint;
  secret: bigint;
}

export const depositSecrets = (master: bigint, index: bigint): NoteSecrets => ({
  nullifier: poseidon3([master, index, 0n]),
  secret: poseidon3([master, index, 1n]),
});

/** A change note's secrets come from the note it replaces, so recovery can walk the chain of spends. */
export const changeSecrets = (master: bigint, parentNullifier: bigint): NoteSecrets => ({
  nullifier: poseidon3([master, parentNullifier, 2n]),
  secret: poseidon3([master, parentNullifier, 3n]),
});

export const precommitment = (s: NoteSecrets): bigint => poseidon2([s.nullifier, s.secret]);
export const nullifierHash = (nullifier: bigint): bigint => poseidon1([nullifier]);
export const commitment = (value: bigint, label: bigint, pre: bigint): bigint => poseidon3([value, label, pre]);
export const rootCommit = (treeRoot: bigint, leafCount: bigint): bigint => poseidon2([treeRoot, leafCount]);

/** A receive-only address derived from the seed: never funded, never linked, recoverable by signing again. */
export function freshAccount(master: bigint, index: number) {
  const key = keccak256(concat([numberToHex(master, { size: 32 }), numberToHex(index, { size: 32 })]));
  return privateKeyToAccount(key);
}

/** Where NONCE_MANAGER keeps the sequence of (sender, key): non-zero means this nullifier is spent. */
export const nonceSlot = (sender: Address, key: bigint): Hex =>
  keccak256(concat([numberToHex(BigInt(sender), { size: 32 }), numberToHex(key, { size: 32 })]));
