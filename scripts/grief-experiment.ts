// Measures how far a note owner can push the pool's reputation, on a fresh pool, with the SDK's safeguards bypassed.
// Private local stack only. Needs a second sidecar at http://127.0.0.1:14338/rpc/ in manual mode.
import { writeFileSync } from "node:fs";
import { keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { connect, fundedKey, loadConfig, mined, rpc, stopWorkers } from "./lib.js";
import { toWire } from "../packages/sdk/src/frame.js";

const cfg = loadConfig("local");
if (!/127\.0\.0\.1|localhost/.test(cfg.mempool)) throw new Error("this experiment only runs against a private local stack");
const deployerKey = process.env.DEPLOYER_KEY as Hex;
const A = cfg.mempool;
const B = "http://127.0.0.1:14338/rpc/";
const fresh = (): Address => privateKeyToAccount(keccak256(toHex(`g:${Math.random()}`))).address;
const rep = async (node: string) => {
  const r = await rpc(node, "skandha_explorer_listReputation", [{ limit: 200 }]);
  const e = r.items.find((x: any) => x.address.toLowerCase() === cfg.pool.toLowerCase());
  return e ? { seen: e.opsSeen, included: e.opsIncluded, status: e.status } : { seen: 0, included: 0, status: "ok" };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = await fundedKey(cfg, deployerKey, "griefer", parseEther("3"));
const rl = await connect(cfg, key);
for (const amount of [parseEther("0.5"), parseEther("0.5"), parseEther("0.5")]) await mined(cfg, (await rl.deposit({ amount })).hash);
const out: any = { start: { A: await rep(A), B: await rep(B) } };

// 1. Replacement spray on one node: one note, many fee bumps, prepared in advance and sent in a burst.
const [n1, n2, n3] = (await rl.notes()).filter((n) => !n.spent);
const state = await rl.sync();
const BUMPS = 8;
const prepared = [];
let maxFee = 1_000_000_000n;
for (let i = 0; i < BUMPS; i++) {
  prepared.push((await rl.prepare(n1, { to: fresh(), amount: parseEther("0.1") }, 0n, state, { maxFeePerGas: maxFee, maxPriorityFeePerGas: maxFee / 100n })).tx);
  maxFee = (maxFee * 115n) / 100n;
}
const beforeSpray = await rep(A);
const t0 = Date.now();
const accepted: string[] = [];
const refused: string[] = [];
for (const tx of prepared) {
  await rpc(A, "eth_sendFrameTransaction", [toWire(tx)]).then((h) => accepted.push(h), (e) => refused.push(e.message.slice(0, 100)));
}
const burstMs = Date.now() - t0;
const afterSpray = await rep(A);
out.replacementSpray = { bumps: BUMPS, burstMs, accepted: accepted.length, refused, seenBefore: beforeSpray.seen, seenAfter: afterSpray.seen };
for (let i = 0; i < 40 && !(await rl.isSpent(n1.nullifierHash)); i++) await sleep(1000);
await sleep(12000);
out.replacementSprayLanded = { spent: await rl.isSpent(n1.nullifierHash), rep: await rep(A) };

// 2. Conflict across nodes: same nullifier, different recipients, one to each node. Node B never mines (manual mode).
const refresh = await rl.sync();
const conflicts = [];
for (const n of [n2, n3]) {
  const caps = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n };
  const a = (await rl.prepare(n, { to: fresh(), amount: parseEther("0.1") }, 0n, refresh, caps)).tx;
  const b = (await rl.prepare(n, { to: fresh(), amount: parseEther("0.1") }, 0n, refresh, caps)).tx;
  const onB = await rpc(B, "eth_sendFrameTransaction", [toWire(b)]).then(() => "admitted", (e) => `refused: ${e.message.slice(0, 80)}`);
  const onA = await rpc(A, "eth_sendFrameTransaction", [toWire(a)]).then(() => "admitted", (e) => `refused: ${e.message.slice(0, 80)}`);
  conflicts.push({ onA, onB });
}
for (let i = 0; i < 40 && !(await rl.isSpent(n3.nullifierHash)); i++) await sleep(1000);
await sleep(15000);
out.conflictAcrossNodes = { conflicts, A: await rep(A), B: await rep(B) };
writeFileSync(".relayless-e2e-grief.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await stopWorkers();
process.exit(0);
