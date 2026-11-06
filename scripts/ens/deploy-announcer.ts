// Deploys the ERC-5564 announcer to the running local chain. Touches nothing else: no pool, no restart.
// usage: set -a; . ./.env; set +a; npx tsx scripts/ens/deploy-announcer.ts [network]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, mined, rpc } from "../lib.js";

const network = process.argv[2] ?? "local";
const cfg = loadConfig(network);
const path = "config/local.announcer.deployed.json";
if (existsSync(path)) {
  const prior = JSON.parse(readFileSync(path, "utf8"));
  if ((await rpc(cfg.rpc, "eth_getCode", [prior.announcer, "latest"])) !== "0x") {
    console.log(`already deployed: ${prior.announcer}`);
    process.exit(0);
  }
}
const account = privateKeyToAccount(process.env.DEPLOYER_KEY as Hex);
const art = JSON.parse(readFileSync("packages/ens/out/ERC5564Announcer.sol/ERC5564Announcer.json", "utf8"));
const nonce = Number(await rpc(cfg.rpc, "eth_getTransactionCount", [account.address, "pending"]));
const block = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
const raw = await account.signTransaction({ chainId: cfg.chainId, nonce, data: art.bytecode.object, gas: 30_000_000n, gasPrice: BigInt(block.baseFeePerGas) * 3n + 1000n, type: "legacy" });
const receipt = await mined(cfg, await rpc<Hex>(cfg.rpc, "eth_sendRawTransaction", [raw]));
writeFileSync(path, `${JSON.stringify({ announcer: receipt.contractAddress, deployBlock: Number(receipt.blockNumber) }, null, 2)}\n`);
console.log(`announcer ${receipt.contractAddress}, block ${Number(receipt.blockNumber)}`);
