// Measures the SENDER frame's worst-case execution gas at the circuit's full tree depth, on the live client's own gas
// schedule (EIP-8037/8038 on hegota-8141), against the validator's pinned minimum. Foundry can't do this: its EVM
// doesn't price state gas, and its cold-access costs are older.
//
// The worst case: 2^20 - 2 leaves at depth 20 (19 of 20 levels hash), a recipient that burns its whole 100,000 gas,
// so the payment is deferred and a claim written. Run through WorstCaseHarness, which is the pool's own code plus a
// way to stage the tree. usage: tsx scripts/gas-floors.ts [network]   (needs DEPLOYER_KEY)
import { readFileSync, writeFileSync } from "node:fs";
import { decodeEventLog, encodeDeployData, encodeFunctionData, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { profileOf } from "@relayless/sdk";
import { loadConfig, mined, rpc } from "./lib.js";

const network = process.argv[2] ?? "local-hegota";
const cfg = loadConfig(network);
const profile = profileOf(cfg.profile);
const key = process.env.DEPLOYER_KEY as Hex;
if (!key) throw new Error("set DEPLOYER_KEY");
const account = privateKeyToAccount(key);
const art = (p: string) => JSON.parse(readFileSync(`packages/contracts/out/${p}`, "utf8"));
const built = JSON.parse(readFileSync(`packages/contracts/generated/validator.${profile.id}.json`, "utf8"));

async function send(to: Address | null, data: Hex, value = 0n, gas = 3_000_000n) {
  const nonce = Number(await rpc(cfg.rpc, "eth_getTransactionCount", [account.address, "pending"]));
  const block = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
  const raw = await account.signTransaction({ chainId: cfg.chainId, nonce, to, value, data, gas, gasPrice: BigInt(block.baseFeePerGas) * 3n + 1_000_000_000n, type: "legacy" });
  return mined(cfg, await rpc<Hex>(cfg.rpc, "eth_sendRawTransaction", [raw]));
}

// The harness inherits the pool, so it links the same Poseidon libraries.
const h = art("Adversaries.sol/WorstCaseHarness.json");
let code: string = h.bytecode.object.slice(2);
for (const libs of Object.values(h.bytecode.linkReferences as Record<string, Record<string, { start: number; length: number }[]>>)) {
  for (const [name, spots] of Object.entries(libs)) {
    const addr = (name === "PoseidonT3" ? cfg.poseidonT3 : cfg.poseidonT4).slice(2).toLowerCase();
    for (const { start, length } of spots) code = code.slice(0, start * 2) + addr + code.slice((start + length) * 2);
  }
}
const harness = (await send(null, encodeDeployData({ abi: h.abi, bytecode: `0x${code}` as Hex, args: [profile.recentRoot] }), 0n, 10_000_000n)).contractAddress as Address;
const burner = (await send(null, art("Adversaries.sol/Burner.json").bytecode.object)).contractAddress as Address;
await send(harness, encodeFunctionData({ abi: h.abi, functionName: "stage", args: [(1n << 20n) - 2n, 20n] }), 0n, 5_000_000n);

// Gas above EIP-7825's 2^24 goes to the state reservoir, so GAS inside reads execution gas only.
const r = await send(harness, encodeFunctionData({ abi: h.abi, functionName: "measure", args: [burner, parseEther("1"), 777n] }), parseEther("1"), (1n << 24n) + 3_000_000n);
const log = r.logs.map((l: any) => { try { return decodeEventLog({ abi: h.abi, data: l.data, topics: l.topics }); } catch { return null; } }).find((e: any) => e?.eventName === "Measured");
const execution = Number((log as any).args.executionUsed);
const claimed = r.logs.some((l: any) => { try { return (decodeEventLog({ abi: h.abi, data: l.data, topics: l.topics }) as any).eventName === "PaymentDeferred"; } catch { return false; } });

const floor = built.minSenderExec as number;
const out = { network, profile: profile.id, at: new Date().toISOString(), tx: r.transactionHash, worstCaseExecution: execution, deferredPayment: claimed, validatorMinimum: floor, headroom: floor - execution };
writeFileSync(`.relayless-gas-floors-${network}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (!claimed || execution >= floor) {
  console.log("FAIL: the worst case doesn't fit under the validator's minimum, or didn't take the deferred path");
  process.exit(1);
}
console.log(`PASS  full-depth worst case uses ${execution} execution gas, under the ${floor} minimum (${floor - execution} spare)`);
