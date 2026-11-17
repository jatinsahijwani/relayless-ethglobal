// Checks a public chain before spending anything on it: the right chain, the client revision the profile was built for,
// the predeploys, our encoding accepted by the node, and enough funds for the run. Sends nothing.
// usage: tsx scripts/testnet-preflight.ts [network]   (default hegota-8141; reads DEPLOYER_KEY for the balance check)
import { readFileSync } from "node:fs";
import { formatEther, keccak256, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildWithdrawal, profileOf, rawOf } from "@relayless/sdk";
import { rpc } from "../packages/sdk/src/chain.js";

const network = process.argv[2] ?? "hegota-8141";
const cfg = JSON.parse(readFileSync(`config/${network}.json`, "utf8"));
const profile = profileOf(cfg.profile);
// What the run spends, generously: deploys (about 60M gas at the chain's few-wei base fee), the pool's gas reserve,
// five 0.02 ETH deposits, and gas held per withdrawal (refunded, mostly).
export const RUN_BUDGET = parseEther("0.15");
const EXPECTED = {
  "hegota-8141": { client: "64b8fc09", recentRootCodeHash: "0xcd1cae00e1d37cf97195f9e716dfa1b9a804e36bb5d7726c4f2c50e2580275a5" },
} as Record<string, { client: string; recentRootCodeHash: Hex }>;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const chainId = Number(await rpc(cfg.rpc, "eth_chainId", []));
check(`chain id is ${cfg.chainId}`, chainId === cfg.chainId, String(chainId));
const client: string = await rpc(cfg.rpc, "web3_clientVersion", []);
const want = EXPECTED[profile.id];
check(`the node runs the client revision ${profile.id} was built for`, Boolean(want) && client.includes(want.client), client);
const rootCode: Hex = await rpc(cfg.rpc, "eth_getCode", [profile.recentRoot, "latest"]);
check("the recent-root contract is the expected bytecode", Boolean(want) && keccak256(rootCode) === want.recentRootCodeHash, `${profile.recentRoot}, ${keccak256(rootCode).slice(0, 12)}…`);
const nonceCode: Hex = await rpc(cfg.rpc, "eth_getCode", [profile.nonceManager, "latest"]);
check("the nonce manager is installed", nonceCode !== "0x", profile.nonceManager);
const head = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
check("blocks carry the EIP-7843 slot", head.slotNumber !== undefined, `block ${BigInt(head.number)}, slot ${BigInt(head.slotNumber)}, base fee ${BigInt(head.baseFeePerGas)} wei`);

// The node decodes our envelope and reads the root frame: a dummy withdrawal must fail on its root, not on its bytes.
const dummy = buildWithdrawal(profile, {
  pool: "0x00000000000000000000000000000000000ba5e1", chainId, recipient: "0x000000000000000000000000000000000000c0de", amount: 10n ** 16n, fee: 10n ** 15n,
  changeCommitment: 5n, nullifierHash: 77n, k: 0n, refs: [{ sourceId: `0x${"11".repeat(32)}`, slot: 1n, root: `0x${"22".repeat(32)}` }],
  maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n,
});
const sim = await rpc(cfg.rpc, "ethrex_simulateFrameTransaction", profile.simulateParams(rawOf(profile, dummy))).catch((e: Error) => ({ error: e.message }));
check("the node decodes our transaction and reads its recent-root frame", !("error" in sim) && /recent-root/i.test(sim.violation ?? ""), "error" in sim ? sim.error : sim.violation);

const key = process.env.DEPLOYER_KEY as Hex | undefined;
if (key) {
  const address = privateKeyToAccount(key).address;
  const balance = BigInt(await rpc(cfg.rpc, "eth_getBalance", [address, "latest"]));
  check(`the deployer holds at least ${formatEther(RUN_BUDGET)} ETH for the run`, balance >= RUN_BUDGET, `${address}: ${formatEther(balance)} ETH`);
} else {
  console.log("SKIP  balance: no DEPLOYER_KEY (make one with scripts/testnet-key.sh)");
}
console.log(failures ? `\n${failures} check(s) failed: don't deploy\n` : "\nready to deploy\n");
process.exit(failures ? 1 : 0);
