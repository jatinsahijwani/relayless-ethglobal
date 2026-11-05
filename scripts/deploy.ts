// Deploys the Poseidon libraries, the validator and the pool, then writes config/<network>.deployed.json.
// usage: DEPLOYER_KEY=0x... tsx scripts/deploy.ts <network>
import { readFileSync, writeFileSync } from "node:fs";
import { encodeDeployData, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rpc } from "../packages/sdk/src/chain.js";

const network = process.argv[2] ?? "local";
const cfg = JSON.parse(readFileSync(`config/${network}.json`, "utf8"));
const key = process.env.DEPLOYER_KEY as Hex;
if (!key) throw new Error("set DEPLOYER_KEY");
const account = privateKeyToAccount(key);
const art = (p: string) => JSON.parse(readFileSync(`packages/contracts/out/${p}`, "utf8"));

async function send(to: Address | null, data: Hex, value = 0n, gas = 45_000_000n) {
  const nonce = Number(await rpc(cfg.rpc, "eth_getTransactionCount", [account.address, "pending"]));
  const block = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
  const raw = await account.signTransaction({ chainId: cfg.chainId, nonce, to, value, data, gas, gasPrice: BigInt(block.baseFeePerGas) * 3n + 1000n, type: "legacy" });
  const hash = await rpc<Hex>(cfg.rpc, "eth_sendRawTransaction", [raw]);
  for (let i = 0; i < 90; i++) {
    const r = await rpc(cfg.rpc, "eth_getTransactionReceipt", [hash]);
    if (r) {
      if (r.status !== "0x1") throw new Error(`reverted: ${hash}`);
      return r;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`not mined: ${hash}`);
}

const deployed = async (label: string, bytecode: Hex, value = 0n): Promise<Address> => {
  const r = await send(null, bytecode, value);
  console.log(`${label}: ${r.contractAddress} (gas ${Number(r.gasUsed)})`);
  return r.contractAddress;
};

const t3 = await deployed("PoseidonT3", art("PoseidonT3.sol/PoseidonT3.json").bytecode.object);
const t4 = await deployed("PoseidonT4", art("PoseidonT4.sol/PoseidonT4.json").bytecode.object);
const validator = await deployed("Validator", JSON.parse(readFileSync("packages/contracts/generated/validator.json", "utf8")).bytecode);

const poolArt = art("RelaylessPool.sol/RelaylessPool.json");
let code: string = poolArt.bytecode.object.slice(2);
const refs = poolArt.bytecode.linkReferences as Record<string, Record<string, { start: number; length: number }[]>>;
for (const [file, libs] of Object.entries(refs)) {
  for (const [name, spots] of Object.entries(libs)) {
    const addr = (name === "PoseidonT3" ? t3 : t4).slice(2).toLowerCase();
    for (const { start, length } of spots) code = code.slice(0, start * 2) + addr + code.slice((start + length) * 2);
    void file;
  }
}
// An association-set pool names its ASP's root source in the constructor.
if (process.env.ASP_SOURCE_ID) cfg.aspSourceId = process.env.ASP_SOURCE_ID;
const stake = parseEther(cfg.stakeEth);
const reserve = parseEther(cfg.reserveEth);
const data = encodeDeployData({ abi: poolArt.abi, bytecode: `0x${code}` as Hex, args: [validator, cfg.stakingRegistry, stake, cfg.unstakeDelaySec, cfg.aspSourceId ?? `0x${"00".repeat(32)}`] });
const pool = await deployed("RelaylessPool", data, stake + reserve);

const { feeRange } = JSON.parse(readFileSync("packages/contracts/generated/validator.json", "utf8"));
writeFileSync(`config/${network}.deployed.json`, JSON.stringify({ ...cfg, pool, validator, poseidonT3: t3, poseidonT4: t4, feeRange }, null, 2));
console.log(`written config/${network}.deployed.json`);
