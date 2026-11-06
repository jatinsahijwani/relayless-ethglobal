// Adds an ASP to the directory: its own resolver, an operator role on exactly the root and policy records, and a
// non-transferable, expiring name in the directory.
// usage: set -a; . ./.env; set +a
//        npx tsx scripts/ens/add-asp.ts --label world --network local-asp --operator-env ASP_KEY --policy "World ID: one unique human"
//
// Safe to rerun. Refuses to name an operator the pool doesn't accept roots from, so the directory can't start out wrong.
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { concat, encodeFunctionData, formatEther, keccak256, labelhash, parseAbi, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rpc } from "../../packages/sdk/src/chain.js";
import { MIN_BALANCE, REG, REGISTRY_ABI, RESOLVER_ABI, TOP_UP, ZERO, actor, dnsName, loadEnsConfig, requireKey, resolverInit, resolverSalt, sepoliaClient, textSetter } from "./lib.js";

const { values: a } = parseArgs({ options: { label: { type: "string" }, network: { type: "string" }, "operator-env": { type: "string" }, policy: { type: "string" }, endpoint: { type: "string" } } });
if (!a.label || !a.network || !a["operator-env"] || !a.policy) throw new Error("need --label, --network, --operator-env and --policy");

const cfg = loadEnsConfig();
const keys = cfg.recordKeys;
const pub = sepoliaClient(cfg);
const local = JSON.parse(readFileSync(`config/${a.network}.deployed.json`, "utf8"));
const operatorKey = requireKey(a["operator-env"]);
const operator = privateKeyToAccount(operatorKey).address;
const pool: Address = local.pool;
const endpoint = a.endpoint ?? local.aspUrl ?? "";
const name = `${a.label}.${cfg.names.directory}`;
const dns = dnsName(name);

const poolSource: Hex = await rpc(local.rpc, "eth_call", [{ to: pool, data: encodeFunctionData({ abi: parseAbi(["function ASP_SOURCE_ID() view returns (bytes32)"]), functionName: "ASP_SOURCE_ID" }) }, "latest"]);
const expected = keccak256(concat([operator, keccak256(toHex(cfg.aspSaltPreimage))]));
if (poolSource !== expected) throw new Error(`${pool} takes roots from ${poolSource}, but ${operator} would publish as ${expected}`);

const curator = actor(cfg, requireKey("SEPOLIA_DEPLOYER_KEY"));
const owner = actor(cfg, requireKey("ASP_OWNER_KEY"));
const opActor = actor(cfg, operatorKey);

for (const [who, address] of [["owner", owner.account.address], ["operator", operator]] as const) {
  if ((await pub.getBalance({ address })) < MIN_BALANCE) await curator.sendEth(`gas for ${who} ${address}`, address, TOP_UP);
}

const r1: Address = await pub.readContract({ address: cfg.contracts.ethRegistry, abi: REGISTRY_ABI, functionName: "getSubregistry", args: [cfg.names.parentLabel] });
const r2: Address = await pub.readContract({ address: r1, abi: REGISTRY_ABI, functionName: "getSubregistry", args: [cfg.names.directoryLabel] });
let resolver: Address = await pub.readContract({ address: r2, abi: REGISTRY_ABI, functionName: "getResolver", args: [a.label] });

if (resolver === ZERO) {
  // The owner configures its resolver first, so the name is never live with half its records.
  resolver = await owner.deployProxy(`resolver for ${name}`, cfg.contracts.permissionedResolverImpl, resolverSalt(owner.account.address, BigInt(labelhash(a.label))), resolverInit(owner.account.address));
  const text = (key: string, value: string) => encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dns, key, value] });
  const grant = (key: string) => encodeFunctionData({ abi: RESOLVER_ABI, functionName: "grantSetterRoles", args: [textSetter(key), operator] });
  await owner.write(`records and operator role for ${name}`, resolver, RESOLVER_ABI, "multicall", [[
    text(keys.aspChainId, String(local.chainId)),
    text(keys.aspPool, pool),
    text(keys.aspOperator, operator),
    text(keys.aspEndpoint, endpoint),
    text(keys.aspPolicy, a.policy),
    grant(keys.aspRoot),
    grant(keys.aspSlot),
    grant(keys.aspPolicy),
  ]]);
  const now = (await pub.getBlock()).timestamp;
  // No transfer role and no ROLE_UNREGISTER: the owner can move its records, not sell or release the name.
  await curator.write(`register ${name}`, r2, REGISTRY_ABI, "register", [a.label, owner.account.address, ZERO, resolver, REG.SET_RESOLVER, now + BigInt(cfg.durations.aspSeconds)]);
}
console.log(`${name}: resolver ${resolver}, operator ${operator}`);

// Publish the current root right away if this ASP already has one.
const statePath = `.relayless/asp-${a.network}.json`;
const ref = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")).ref : null;
if (ref) {
  const text = (key: string, value: string) => encodeFunctionData({ abi: RESOLVER_ABI, functionName: "setText", args: [dns, key, value] });
  await opActor.write(`publish root for ${name}`, resolver, RESOLVER_ABI, "multicall", [[text(keys.aspRoot, ref.root), text(keys.aspSlot, ref.slot)]]);
}
console.log(`curator balance ${formatEther(await pub.getBalance({ address: curator.account.address }))} ETH`);
