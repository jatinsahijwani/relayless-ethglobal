// Hostile recipients against a live pool. Each gets a real withdrawal, which must still settle after APPROVE: the
// SENDER frame succeeds, the nullifier is spent, the change note is kept, and the payment is either made or kept as a
// claim. A failure here means a note can burn, so every case is asserted and any failure exits non-zero.
// usage: tsx scripts/adversarial.ts [network]   (needs DEPLOYER_KEY, and pnpm build:contracts first)
import { readFileSync, writeFileSync } from "node:fs";
import { encodeDeployData, encodeFunctionData, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { POOL_ABI, profileOf, type Note } from "@relayless/sdk";
import { balanceOf, connect, fundedKey, loadConfig, mined, rpc, stopWorkers } from "./lib.js";

const network = process.argv[2] ?? "local";
const cfg = loadConfig(network);
const deployerKey = process.env.DEPLOYER_KEY as Hex;
if (!deployerKey) throw new Error("set DEPLOYER_KEY");
const profile = profileOf(cfg.profile);
const V = profile.rootCarrier === "frame" ? 1 : 0;
const art = (name: string) => JSON.parse(readFileSync(`packages/contracts/out/Adversaries.sol/${name}.json`, "utf8"));

const deployer = privateKeyToAccount(deployerKey);
async function deploy(name: string, args: unknown[] = []): Promise<Address> {
  const a = art(name);
  const data = encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args });
  const nonce = Number(await rpc(cfg.rpc, "eth_getTransactionCount", [deployer.address, "pending"]));
  const block = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
  const raw = await deployer.signTransaction({ chainId: cfg.chainId, nonce, to: null, data, gas: 3_000_000n, gasPrice: BigInt(block.baseFeePerGas) * 3n + 1_000_000_000n, type: "legacy" });
  return (await mined(cfg, await rpc<Hex>(cfg.rpc, "eth_sendRawTransaction", [raw]))).contractAddress;
}

const cases: { label: string; name: string; args: (pool: Address) => unknown[]; expectPaid: boolean | "either" }[] = [
  { label: "refuses after creating 4 storage slots", name: "StateBomb", args: () => [4n, false], expectPaid: false },
  { label: "refuses after creating 7 storage slots (most of the frame's state budget)", name: "StateBomb", args: () => [7n, false], expectPaid: false },
  { label: "tries to create 12 storage slots, more than the frame's state budget", name: "StateBomb", args: () => [12n, false], expectPaid: false },
  { label: "keeps 3 new storage slots and the payment", name: "StateBomb", args: () => [3n, true], expectPaid: true },
  { label: "refuses after creating 3 accounts", name: "AccountBomb", args: () => [3n, false], expectPaid: false },
  { label: "keeps 2 new accounts and the payment", name: "AccountBomb", args: () => [2n, true], expectPaid: true },
  { label: "burns all its gas", name: "Burner", args: () => [], expectPaid: false },
  { label: "returns 60 KB of data", name: "ReturnBomb", args: () => [], expectPaid: true },
  // Its claim() re-enters receive(), so it may run out of gas and be kept as a claim instead: either is correct.
  { label: "re-enters the pool", name: "Reenterer", args: (pool) => [pool], expectPaid: "either" },
  { label: "self-destructs", name: "Destroyer", args: () => [], expectPaid: true },
];

let failures = 0;
const results: Record<string, unknown>[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const claimable = async (a: Address) => BigInt(await rpc(cfg.rpc, "eth_call", [{ to: cfg.pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: "claimable", args: [a] }) }, "latest"]));

console.log(`\n== adversarial recipients on ${network} (${profile.id}): pool ${cfg.pool}\n`);
const key = await fundedKey(cfg, deployerKey, "adversarial", parseEther("2"));
const rl = await connect(cfg, key);
for (let i = 0; i < cases.length; i++) await mined(cfg, (await rl.deposit({ amount: parseEther("0.05") })).hash);
const amount = parseEther("0.02");

for (const c of cases) {
  const target = await deploy(c.name, c.args(cfg.pool));
  const note = (await rl.notes()).find((n) => !n.spent && n.value === parseEther("0.05")) as Note;
  const [claimBefore, balBefore] = [await claimable(target), await balanceOf(cfg, target)];
  let receipt: any;
  try {
    const h = await rl.withdraw({ to: target, amount, note });
    receipt = await h.wait();
  } catch (e: any) {
    check(`${c.label}: the withdrawal settles`, false, e.message.slice(0, 120));
    continue;
  }
  const sender = receipt.frameReceipts[V + 1];
  const spent = await rl.isSpent(note.nullifierHash);
  const change = (await rl.notes()).some((n) => !n.spent && n.value === note.value - amount);
  const claimed = (await claimable(target)) - claimBefore;
  const received = (await balanceOf(cfg, target)) - balBefore;
  const paidOrOwed = claimed > 0n || received > 0n || c.name === "Destroyer";
  const ok = receipt.status === "0x1" && sender.status === "0x1" && spent && change && paidOrOwed && (c.expectPaid === "either" || (c.expectPaid ? claimed === 0n : claimed > 0n));
  const detail = `SENDER ${Number(sender.gasUsed)} gas + ${Number(sender.stateGasUsed ?? 0)} state, ${claimed > 0n ? `kept as a claim of ${claimed}` : `paid ${received}`}`;
  check(`${c.label}: settles, note spent, change kept, payment ${c.expectPaid === "either" ? "made or kept" : c.expectPaid ? "made" : "kept as a claim"}`, ok, detail);
  results.push({ case: c.label, tx: receipt.transactionHash, senderExecution: Number(sender.gasUsed), senderState: Number(sender.stateGasUsed ?? 0), claimed: claimed.toString(), received: received.toString(), ok });
}

writeFileSync(`.relayless-adversarial-${network}.json`, JSON.stringify({ network, profile: profile.id, pool: cfg.pool, at: new Date().toISOString(), results }, null, 2));
console.log(`\n${cases.length - failures}/${cases.length} passed\n`);
await stopWorkers();
process.exit(failures ? 1 : 0);
