// Shared by the Sepolia scripts. Nothing here touches the local chain.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, encodeAbiParameters, http, keccak256, namehash, parseAbi, parseEther, parseEventLogs, stringToHex, toHex, packetToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export const CONFIG_PATH = "config/ens.sepolia.json";
export const STATE_PATH = ".relayless/ens-sepolia.json";
export const loadEnsConfig = () => JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
export const saveEnsConfig = (c: unknown) => writeFileSync(CONFIG_PATH, `${JSON.stringify(c, null, 2)}\n`);

/** Work in progress, such as a commitment secret. Lives outside git and survives a crash between steps. */
export const loadState = (): any => (existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {});
export function saveState(s: unknown) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

export const ZERO: Address = "0x0000000000000000000000000000000000000000";
export const FULL_ROLES = BigInt(`0x${"1".repeat(64)}`);
export const ADMIN = (r: bigint) => r << 128n;
export const REG = { REGISTRAR: 1n << 0n, SET_PARENT: 1n << 8n, RENEW: 1n << 16n, SET_SUBREGISTRY: 1n << 20n, SET_RESOLVER: 1n << 24n };

export const REGISTRY_ABI = parseAbi([
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function setParent(address parent, string label)",
  "function getParent() view returns (address, string)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function getStatus(uint256 anyId) view returns (uint8)",
  "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function revokeRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
  "function isEmancipated() view returns (bool)",
]);
export const RESOLVER_ABI = parseAbi([
  "function setText(bytes name, string key, string value)",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
  "function multicall(bytes[] calls) returns (bytes[])",
]);
export const FACTORY_ABI = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);
export const REGISTRAR_ABI = parseAbi([
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
  "function MIN_COMMITMENT_AGE() view returns (uint256)",
]);
export const ERC20_ABI = parseAbi(["function mint(address to, uint256 amount)", "function approve(address spender, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

export const dnsName = (name: string): Hex => toHex(packetToBytes(name));

export function sepoliaClient(cfg: any) {
  return createPublicClient({ chain: sepolia, transport: http(cfg.rpc) });
}

export function requireKey(name: string): Hex {
  const v = process.env[name];
  if (!v || v === "0x") throw new Error(`set ${name} in .env`);
  return v as Hex;
}

export function actor(cfg: any, key: Hex) {
  const account = privateKeyToAccount(key);
  const pub = sepoliaClient(cfg);
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(cfg.rpc) });
  /** Simulates first, so a call that would fail costs nothing. */
  const write = async (label: string, address: Address, abi: any, functionName: string, args: unknown[]) => {
    const { request } = await pub.simulateContract({ account, address, abi, functionName, args } as any);
    const hash = await wallet.writeContract(request as any);
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`${label}: ${cfg.explorer}/tx/${hash}`);
    return receipt;
  };
  const sendEth = async (label: string, to: Address, value: bigint) => {
    const hash = await wallet.sendTransaction({ to, value });
    await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
    console.log(`${label}: ${cfg.explorer}/tx/${hash}`);
  };
  const deployProxy = async (label: string, implementation: Address, salt: bigint, data: Hex): Promise<Address> => {
    const receipt = await write(label, cfg.contracts.verifiableFactory, FACTORY_ABI, "deployProxy", [implementation, salt, data]);
    const [event] = parseEventLogs({ abi: FACTORY_ABI, logs: receipt.logs, eventName: "ProxyDeployed" });
    return (event.args as any).proxyAddress;
  };
  return { account, pub, wallet, write, sendEth, deployProxy };
}

export const registrySalt = (name: string): bigint =>
  BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [keccak256(stringToHex("UserRegistry")), namehash(name), 0n])));

/** `version` lets one owner hold several resolvers, which it needs: resolver roles cover every name on an instance. */
export const resolverSalt = (owner: Address, version: bigint): bigint =>
  BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [keccak256(stringToHex("OwnedResolver")), owner, version])));

export const registryInit = (account: Address, roleBitmap: bigint): Hex =>
  encodeFunctionData({ abi: parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants)"]), args: [[{ account, roleBitmap }]] });

export const resolverInit = (owner: Address): Hex =>
  encodeFunctionData({ abi: parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)"]), args: [[{ account: owner, roleBitmap: FULL_ROLES }], []] });

/** Only the selector and the key matter: the role covers that key on every name the resolver serves. */
export const textSetter = (key: string): Hex => encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: ["0x", key, ""] });

export const MIN_BALANCE = parseEther("0.01");
export const TOP_UP = parseEther("0.03");
