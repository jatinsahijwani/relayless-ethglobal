// ENS as the directory of the privacy layer. Everything here reads a Sepolia RPC directly from this device: there is no
// server of ours in the path, so we can't learn who looks up whom. The RPC itself can: see CROPS in the README.
//
// The pool's chain stays the source of truth. ENS says which ASPs exist and what they claim, and `crossCheckRoot` tests
// those claims against that chain.
import { bytesToBigInt, concat, createPublicClient, decodeEventLog, encodeAbiParameters, encodeEventTopics, encodeFunctionData, fallback, http, keccak256, labelhash, hexToBytes, numberToHex, parseAbi, parseEventLogs, stringToBytes, stringToHex, toHex, type Address, type Hex } from "viem";
import { normalize } from "viem/ens";
import { sepolia } from "viem/chains";
import { rpc } from "./chain.js";

export interface EnsConfig {
  chainId: number;
  rpc: string;
  /** Tried when `rpc` refuses, as public endpoints do under load. They see the same lookups, so choose them with care. */
  rpcFallbacks?: string[];
  logSpan: number;
  explorer: string;
  contracts: { ethRegistry: Address; universalResolver: Address; verifiableFactory: Address; permissionedResolverImpl: Address };
  names: { parentLabel: string; parent: string; directoryLabel: string; directory: string };
  recordKeys: { aspRoot: string; aspSlot: string; aspPolicy: string; aspChainId: string; aspPool: string; aspOperator: string; aspEndpoint: string; stealthMetaAddress: string };
  aspSaltPreimage: string;
  deployBlock: number | null;
  claimer: Address | null;
}

const ZERO: Address = "0x0000000000000000000000000000000000000000";

const REGISTRY_ABI = parseAbi([
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function getStatus(uint256 anyId) view returns (uint8)",
  "function getResource(uint256 anyId) view returns (uint256)",
  "function latestOwnerOf(uint256 tokenId) view returns (address)",
  "function getTokenId(uint256 anyId) view returns (uint256)",
  "function isEmancipated() view returns (bool)",
  "event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)",
]);
const EAC_ABI = parseAbi([
  "event EACRolesChanged(uint256 indexed resource, address indexed account, uint256 oldRoleBitmap, uint256 newRoleBitmap)",
  "event ResourceArgument(uint256 indexed resource, bytes arg)",
]);
const RESOLVER_ABI = parseAbi([
  "function setText(bytes name, string key, string value)",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
  "function multicall(bytes[] calls) returns (bytes[])",
]);
const FACTORY_ABI = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);
const CLAIMER_ABI = parseAbi(["function claim(string label, address resolver) returns (uint256)"]);
const POOL_SOURCE_ABI = parseAbi(["function ASP_SOURCE_ID() view returns (bytes32)"]);

/** ENS names are DNS-encoded in resolver writes. Labels here have already been normalized. */
export function dnsEncode(name: string): Hex {
  const parts: Hex[] = name.split(".").flatMap((label) => {
    const bytes = stringToBytes(label);
    if (bytes.length === 0 || bytes.length > 255) throw new Error(`bad label: ${label}`);
    return [numberToHex(bytes.length, { size: 1 }), toHex(bytes)];
  });
  return concat([...parts, "0x00"]);
}

export const REGISTRY_ROLES: Record<string, bigint> = {
  REGISTRAR: 1n << 0n, REGISTER_RESERVED: 1n << 4n, SET_PARENT: 1n << 8n, UNREGISTER: 1n << 12n, RENEW: 1n << 16n, SET_SUBREGISTRY: 1n << 20n, SET_RESOLVER: 1n << 24n, SET_URI: 1n << 36n, UPGRADE: 1n << 124n,
};
export const RESOLVER_ROLES: Record<string, bigint> = {
  SET_ADDRESS: 1n << 0n, SET_TEXT: 1n << 4n, SET_CONTENTHASH: 1n << 8n, SET_ABI: 1n << 12n, SET_INTERFACE: 1n << 16n, SET_NAME: 1n << 20n, SET_DATA: 1n << 24n, LINK: 1n << 28n, CAN_NAME: 1n << 120n, UPGRADE: 1n << 124n,
};

export function decodeRoles(bitmap: bigint, table: Record<string, bigint>): string[] {
  const out: string[] = [];
  for (const [name, bit] of Object.entries(table)) {
    if (bitmap & bit) out.push(name);
    if (bitmap & (bit << 128n)) out.push(`${name}_ADMIN`);
  }
  // Admin-only: the transfer role has no regular form.
  if (table === REGISTRY_ROLES && bitmap & ((1n << 28n) << 128n)) out.push("CAN_TRANSFER_ADMIN");
  return out;
}

export interface AspEntry {
  label: string;
  name: string;
  resolver: Address;
  expiry: bigint;
  root: Hex | null;
  slot: bigint | null;
  policy: string | null;
  chainId: number | null;
  pool: Address | null;
  operator: Address | null;
  endpoint: string | null;
}

export interface RoleRow {
  /** "whole contract", or the text key or name this applies to. */
  scope: string;
  account: Address;
  roles: string[];
}

export interface NameAccess {
  name: string;
  registry: Address;
  resolver: Address;
  owner: Address | null;
  expiry: bigint;
  emancipated: boolean;
  registryRoles: RoleRow[];
  resolverRoles: RoleRow[];
}

export type RootCheck =
  /** The pool's chain holds exactly this root, from this operator, and the pool accepts that operator. */
  | { status: "verified"; source: Hex }
  /** The chain has no such root from this operator at this slot. Don't trust this record. */
  | { status: "mismatch"; source: Hex; stored: Hex; expected: Hex }
  /** The pool takes roots from someone else, so this name isn't this pool's ASP. */
  | { status: "wrong-operator"; poolSource: Hex | null; claimedSource: Hex }
  /** The root's slot has passed out of the recent-root window, so the chain can't confirm it any more. */
  | { status: "expired-slot"; slot: bigint; headSlot: bigint }
  /** ENS is valid, but the ASP's own server is already on a newer root. Normal for a moment after a change. */
  | { status: "stale"; ensRoot: Hex; serverRoot: Hex }
  | { status: "no-root" }
  /** The pool's chain can't be reached from here. Nothing has been verified. */
  | { status: "devnet-unreachable" };

// From the EIP-8272 predeploy's bytecode on the devnet. There is no getter, but its storage layout is deterministic.
const RECENT_ROOT: Address = "0x0000000000000000000000000000000000008272";
const VALUE_TAG: Hex = "0x8f42481679c8e6fefa040974b3c905e0ce3f2e464ba93acdb074a41181617efc";
const KEY_TAG: Hex = "0xbdc897da2177d260ff5f4be5d4b2aad43f89c3347a305b584fa5a2546d053daa";
/** Slots a root stays referenceable: the ring is 8192 entries, and one is the current slot. */
export const RECENT_ROOT_WINDOW = 8191n;

export const recentRootKey = (source: Hex, slot: bigint): Hex => keccak256(concat([KEY_TAG, source, numberToHex(slot & 0x1fffn, { size: 8 })]));
export const recentRootValue = (source: Hex, slot: bigint, root: Hex): Hex => keccak256(concat([VALUE_TAG, source, numberToHex(slot, { size: 8 }), root]));
export const aspSourceOf = (operator: Address, saltPreimage: string): Hex => keccak256(concat([operator, keccak256(toHex(saltPreimage))]));

/**
 * Tests an ASP's published root against the pool's chain, with no trust in ENS, the ASP's server or us:
 *  1. the pool's immutable ASP_SOURCE_ID must be this operator's source, so a re-registered name can't impersonate it;
 *  2. the recent-root predeploy must hold exactly this root, from this source, at this slot.
 */
export async function crossCheckRoot(asp: Pick<AspEntry, "root" | "slot" | "pool" | "operator">, opts: { rpc: string; saltPreimage: string; serverRoot?: Hex | null }): Promise<RootCheck> {
  if (!asp.root || asp.slot === null || !asp.pool || !asp.operator) return { status: "no-root" };
  const claimedSource = aspSourceOf(asp.operator, opts.saltPreimage);
  let poolSource: Hex | null;
  let stored: Hex;
  let headSlot: bigint;
  try {
    const raw = await rpc<Hex>(opts.rpc, "eth_call", [{ to: asp.pool, data: encodeFunctionData({ abi: POOL_SOURCE_ABI, functionName: "ASP_SOURCE_ID" }) }, "latest"]);
    poolSource = raw && raw !== "0x" ? raw : null;
    const head = await rpc<any>(opts.rpc, "eth_getBlockByNumber", ["latest", false]);
    headSlot = BigInt(head.slotNumber);
    stored = await rpc<Hex>(opts.rpc, "eth_getStorageAt", [RECENT_ROOT, recentRootKey(claimedSource, asp.slot), "latest"]);
  } catch {
    return { status: "devnet-unreachable" };
  }
  if (poolSource?.toLowerCase() !== claimedSource.toLowerCase()) return { status: "wrong-operator", poolSource, claimedSource };
  if (headSlot - asp.slot >= RECENT_ROOT_WINDOW) return { status: "expired-slot", slot: asp.slot, headSlot };
  const expected = recentRootValue(claimedSource, asp.slot, asp.root);
  if (stored.toLowerCase() !== expected.toLowerCase()) return { status: "mismatch", source: claimedSource, stored, expected };
  if (opts.serverRoot && opts.serverRoot.toLowerCase() !== asp.root.toLowerCase()) return { status: "stale", ensRoot: asp.root, serverRoot: opts.serverRoot };
  return { status: "verified", source: claimedSource };
}

/** Limits work if a directory ever grows, and stays within what public RPCs accept. */
async function pool<T, R>(items: T[], limit: number, work: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}

/** Public RPCs differ in what they refuse: the first one we read from also rejects real transactions, so a send falls through too. */
export function ensTransport(cfg: Pick<EnsConfig, "rpc" | "rpcFallbacks">) {
  const first = http(cfg.rpc, { retryCount: 4, retryDelay: 600 });
  return cfg.rpcFallbacks?.length ? fallback([first, ...cfg.rpcFallbacks.map((u) => http(u, { retryCount: 2, retryDelay: 600 }))]) : first;
}

export function createEnsReader(cfg: EnsConfig) {
  // Off on purpose: our names resolve on-chain, and a CCIP gateway would be one more party seeing each lookup.
  const client = createPublicClient({ chain: sepolia, transport: ensTransport(cfg), ccipRead: false });
  const ur = cfg.contracts.universalResolver;
  const read = (address: Address, functionName: any, args: any[] = []) => client.readContract({ address, abi: REGISTRY_ABI, functionName, args } as any) as Promise<any>;
  const text = (name: string, key: string) => client.getEnsText({ name, key, universalResolverAddress: ur }).catch(() => null);

  async function logs(address: Address, topics: (Hex | Hex[] | null)[], from: number | null = cfg.deployBlock): Promise<any[]> {
    const head = Number(await client.getBlockNumber());
    const start = from ?? 0;
    const ranges: [number, number][] = [];
    for (let lo = start; lo <= head; lo += cfg.logSpan) ranges.push([lo, Math.min(lo + cfg.logSpan - 1, head)]);
    const chunks = await pool(ranges, 2, ([lo, hi]) => client.request({ method: "eth_getLogs", params: [{ address, topics, fromBlock: toHex(lo), toBlock: toHex(hi) }] } as any) as Promise<any[]>);
    return chunks.flat();
  }

  const subregistry = (registry: Address, label: string): Promise<Address> => read(registry, "getSubregistry", [label]);

  async function directoryRegistry(): Promise<Address | null> {
    const r1 = await subregistry(cfg.contracts.ethRegistry, cfg.names.parentLabel);
    if (r1 === ZERO) return null;
    const r2 = await subregistry(r1, cfg.names.directoryLabel);
    return r2 === ZERO ? null : r2;
  }

  async function readAsp(registry: Address, label: string): Promise<AspEntry | null> {
    // Registries hide the resolver of an expired name, so this is also how an unrenewed ASP drops out.
    const resolver: Address = await read(registry, "getResolver", [label]);
    if (resolver === ZERO) return null;
    const name = `${label}.${cfg.names.directory}`;
    const k = cfg.recordKeys;
    const [expiry, root, slot, policy, chainId, pool_, operator, endpoint] = await Promise.all([
      read(registry, "getExpiry", [BigInt(labelhash(label))]),
      text(name, k.aspRoot), text(name, k.aspSlot), text(name, k.aspPolicy), text(name, k.aspChainId), text(name, k.aspPool), text(name, k.aspOperator), text(name, k.aspEndpoint),
    ]);
    return {
      label, name, resolver, expiry,
      root: /^0x[0-9a-fA-F]{64}$/.test(root ?? "") ? (root as Hex) : null,
      slot: /^\d+$/.test(slot ?? "") ? BigInt(slot!) : null,
      policy: policy || null,
      chainId: chainId && /^\d+$/.test(chainId) ? Number(chainId) : null,
      pool: /^0x[0-9a-fA-F]{40}$/.test(pool_ ?? "") ? (pool_ as Address) : null,
      operator: /^0x[0-9a-fA-F]{40}$/.test(operator ?? "") ? (operator as Address) : null,
      endpoint: endpoint || null,
    };
  }

  return {
    client,
    directoryRegistry,

    /** There's no on-chain list and wildcards can't enumerate, so the directory is whatever its registry has logged. */
    async listAsps(): Promise<AspEntry[]> {
      const registry = await directoryRegistry();
      if (!registry) return [];
      const raw = await logs(registry, encodeEventTopics({ abi: REGISTRY_ABI, eventName: "LabelRegistered" }) as Hex[]);
      const labels = [...new Set(raw.map((l) => (decodeEventLog({ abi: REGISTRY_ABI, data: l.data, topics: l.topics }) as any).args.label as string))];
      const entries = await pool(labels, 2, (label) => readAsp(registry, label));
      return entries.filter((e): e is AspEntry => e !== null);
    },

    /** Null for a name with no stealth record. Never reads `addr`: a fixed address is what this feature replaces. */
    async stealthMetaAddress(name: string): Promise<string | null> {
      return text(normalize(name), cfg.recordKeys.stealthMetaAddress);
    },

    /** Whether a receive name under the parent can still be claimed. */
    async isClaimable(label: string): Promise<boolean> {
      const r1 = await subregistry(cfg.contracts.ethRegistry, cfg.names.parentLabel);
      if (r1 === ZERO) return false;
      return (await read(r1, "getStatus", [BigInt(labelhash(normalize(label)))])) === 0;
    },

    /** Who can do what to a name, read from role events on its registry and resolver. No account list is assumed. */
    async nameAccess(name: string): Promise<NameAccess | null> {
      const labels = normalize(name).split(".");
      if (labels.at(-1) !== "eth") throw new Error("only .eth names are supported");
      let registry = cfg.contracts.ethRegistry;
      for (let i = labels.length - 2; i > 0; i--) {
        registry = await subregistry(registry, labels[i]);
        if (registry === ZERO) return null;
      }
      const label = labels[0];
      const id = BigInt(labelhash(label));
      const resolver: Address = await read(registry, "getResolver", [label]);
      if (resolver === ZERO) return null;
      const [expiry, emancipated, resource, tokenId] = await Promise.all([read(registry, "getExpiry", [id]), read(registry, "isEmancipated"), read(registry, "getResource", [id]), read(registry, "getTokenId", [id])]);
      const owner: Address = await read(registry, "latestOwnerOf", [tokenId]);

      const rolesChanged = encodeEventTopics({ abi: EAC_ABI, eventName: "EACRolesChanged" })[0] as Hex;
      const argument = encodeEventTopics({ abi: EAC_ABI, eventName: "ResourceArgument" })[0] as Hex;
      const rolesOf = async (contract: Address, table: Record<string, bigint>, topics: (Hex | Hex[] | null)[], scopeName?: Map<bigint, string>): Promise<RoleRow[]> => {
        const raw = await logs(contract, topics);
        const latest = new Map<string, { resource: bigint; account: Address; bitmap: bigint }>();
        const args = new Map<bigint, string>(scopeName);
        for (const log of raw) {
          let ev: any;
          try { ev = decodeEventLog({ abi: EAC_ABI, data: log.data, topics: log.topics }); } catch { continue; }
          if (ev.eventName === "ResourceArgument") {
            try { args.set(ev.args.resource, new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(ev.args.arg))); } catch { args.set(ev.args.resource, ev.args.arg); }
          } else {
            latest.set(`${ev.args.resource}:${ev.args.account}`, { resource: ev.args.resource, account: ev.args.account, bitmap: ev.args.newRoleBitmap });
          }
        }
        return [...latest.values()].filter((e) => e.bitmap !== 0n).map((e) => ({ scope: e.resource === 0n ? "whole contract" : args.get(e.resource) ?? numberToHex(e.resource), account: e.account, roles: decodeRoles(e.bitmap, table) }));
      };
      const [registryRoles, resolverRoles] = await Promise.all([
        // A registry can be busy, so ask only for this name's resource and the whole-contract one.
        rolesOf(registry, REGISTRY_ROLES, [rolesChanged, [numberToHex(0n, { size: 32 }), numberToHex(resource, { size: 32 })]], new Map([[resource, name]])),
        rolesOf(resolver, RESOLVER_ROLES, [[rolesChanged, argument]]),
      ]);
      return { name, registry, resolver, owner: owner === ZERO ? null : owner, expiry, emancipated, registryRoles, resolverRoles };
    },
  };
}

export type EnsReader = ReturnType<typeof createEnsReader>;

/** Whatever can send a transaction on Sepolia and wait for it: a browser wallet or a script's key. */
export interface EnsSender {
  address: Address;
  send(to: Address, data: Hex): Promise<{ logs: any[] }>;
}

const FULL_ROLES = BigInt(`0x${"1".repeat(64)}`);

/**
 * Claims a receive name in three steps: the owner's own resolver, its records and the app's narrow role, then the name.
 * The name is claimed last so it's never live without its record. Each person gets a resolver of their own, because a
 * resolver role covers every name on that instance.
 */
export async function claimReceiveName(cfg: EnsConfig, sender: EnsSender, opts: { label: string; metaAddress: string; appAddress: Address }): Promise<{ name: string; resolver: Address }> {
  if (!cfg.claimer) throw new Error("the name claimer isn't deployed yet");
  const label = normalize(opts.label);
  if (label.includes(".")) throw new Error("use a single name with no dots");
  const name = `${label}.${cfg.names.parent}`;
  // Free, and before anything is spent. The name is minted to this account, so a smart account that can't receive
  // ERC-1155 tokens would otherwise pay for two transactions and then fail on the third.
  try {
    await createEnsReader(cfg).client.call({ account: sender.address, to: cfg.claimer, data: encodeFunctionData({ abi: CLAIMER_ABI, functionName: "claim", args: [label, ZERO] }) });
  } catch {
    throw new Error("This wallet can't claim that name. It may already be taken, or this may be a smart account that can't receive the name. Nothing was spent. Try another name or wallet.");
  }

  // New each attempt: with a fixed salt, a claim abandoned after this step could never be retried, because the second
  // deployment would collide with the first. An abandoned resolver serves no name, and costs nothing but its gas.
  const attempt = bytesToBigInt(crypto.getRandomValues(new Uint8Array(32)));
  const salt = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [keccak256(stringToHex("OwnedResolver")), sender.address, attempt])));
  const init = encodeFunctionData({ abi: parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)"]), args: [[{ account: sender.address, roleBitmap: FULL_ROLES }], []] });
  const deployed = await sender.send(cfg.contracts.verifiableFactory, encodeFunctionData({ abi: FACTORY_ABI, functionName: "deployProxy", args: [cfg.contracts.permissionedResolverImpl, salt, init] }));
  const [event] = parseEventLogs({ abi: FACTORY_ABI, logs: deployed.logs, eventName: "ProxyDeployed" });
  const resolver = (event.args as any).proxyAddress as Address;

  const key = cfg.recordKeys.stealthMetaAddress;
  const setter = encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: ["0x", key, ""] });
  await sender.send(resolver, encodeFunctionData({ abi: RESOLVER_ABI, functionName: "multicall", args: [[
    encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dnsEncode(name), key, opts.metaAddress] }),
    encodeFunctionData({ abi: RESOLVER_ABI, functionName: "grantSetterRoles", args: [setter, opts.appAddress] }),
  ]] }));
  await sender.send(cfg.claimer, encodeFunctionData({ abi: CLAIMER_ABI, functionName: "claim", args: [label, resolver] }));
  return { name, resolver };
}

/** Sets the stealth record. The app key can call this and, by design, nothing else on the resolver. */
export const setStealthRecordCall = (cfg: EnsConfig, name: string, metaAddress: string): Hex =>
  encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dnsEncode(normalize(name)), cfg.recordKeys.stealthMetaAddress, metaAddress] });

/** Writes an ASP's root and slot together, so a reader never sees one without the other. */
export const publishRootCall = (cfg: EnsConfig, name: string, root: Hex, slot: bigint): Hex => {
  const dns = dnsEncode(name);
  const set = (key: string, value: string) => encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dns, key, value] });
  return encodeFunctionData({ abi: RESOLVER_ABI, functionName: "multicall", args: [[set(cfg.recordKeys.aspRoot, root), set(cfg.recordKeys.aspSlot, slot.toString())]] });
};

