// The public-testnet run, after deploy: a deposit, a private withdrawal to a fresh address holding 0 ETH, a double
// spend refused before broadcast, concurrent withdrawals from the one pool sender, and a public exit. Records every
// transaction with its explorer link in .relayless-testnet-<network>.json and prints the README rows.
// usage: set -a; . ./.env.hegota-8141; set +a; tsx scripts/testnet-run.ts [network]   (default hegota-8141)
import { writeFileSync } from "node:fs";
import { formatEther, parseEther, type Hex } from "viem";
import { NotAdmittedError, profileOf, type Note } from "@relayless/sdk";
import { balanceOf, connect, loadConfig, mined, rpc, stopWorkers } from "./lib.js";

const network = process.argv[2] ?? "hegota-8141";
const cfg = loadConfig(network);
const key = process.env.DEPLOYER_KEY as Hex;
if (!key) throw new Error("set DEPLOYER_KEY (from .env.hegota-8141)");
const profile = profileOf(cfg.profile);
const V = profile.rootCarrier === "frame" ? 1 : 0;
const link = (hash: string) => (cfg.explorer ? `${cfg.explorer}/tx/${hash}` : hash);

const rows: { step: string; ok: boolean; txs: string[]; detail: string }[] = [];
const record = (step: string, ok: boolean, txs: string[], detail: string) => {
  rows.push({ step, ok, txs, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}  (${detail})${txs.map((t) => `\n      ${link(t)}`).join("")}`);
};

console.log(`\n== ${network} (${profile.id}): pool ${cfg.pool}\n`);
const rl = await connect(cfg, key);

// 1. Deposits: one for each step below, and one spare.
const deposits: string[] = [];
for (let i = 0; i < 5; i++) {
  const d = await rl.deposit({ amount: parseEther("0.02") });
  await mined(cfg, d.hash);
  deposits.push(d.hash);
}
record("Deposit", true, deposits.slice(0, 1), `5 deposits of 0.02 ETH, first shown`);

// 2. The headline: a private withdrawal to a fresh address holding 0 ETH.
// The first derived address that has never been used: no balance, no transactions. Later steps take the next ones.
let next = 0;
async function unused(): Promise<`0x${string}`> {
  for (;; next++) {
    const a = rl.freshAddress(next);
    if ((await balanceOf(cfg, a)) === 0n && Number(await rpc(cfg.rpc, "eth_getTransactionCount", [a, "latest"])) === 0) return rl.freshAddress(next++);
  }
}
const fresh = await unused();
const before = await balanceOf(cfg, fresh);
const h = await rl.withdraw({ to: fresh, amount: parseEther("0.015") });
const r = await h.wait();
const received = await balanceOf(cfg, fresh);
const frames = (r?.frameReceipts ?? []).map((f: any) => f.status);
record(
  "Private withdrawal to a fresh address holding 0 ETH",
  before === 0n && received > 0n && r?.status === "0x1" && frames.every((s: string) => s === "0x1"),
  [h.hash],
  `${fresh} went from ${formatEther(before)} to ${formatEther(received)} ETH; frames ${frames.join(" ")}; root frame ${Number(r.frameReceipts[0].gasUsed)} gas, pool VERIFY ${Number(r.frameReceipts[V].gasUsed)}`,
);

// 3. Double spend: the spent note, forced past the SDK's own check. Must be refused before anything is broadcast.
const spent = (await rl.notes()).find((n) => n.nullifierHash === h.nullifierHash) as Note;
let refusal = "";
try {
  await rl.withdraw({ to: await unused(), amount: parseEther("0.004"), note: { ...spent, spent: false } });
  refusal = "SENT: this is a failure";
} catch (e: any) {
  refusal = e instanceof NotAdmittedError ? e.message : `unexpected: ${e.message}`;
}
record("Double spend of the same note, refused before broadcast", /not broadcast/.test(refusal) && /nonce/i.test(refusal), [], refusal.slice(0, 160));

// 4. Concurrent withdrawals from the one pool sender, each on its own nullifier key.
const recipients = [await unused(), await unused(), await unused()];
const batch = await rl.payMany(recipients.map((to) => ({ to, amount: parseEther("0.01") })));
const pendingRightAfter = (await Promise.all(batch.map((b) => rpc(cfg.rpc, "eth_getTransactionByHash", [b.hash])))).filter((t: any) => t && t.blockNumber === null).length;
const landed = await Promise.all(batch.map((b) => b.wait()));
const blocks = landed.map((x: any) => (x ? Number(x.blockNumber) : -1));
const together = pendingRightAfter >= 2 || blocks.some((b, i) => b >= 0 && blocks.indexOf(b) !== i);
record(
  "Concurrent withdrawals from the one pool sender",
  together && landed.every((x: any) => x?.status === "0x1"),
  batch.map((b) => b.hash),
  `${pendingRightAfter} of 3 pending at once right after sending, mined in blocks ${blocks.join(", ")}. Chain 8141 relaxes one-pending-per-sender for disjoint nonce keys; it has no MATCHA width budget`,
);

// 5. Public exit to the depositor.
const exitNote = (await rl.notes()).find((n) => !n.spent) as Note;
const depositorBefore = await balanceOf(cfg, exitNote.depositor);
const exit = await rl.ragequit(exitNote);
const er = await exit.wait();
record("Public exit (ragequit) to the depositor", er?.status === "0x1" && (await balanceOf(cfg, exitNote.depositor)) > depositorBefore && (await rl.isSpent(exitNote.nullifierHash)), [exit.hash], `paid ${exitNote.depositor}`);

writeFileSync(`.relayless-testnet-${network}.json`, JSON.stringify({ network, profile: profile.id, pool: cfg.pool, validator: cfg.validator, at: new Date().toISOString(), rows }, null, 2));
console.log("\nREADME rows:\n");
for (const row of rows) console.log(`| ${row.step} | ${row.txs.length ? row.txs.map((t) => `[\`${t.slice(0, 10)}…\`](${link(t)})`).join(", ") : row.detail} |`);
const failed = rows.filter((x) => !x.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed\n`);
await stopWorkers();
process.exit(failed ? 1 : 0);
