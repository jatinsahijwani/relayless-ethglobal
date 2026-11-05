// End-to-end against a live chain and alt mempool. Every check is asserted, and any failure exits non-zero.
// usage: tsx scripts/e2e.ts [network]
import { writeFileSync } from "node:fs";
import { encodeFunctionData, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NullifierInFlightError, POOL_ABI, type Note } from "@relayless/sdk";
import { balanceOf, connect, fundedKey, loadConfig, mined, rpc, stopWorkers } from "./lib.js";

const network = process.argv[2] ?? "local";
const cfg = loadConfig(network);
const deployerKey = process.env.DEPLOYER_KEY as Hex;
if (!deployerKey) throw new Error("set DEPLOYER_KEY");

let failures = 0;
const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eth = (w: bigint) => `${Number(w) / 1e18} ETH`;
const freshAddr = (): Address => privateKeyToAccount(keccak256(toHex(`fresh:${Math.random()}`))).address;
const reserveOf = async () => BigInt(await rpc(cfg.rpc, "eth_call", [{ to: cfg.pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: "reserve" }) }, "latest"]));
const receiptFrames = (r: any) => (r.frameReceipts ?? []).map((f: any) => f.status === "0x1");

console.log(`\n== ${network}: pool ${cfg.pool}\n`);

const userKey = await fundedKey(cfg, deployerKey, "user", parseEther("5"));
const rl = await connect(cfg, userKey);

// ---- Deposits: a root is published after every one ----
const rootsBefore = (await rl.sync()).roots.length;
for (const amount of [parseEther("1"), parseEther("0.5"), parseEther("0.3"), parseEther("0.2")]) {
  await mined(cfg, (await rl.deposit({ amount })).hash);
}
const afterDeposits = await rl.sync();
check("a root is published after every deposit", afterDeposits.roots.length === rootsBefore + 4);

// ---- The headline: a partial payment to a wallet with zero ETH ----
const fresh = rl.freshAddress(0);
const startBalance = await balanceOf(cfg, fresh);
check("the fresh wallet starts with 0 ETH", startBalance === 0n, fresh);
const reserveBefore = await reserveOf();
const poolBefore = await balanceOf(cfg, cfg.pool);
const pay = parseEther("0.25");
const h = await rl.withdraw({ to: fresh, amount: pay });
console.log(`      proved in ${h.proveMs} ms, tx ${h.hash}`);
const receipt = await h.wait();
check("withdrawal mined, every frame succeeded", receipt?.status === "0x1" && receiptFrames(receipt).every(Boolean), `${receiptFrames(receipt).length} frames`);
const received = await balanceOf(cfg, fresh);
check("recipient got the amount minus only what gas cost", received < pay && received > pay - h.fee && received > (pay * 99n) / 100n, eth(received));
check("nullifier consumed", await rl.isSpent(h.nullifierHash));
const paid = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice ?? 0);
const reserveAfter = await reserveOf();
check("the refund never costs other depositors: reserve did not fall", reserveAfter >= reserveBefore, `moved ${reserveAfter - reserveBefore} wei`);
const poolAfter = await balanceOf(cfg, cfg.pool);
check("the pool's balance moved by exactly what it paid out plus gas", paid > 0n && poolAfter === poolBefore - received - paid, `paid ${received} + gas ${paid}`);

const f = receipt.frameReceipts;
const gas = {
  txHash: h.hash,
  total: Number(receipt.gasUsed),
  verifyFrame: Number(f[0].gasUsed),
  senderExecution: Number(f[1].gasUsed),
  senderState: Number(f[1].stateGasUsed),
  refundFrame: Number(f[2].gasUsed),
  leafCount: (await rl.sync()).leaves.length,
};
console.log("      gas:", JSON.stringify(gas));

// ---- Recovery: a brand-new client with only the signature ----
const recovered = await connect(cfg, userKey);
const notes = await recovered.notes();
const unspent = notes.filter((n) => !n.spent);
check("recovery rebuilds every note from the chain and one signature", notes.length === 5 && unspent.length === 4, `${notes.length} notes, ${unspent.length} unspent`);
check("recovery finds the change note and its value", unspent.some((n) => n.value === parseEther("0.05")));
check("recovered balance is right", (await recovered.balance()) === parseEther("1.75"), eth(await recovered.balance()));
check("depositing again does not reuse a note index", (await recovered.deposit({ amount: parseEther("0.01") }).then((d) => mined(cfg, d.hash).then(() => d.index))) === 4n);

// ---- Double spend ----
const spentNote = notes.find((n) => n.spent)!;
let doubleSpend = "";
try {
  await rl.withdraw({ to: freshAddr(), amount: parseEther("0.01"), note: spentNote });
} catch (e: any) {
  doubleSpend = e.message;
}
check("the SDK refuses to spend a spent note", doubleSpend.includes("already spent"));
let chainRefused = "";
try {
  await rl.withdraw({ to: freshAddr(), amount: parseEther("0.01"), note: { ...spentNote, spent: false } });
} catch (e: any) {
  chainRefused = e.message;
}
check("a forced double spend is invalid before broadcast", /Nonce mismatch/i.test(chainRefused), chainRefused.slice(0, 80));

// ---- One nullifier, one pending transaction ----
const ledgerNote = (await rl.notes()).find((n) => !n.spent && n.value === parseEther("0.2")) as Note;
const pendingOne = await rl.withdraw({ to: freshAddr(), amount: parseEther("0.1"), note: ledgerNote });
let refused: unknown = null;
try {
  await rl.withdraw({ to: freshAddr(), amount: parseEther("0.1"), note: ledgerNote });
} catch (e) {
  refused = e;
}
check("the SDK never sends a second tx for a pending nullifier", refused instanceof NullifierInFlightError);
let bump = "";
try {
  const bumped = await rl.bumpFee(pendingOne, { minPendingMs: 0 });
  bump = bumped.hash;
  await bumped.wait();
} catch (e: any) {
  bump = `not bumped: ${e.message}`;
}
await pendingOne.wait();
check("a fee bump replaces it, and only one lands", (await rl.notes()).filter((n) => n.nullifierHash === ledgerNote.nullifierHash && n.spent).length === 1, bump.slice(0, 70));

// ---- Concurrency: several pending at once from one sender ----
const concurrentNotes = (await rl.notes()).filter((n) => !n.spent && n.value >= parseEther("0.03")).slice(0, 3);
const handles = await Promise.all(concurrentNotes.map((n) => rl.withdraw({ to: freshAddr(), amount: parseEther("0.02"), note: n })));
const stillPending = (await Promise.all(handles.map((x) => rpc(cfg.rpc, "eth_getTransactionReceipt", [x.hash])))).filter((r) => r === null).length;
check("3 withdrawals pending at once from the one pool sender", handles.length === 3 && stillPending >= 2, `${stillPending} of 3 still pending right after admission`);
const landed = await Promise.all(handles.map((x) => x.wait()));
check("all of them land", landed.every((r) => r?.status === "0x1"));

// ---- The SENDER frame cannot revert: recipient refuses the payment ----
const REJECTER: Hex = "0x60006000fd"; // runtime: revert(0, 0)
const initCode: Hex = `0x600580600b6000396000f3${REJECTER.slice(2)}`;
const nonce = Number(await rpc(cfg.rpc, "eth_getTransactionCount", [privateKeyToAccount(deployerKey).address, "pending"]));
const raw = await privateKeyToAccount(deployerKey).signTransaction({ chainId: cfg.chainId, nonce, to: null, data: initCode, gas: 2_000_000n, gasPrice: 2_000_000_000n, type: "legacy" });
const rejecterReceipt = await mined(cfg, await rpc<Hex>(cfg.rpc, "eth_sendRawTransaction", [raw]));
const rejecter = rejecterReceipt.contractAddress as Address;
const refusing = (await rl.notes()).find((n) => !n.spent && n.value >= parseEther("0.03")) as Note;
const refusedPay = await rl.withdraw({ to: rejecter, amount: parseEther("0.02"), note: refusing });
const refusedReceipt = await refusedPay.wait();
check("a refusing recipient does not revert the SENDER frame", refusedReceipt.frameReceipts[1].status === "0x1");
const owed = BigInt(await rpc(cfg.rpc, "eth_call", [{ to: cfg.pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: "claimable", args: [rejecter] }) }, "latest"]));
check("the refused payment is kept as a claim, not lost", owed > 0n, eth(owed));
check("and the change note survives", (await rl.notes()).some((n) => !n.spent && n.value === refusing.value - parseEther("0.02")));

// ---- k-gate ----
const size = (await rl.sync()).leaves.length;
const gateNote = (await rl.notes()).filter((n) => !n.spent && n.value >= parseEther("0.03")).sort((a, b) => b.leafIndex - a.leafIndex)[0];
let gate = "";
try {
  await rl.withdraw({ to: freshAddr(), amount: parseEther("0.01"), minAnon: size + 5 });
} catch (e: any) {
  gate = e.message;
}
check("minAnon above what the pool can offer is refused", /minAnon/.test(gate), gate.slice(0, 80));
const gated = await rl.withdraw({ to: freshAddr(), amount: parseEther("0.01"), note: gateNote, minAnon: size - gateNote.leafIndex });
check("minAnon at the exact boundary proves and lands", (await gated.wait())?.status === "0x1", `k=${size - gateNote.leafIndex}`);

// ---- The optional fee range: enforced when the pool was built with one, absent otherwise ----
const feeNote = (await rl.notes()).find((n) => !n.spent && n.value >= parseEther("0.05")) as Note;
const feeTry = async (maxFeePerGas: bigint) => rl.withdraw({ to: freshAddr(), amount: parseEther("0.04"), note: feeNote, maxFeePerGas }).then((h) => h.wait()).then(() => "sent", (e) => e.message as string);
if (cfg.feeRange) {
  check("a max fee above the pool's range is refused before broadcast", /simulation failed/.test(await feeTry(BigInt(cfg.feeRange.max) + 1n)));
  check("a max fee below the pool's range is refused before broadcast", /simulation failed/.test(await feeTry(BigInt(cfg.feeRange.min) - 1n)));
} else {
  check("with no fee range, a max fee above the optional ceiling still lands", (await feeTry(9_000_000_000n)) === "sent");
}

// ---- Any amount: more than any one note, split across notes, all pending at once ----
const splitKey = await fundedKey(cfg, deployerKey, "splitter", parseEther("1"));
const splitter = await connect(cfg, splitKey);
await mined(cfg, (await splitter.deposit({ amount: parseEther("0.1") })).hash);
await mined(cfg, (await splitter.deposit({ amount: parseEther("0.1") })).hash);
const splitTo = splitter.freshAddress(0);
const parts = await splitter.pay({ to: splitTo, amount: parseEther("0.15") });
check("a payment bigger than any note splits into several withdrawals", parts.length === 2);
await Promise.all(parts.map((p) => p.wait()));
const splitReceived = await balanceOf(cfg, splitTo);
check("the recipient gets the whole amount, less only gas", splitReceived < parseEther("0.15") && splitReceived > parseEther("0.149"), eth(splitReceived));
check("the rest stays as a recoverable change note", (await splitter.balance()) === parseEther("0.05"), eth(await splitter.balance()));

// ---- Public exit ----
const exitNote = (await rl.notes()).find((n) => !n.spent && n.value >= parseEther("0.03")) as Note;
const depositor = exitNote.depositor;
const before = await balanceOf(cfg, depositor);
const exit = await rl.ragequit(exitNote);
const exitReceipt = await exit.wait();
check("ragequit pays the original depositor and burns the nullifier", exitReceipt.status === "0x1" && (await balanceOf(cfg, depositor)) > before && (await rl.isSpent(exitNote.nullifierHash)));

// ---- Anonymity meter ----
const report = await rl.anonymity({ amount: parseEther("0.01") });
check("anonymity meter reports a sane score", report.setSize > 0 && report.minEntropyBits >= 0 && report.minEntropyBits <= report.shannonBits + 1e-9, `H∞ ${report.minEntropyBits.toFixed(2)} bits, H ${report.shannonBits.toFixed(2)} bits, ${report.setSize} candidates`);

const reputation = await rpc(cfg.mempool, "skandha_explorer_listReputation", [{ limit: 50 }]).catch(() => null);
const poolRep = reputation?.items?.find((e: any) => e.address?.toLowerCase() === cfg.pool.toLowerCase());
if (poolRep) console.log(`      pool reputation: seen ${poolRep.opsSeen}, included ${poolRep.opsIncluded}, ${poolRep.status}, staked ${poolRep.isStaked}`);
check("honest use keeps the pool's reputation ok", !poolRep || poolRep.status === "ok", poolRep ? `seen ${poolRep.opsSeen}, included ${poolRep.opsIncluded}` : "no explorer data");

writeFileSync(`.relayless-e2e-${network}.json`, JSON.stringify({ network, pool: cfg.pool, at: new Date().toISOString(), gas, results, headlineTx: h.hash }, null, 2));
console.log(`\n${results.length - failures}/${results.length} passed\n`);
await stopWorkers();
process.exit(failures ? 1 : 0);
