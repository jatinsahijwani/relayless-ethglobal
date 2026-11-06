// DEMO DATA. Makes SEED_COUNT deposits into the demo pool from throwaway keys, with varied amounts and spacing, so the
// meter and dot chart have a realistic crowd. Safe to rerun: a key that has already deposited is skipped.
// usage: pnpm demo:seed
import { parseEther, type Hex } from "viem";
import { connect, localSigner, mined, stopWorkers } from "./lib.js";
import { SEED_COUNT, allow, aspSet, cfg, DEMO_NETWORK, seedAddress, seedKey } from "./demo-lib.js";
import { fetchPoolState } from "../packages/sdk/src/chain.js";

const deployerKey = process.env.DEPLOYER_KEY as Hex;
if (!deployerKey) throw new Error("set DEPLOYER_KEY");

// Fixed, not random, so a rerun means the same thing. Mostly common amounts, with some that stand out, as a real pool has.
const AMOUNTS = ["0.1", "0.05", "0.25", "0.5", "0.1", "1", "0.02", "0.1", "0.05", "0.33", "0.2", "0.1", "0.75", "0.05", "0.5", "0.15", "0.1", "0.04", "0.25", "0.08"];
const GAPS_IN_SLOTS = [0, 1, 0, 2, 0, 0, 3, 1, 0, 1, 4, 0, 2];
const amountOf = (i: number) => parseEther(AMOUNTS[i % AMOUNTS.length]);
const SLOT_MS = 6000;

const state = await fetchPoolState(cfg.rpc, cfg.pool);
const already = new Set(state.deposits.map((d) => d.depositor.toLowerCase()));
const todo = [...Array(SEED_COUNT).keys()].filter((i) => !already.has(seedAddress(i).toLowerCase()));
console.log(`${DEMO_NETWORK} pool ${cfg.pool}: ${SEED_COUNT - todo.length} of ${SEED_COUNT} seed deposits already made`);

const funder = localSigner(cfg, deployerKey);
for (const [n, i] of todo.entries()) {
  // Gas on this devnet is tiny, and what's left over stays with the throwaway key.
  await mined(cfg, await funder.sendTransaction({ to: seedAddress(i), value: amountOf(i) + parseEther("0.02"), data: "0x" }));
  const rl = await connect(cfg, seedKey(i));
  await mined(cfg, (await rl.deposit({ amount: amountOf(i) })).hash);
  console.log(`  ${n + 1}/${todo.length}: seed #${i} deposited ${AMOUNTS[i % AMOUNTS.length]} ETH`);
  await new Promise((r) => setTimeout(r, GAPS_IN_SLOTS[i % GAPS_IN_SLOTS.length] * SLOT_MS));
}

// On an association-set pool, an unapproved deposit isn't really part of the crowd, so the seeds are approved too.
const set = await aspSet();
const after = await fetchPoolState(cfg.rpc, cfg.pool);
const seeds = new Set([...Array(SEED_COUNT).keys()].map((i) => seedAddress(i).toLowerCase()));
const seedLabels = after.deposits.filter((d) => seeds.has(d.depositor.toLowerCase())).map((d) => d.label.toString());
if (!seedLabels.every((l) => set.labels.includes(l))) {
  await allow([...Array(SEED_COUNT).keys()].map(seedAddress));
  console.log("seed depositors added to the allowlist");
}
console.log(`done: ${after.deposits.length} deposits in the pool, ${seedLabels.length} of them seed data`);
await stopWorkers();
process.exit(0);
