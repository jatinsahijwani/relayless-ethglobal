// Deploys the sidecar's NaiveStakingRegistry to a local chain and prints its address.
// usage: node scripts/deploy-registry.mjs <path to NaiveStakingRegistry.sol>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const require = createRequire(new URL("../packages/contracts/package.json", import.meta.url));
const solc = require("solc");
const RPC = process.env.RPC ?? "http://127.0.0.1:18545";
const call = async (method, params) => {
  const body = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
};
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "R.sol": { content: readFileSync(process.argv[2], "utf8") } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["evm.bytecode.object"] } } } })));
for (const e of out.errors ?? []) if (e.severity === "error") throw new Error(e.formattedMessage);
const account = privateKeyToAccount(process.env.DEPLOYER_KEY);
const block = await call("eth_getBlockByNumber", ["latest", false]);
const raw = await account.signTransaction({ chainId: Number(await call("eth_chainId", [])), nonce: Number(await call("eth_getTransactionCount", [account.address, "pending"])), to: null, data: `0x${out.contracts["R.sol"].NaiveStakingRegistry.evm.bytecode.object}`, gas: 8_000_000n, gasPrice: BigInt(block.baseFeePerGas) * 3n + 1000n, type: "legacy" });
const hash = await call("eth_sendRawTransaction", [raw]);
for (let i = 0; i < 90; i++) {
  const r = await call("eth_getTransactionReceipt", [hash]);
  if (r) {
    if (r.status !== "0x1") throw new Error("registry deploy reverted");
    console.log(r.contractAddress);
    process.exit(0);
  }
  await new Promise((res) => setTimeout(res, 1000));
}
throw new Error("registry deploy not mined");
