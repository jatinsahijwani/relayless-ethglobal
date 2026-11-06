// Private receive names: ERC-5564 scheme 1 stealth addresses, using ScopeLift's MIT-licensed crypto (see NOTICE.md).
//
// A name holds a stealth meta-address instead of an `addr`. The payer derives a new address each time, so no two
// payments can be linked by looking at the chain. A rotating `addr` wouldn't do this: its history is public, so anyone
// could read back every address the name has ever pointed to.
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { getPublicKey } from "@noble/secp256k1";
import { generateStealthAddress } from "@scopelift/stealth-address-sdk/dist/utils/crypto/generateStealthAddress.js";
import checkStealthAddress from "@scopelift/stealth-address-sdk/dist/utils/crypto/checkStealthAddress.js";
import computeStealthKey from "@scopelift/stealth-address-sdk/dist/utils/crypto/computeStealthKey.js";
import { bytesToHex, decodeEventLog, encodeEventTopics, encodeFunctionData, hexToBytes, parseAbi, size, slice, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logsAround, rpc } from "./chain.js";

export const SCHEME_ID = 1;

export const ANNOUNCER_ABI = parseAbi([
  "function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)",
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)",
]);

export interface StealthKeys {
  spendingPrivateKey: Hex;
  viewingPrivateKey: Hex;
  spendingPublicKey: Hex;
  viewingPublicKey: Hex;
  /** Holds the role that can edit only the stealth record, so rotating it needs no wallet prompt. */
  appKey: Hex;
}

/** What the wallet signs. It names no pool or chain, because the keys belong to the person and outlive any one pool. */
export const stealthTypedData = () => ({
  domain: { name: "Relayless", version: "1" },
  types: { StealthKeys: [{ name: "purpose", type: "string" }] },
  primaryType: "StealthKeys" as const,
  message: { purpose: "Unlock my private receive name. Only sign this on a site you trust." },
});

/** Keys come from one signature, so there is nothing new to back up. Each is domain-separated from the others. */
export function stealthKeysFromSignature(signature: Hex): StealthKeys {
  const key = (info: string): Hex => bytesToHex(hkdf(sha256, hexToBytes(signature), new TextEncoder().encode("relayless-stealth"), new TextEncoder().encode(info), 32));
  const spendingPrivateKey = key("spending");
  const viewingPrivateKey = key("viewing");
  return {
    spendingPrivateKey,
    viewingPrivateKey,
    spendingPublicKey: bytesToHex(getPublicKey(hexToBytes(spendingPrivateKey), true)),
    viewingPublicKey: bytesToHex(getPublicKey(hexToBytes(viewingPrivateKey), true)),
    appKey: key("app"),
  };
}

/** `st:eth:0x<spending><viewing>`, the ERC-5564 form. */
export const metaAddressOf = (k: Pick<StealthKeys, "spendingPublicKey" | "viewingPublicKey">): string => `st:eth:${k.spendingPublicKey}${k.viewingPublicKey.slice(2)}`;

export function isMetaAddress(value: string | null | undefined): value is string {
  return Boolean(value && /^st:[a-z0-9-]+:0x(02|03)[0-9a-fA-F]{64}(02|03)[0-9a-fA-F]{64}$/.test(value));
}

export interface StealthPayment {
  stealthAddress: Address;
  ephemeralPublicKey: Hex;
  viewTag: Hex;
}

/** A new one-time address every call. Runs entirely on this device: nothing here touches the network. */
export function deriveStealthPayment(metaAddress: string): StealthPayment {
  if (!isMetaAddress(metaAddress)) throw new Error("that name doesn't hold a valid stealth meta-address");
  const { stealthAddress, ephemeralPublicKey, viewTag } = generateStealthAddress({ stealthMetaAddressURI: metaAddress, schemeId: SCHEME_ID as any });
  return { stealthAddress, ephemeralPublicKey, viewTag: viewTag as Hex };
}

export const announceCall = (p: StealthPayment): Hex =>
  encodeFunctionData({ abi: ANNOUNCER_ABI, functionName: "announce", args: [BigInt(SCHEME_ID), p.stealthAddress, p.ephemeralPublicKey, p.viewTag] });

export interface ReceivedPayment {
  stealthAddress: Address;
  ephemeralPublicKey: Hex;
  blockNumber: number;
  txHash: Hex;
}

export interface ScanResult {
  received: ReceivedPayment[];
  /** Blocks the node couldn't serve. If any exist, an announcement could be hidden in them, so the list may be short. */
  unreadableBlocks: number[];
  scanned: number;
}

/** True if this announcement is for these keys. Needs only the viewing key, which can't spend. */
export function isForMe(a: { stealthAddress: Address; ephemeralPublicKey: Hex; viewTag: Hex }, keys: Pick<StealthKeys, "viewingPrivateKey" | "spendingPublicKey">): boolean {
  return checkStealthAddress({
    ephemeralPublicKey: a.ephemeralPublicKey,
    schemeId: SCHEME_ID as any,
    spendingPublicKey: keys.spendingPublicKey,
    userStealthAddress: a.stealthAddress,
    viewingPrivateKey: keys.viewingPrivateKey,
    viewTag: a.viewTag,
  });
}

/**
 * Reads every announcement and tests each one on this device. Fetching all of them means the node can't tell which are
 * yours, and the viewing key never leaves. Survives ethrex's lost block numbers, and reports them instead of hiding them.
 */
export async function scanAnnouncements(rpcUrl: string, announcer: Address, keys: Pick<StealthKeys, "viewingPrivateKey" | "spendingPublicKey">, fromBlock = 0): Promise<ScanResult> {
  const head = Number(await rpc<string>(rpcUrl, "eth_blockNumber", []));
  const unreadableBlocks: number[] = [];
  const topics = encodeEventTopics({ abi: ANNOUNCER_ABI, eventName: "Announcement" }) as Hex[];
  const logs = await logsAround(rpcUrl, announcer, fromBlock, head, topics, unreadableBlocks);
  const received: ReceivedPayment[] = [];
  for (const log of logs) {
    const ev = decodeEventLog({ abi: ANNOUNCER_ABI, data: log.data, topics: log.topics }) as any;
    const { schemeId, stealthAddress, ephemeralPubKey, metadata } = ev.args;
    // Anyone can announce anything, so a malformed entry must be skipped and can't stop the scan.
    if (schemeId !== BigInt(SCHEME_ID) || size(ephemeralPubKey) !== 33 || size(metadata) < 1) continue;
    let mine = false;
    try {
      mine = isForMe({ stealthAddress, ephemeralPublicKey: ephemeralPubKey, viewTag: slice(metadata, 0, 1) as Hex }, keys);
    } catch {
      continue;
    }
    if (mine) received.push({ stealthAddress, ephemeralPublicKey: ephemeralPubKey, blockNumber: Number(log.blockNumber), txHash: log.transactionHash });
  }
  return { received, unreadableBlocks, scanned: logs.length };
}

/** The private key that spends a received payment. */
export function stealthPrivateKey(ephemeralPublicKey: Hex, keys: Pick<StealthKeys, "spendingPrivateKey" | "viewingPrivateKey">): Hex {
  return computeStealthKey({ ephemeralPublicKey, schemeId: SCHEME_ID as any, spendingPrivateKey: keys.spendingPrivateKey, viewingPrivateKey: keys.viewingPrivateKey }) as Hex;
}

export const stealthAccount = (ephemeralPublicKey: Hex, keys: Pick<StealthKeys, "spendingPrivateKey" | "viewingPrivateKey">) => privateKeyToAccount(stealthPrivateKey(ephemeralPublicKey, keys));
