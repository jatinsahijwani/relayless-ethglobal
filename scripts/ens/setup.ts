// Sets up relayless.eth on ENSv2 Sepolia: the two subname registries, the name claimer, and the `asp` directory.
// usage: set -a; . ./.env; set +a; npx tsx scripts/ens/setup.ts
//
// Safe to rerun: each step reads the chain first and does nothing if it's already done. Registering needs a commitment
// to wait a minute, so its secret is kept in .relayless/ until the registration lands.
import { readFileSync } from "node:fs";
import { formatEther, labelhash, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { ADMIN, ERC20_ABI, REG, REGISTRAR_ABI, REGISTRY_ABI, ZERO, actor, loadEnsConfig, loadState, registryInit, registrySalt, requireKey, saveEnsConfig, saveState } from "./lib.js";

const cfg = loadEnsConfig();
const { contracts: c, names, durations } = cfg;
const curator = actor(cfg, requireKey("SEPOLIA_DEPLOYER_KEY"));
const { pub, write } = curator;
const me = curator.account.address;
const state = loadState();
const startBalance = await pub.getBalance({ address: me });
if (startBalance === 0n) throw new Error(`fund ${me} with Sepolia ETH first`);
console.log(`curator ${me}, ${formatEther(startBalance)} ETH`);
const startBlock = await pub.getBlockNumber();

const read = (address: Address, abi: any, functionName: string, args: unknown[] = []) => pub.readContract({ address, abi, functionName, args } as any) as Promise<any>;

// Temporary roles are dropped at the end. Neither registry ever gets ROLE_UPGRADE, UNREGISTER, SET_RESOLVER or
// SET_SUBREGISTRY at root, which is what keeps isEmancipated() true.
const R1_TEMP = REG.REGISTRAR | REG.SET_PARENT | ADMIN(REG.REGISTRAR) | ADMIN(REG.SET_PARENT);
const R2_TEMP = REG.SET_PARENT | ADMIN(REG.SET_PARENT);
const R2_KEPT = REG.REGISTRAR | REG.RENEW;

const parentId = BigInt(labelhash(names.parentLabel));
let r1: Address = await read(c.ethRegistry, REGISTRY_ABI, "getSubregistry", [names.parentLabel]);
const parentRegistered = r1 !== ZERO;

if (!parentRegistered) {
  r1 = state.r1 ?? (await curator.deployProxy("R1 registry", c.userRegistryImpl, registrySalt(names.parent), registryInit(me, R1_TEMP)));
  state.r1 = r1;
  saveState(state);
}
console.log(`R1 ${r1}`);

let r2: Address = await read(r1, REGISTRY_ABI, "getSubregistry", [names.directoryLabel]);
if (r2 === ZERO) {
  r2 = state.r2 ?? (await curator.deployProxy("R2 registry", c.userRegistryImpl, registrySalt(names.directory), registryInit(me, R2_TEMP | R2_KEPT)));
  state.r2 = r2;
  saveState(state);
}
console.log(`R2 ${r2}`);

if (!parentRegistered) {
  const status = await read(c.ethRegistry, REGISTRY_ABI, "getStatus", [parentId]);
  if (status !== 0) throw new Error(`${names.parent} isn't available and doesn't point to a registry: choose another name in config/ens.sepolia.json`);
  const duration = BigInt(durations.parentSeconds);
  const [base, premium] = await read(c.ethRegistrar, REGISTRAR_ABI, "getRegisterPrice", [names.parentLabel, duration, c.mockUsdc]);
  const price: bigint = base + premium;
  if ((await read(c.mockUsdc, ERC20_ABI, "balanceOf", [me])) < price) await write("mint MockUSDC", c.mockUsdc, ERC20_ABI, "mint", [me, price]);
  await write("approve registrar", c.mockUsdc, ERC20_ABI, "approve", [c.ethRegistrar, price]);

  const referrer: Hex = `0x${"00".repeat(32)}`;
  if (!state.commit) {
    const secret = generatePrivateKey();
    const commitment = await read(c.ethRegistrar, REGISTRAR_ABI, "makeCommitment", [names.parentLabel, me, secret, r1, ZERO, duration, referrer]);
    await write(`commit ${names.parent}`, c.ethRegistrar, REGISTRAR_ABI, "commit", [commitment]);
    state.commit = { secret, at: Date.now() };
    saveState(state);
  }
  const age = Number(await read(c.ethRegistrar, REGISTRAR_ABI, "MIN_COMMITMENT_AGE"));
  const waitMs = state.commit.at + (age + 15) * 1000 - Date.now();
  if (waitMs > 0) {
    console.log(`waiting ${Math.ceil(waitMs / 1000)} s for the commitment to age`);
    await new Promise((res) => setTimeout(res, waitMs));
  }
  await write(`register ${names.parent}`, c.ethRegistrar, REGISTRAR_ABI, "register", [names.parentLabel, me, state.commit.secret, r1, ZERO, duration, c.mockUsdc, referrer]);
  delete state.commit;
  saveState(state);
}

const [r1Parent] = await read(r1, REGISTRY_ABI, "getParent");
if (r1Parent.toLowerCase() !== c.ethRegistry.toLowerCase()) await write("R1 parent", r1, REGISTRY_ABI, "setParent", [c.ethRegistry, names.parentLabel]);

if ((await read(r1, REGISTRY_ABI, "getSubregistry", [names.directoryLabel])) === ZERO) {
  // Registered before the claimer can exist as a registrar, so nobody can claim `asp` as a receive name.
  await write(`register ${names.directory}`, r1, REGISTRY_ABI, "register", [names.directoryLabel, me, r2, ZERO, REG.SET_SUBREGISTRY | ADMIN(REG.SET_SUBREGISTRY), 2n ** 64n - 1n]);
}
const [r2Parent] = await read(r2, REGISTRY_ABI, "getParent");
if (r2Parent.toLowerCase() !== r1.toLowerCase()) await write("R2 parent", r2, REGISTRY_ABI, "setParent", [r1, names.directoryLabel]);

if (!cfg.claimer) {
  const art = JSON.parse(readFileSync("packages/ens/out/RelaylessNameClaimer.sol/RelaylessNameClaimer.json", "utf8"));
  const hash = await curator.wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [r1] });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
  if (receipt.status !== "success") throw new Error(`claimer deploy reverted: ${hash}`);
  cfg.claimer = receipt.contractAddress;
  console.log(`claimer ${cfg.claimer}: ${cfg.explorer}/tx/${hash}`);
}
if (!(await read(r1, REGISTRY_ABI, "hasRootRoles", [REG.REGISTRAR, cfg.claimer]))) await write("claimer role", r1, REGISTRY_ABI, "grantRootRoles", [REG.REGISTRAR, cfg.claimer]);

// The curator keeps nothing on R1 and only REGISTRAR and RENEW on R2. Done last, because it can't be undone.
if (await read(r1, REGISTRY_ABI, "hasRootRoles", [REG.REGISTRAR, me])) await write("drop curator roles on R1", r1, REGISTRY_ABI, "revokeRootRoles", [R1_TEMP, me]);
if (await read(r2, REGISTRY_ABI, "hasRootRoles", [REG.SET_PARENT, me])) await write("drop parent role on R2", r2, REGISTRY_ABI, "revokeRootRoles", [R2_TEMP, me]);

if (!(await read(r1, REGISTRY_ABI, "isEmancipated")) || !(await read(r2, REGISTRY_ABI, "isEmancipated"))) throw new Error("a registry isn't emancipated: stop and investigate");

cfg.deployBlock ??= Number(startBlock);
saveEnsConfig(cfg);
const spent = startBalance - (await pub.getBalance({ address: me }));
console.log(`done. R1 ${r1}, R2 ${r2}, claimer ${cfg.claimer}. Spent ${formatEther(spent)} ETH this run.`);
