// Private receive names end to end: name on Sepolia, money on the local chain.
// usage: set -a; . ./.env; set +a; npx tsx scripts/e2e-ens.ts [--local-only]
//
// --local-only skips Sepolia and hands the meta-address straight to the payer, to test the payment path by itself.
// A pass in that mode says nothing about ENS.
import { readFileSync } from "node:fs";
import { getAddress, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { metaAddressOf, scanAnnouncements, stealthAccount, stealthKeysFromSignature, stealthPrivateKey, stealthTypedData } from "@relayless/sdk";
import { balanceOf, connect, fundedKey, loadConfig, localSigner, mined, rpc, stopWorkers } from "./lib.js";

const localOnly = process.argv.includes("--local-only");
const cfg = loadConfig("local");
const deployerKey = process.env.DEPLOYER_KEY as Hex;
const { announcer, deployBlock } = JSON.parse(readFileSync("config/local.announcer.deployed.json", "utf8")) as { announcer: Address; deployBlock: number };
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const alice = privateKeyToAccount(process.env.E2E_ALICE_KEY as Hex);
const aliceKeys = stealthKeysFromSignature(await alice.signTypedData(stealthTypedData()));
const stranger = stealthKeysFromSignature(await privateKeyToAccount(deployerKey).signTypedData(stealthTypedData()));
const metaAddress = metaAddressOf(aliceKeys);

// ---- Paying ----
const payerKey = await fundedKey(cfg, deployerKey, "ens-payer", parseEther("1"));
const payerAddress = privateKeyToAccount(payerKey).address;
const payer = await connect(cfg, payerKey);
await mined(cfg, (await payer.deposit({ amount: parseEther("0.4") })).hash);

const amount = parseEther("0.03");
const first = await payer.payStealth({ metaAddress, amount, announcer });
for (const h of first.handles) await h.wait();
const second = await payer.payStealth({ metaAddress, amount, announcer });
for (const h of second.handles) await h.wait();
const a = first.payment.stealthAddress;
const b = second.payment.stealthAddress;

check("two payments to one name went to two different addresses", getAddress(a) !== getAddress(b), `${a}, ${b}`);
for (const [label, addr] of [["first", a], ["second", b]] as const) {
  const bal = await balanceOf(cfg, addr);
  check(`${label} address received the money`, bal > 0n && bal <= amount, `${bal} wei`);
}

// ---- Who's visible on-chain ----
const receiptOf = (hash: Hex) => rpc<any>(cfg.rpc, "eth_getTransactionReceipt", [hash]);
const [ann1, ann2, pay1, pay2] = await Promise.all([receiptOf(first.announceHash), receiptOf(second.announceHash), receiptOf(first.handles[0].hash), receiptOf(second.handles[0].hash)]);
check("each announcement came from its own wallet", ann1.from.toLowerCase() !== ann2.from.toLowerCase());
check("the payer's wallet sent neither announcement", ![ann1.from, ann2.from].some((f) => f.toLowerCase() === payerAddress.toLowerCase()));
check("each payment was sent by the pool, not the payer", [pay1, pay2].every((r) => r.from.toLowerCase() === cfg.pool.toLowerCase()), pay1.from);
const mentions = (r: any, addr: Address) => JSON.stringify(r).toLowerCase().includes(addr.slice(2).toLowerCase());
check("the payer's address appears in no payment or announcement receipt", ![ann1, ann2, pay1, pay2].some((r) => mentions(r, payerAddress)));
check("neither payment's receipt mentions the other address", !mentions(pay1, b) && !mentions(pay2, a));
check("neither address has any history of its own", Number(await rpc(cfg.rpc, "eth_getTransactionCount", [a, "latest"])) === 0 && Number(await rpc(cfg.rpc, "eth_getTransactionCount", [b, "latest"])) === 0);

// ---- Receiving ----
const scan = await scanAnnouncements(cfg.rpc, announcer, aliceKeys, deployBlock);
const found = scan.received.map((r) => getAddress(r.stealthAddress));
check("the recipient finds both payments by scanning", found.includes(getAddress(a)) && found.includes(getAddress(b)), `${scan.received.length} of ${scan.scanned} announcements`);
check("the scan read every block", scan.unreadableBlocks.length === 0, scan.unreadableBlocks.join(","));
const viewOnly = await scanAnnouncements(cfg.rpc, announcer, { viewingPrivateKey: aliceKeys.viewingPrivateKey, spendingPublicKey: aliceKeys.spendingPublicKey }, deployBlock);
check("the viewing key alone finds them", viewOnly.received.length === scan.received.length);
const strangers = await scanAnnouncements(cfg.rpc, announcer, stranger, deployBlock);
check("someone else's keys find neither", !strangers.received.some((r) => [getAddress(a), getAddress(b)].includes(getAddress(r.stealthAddress))));

const account = stealthAccount(first.payment.ephemeralPublicKey, aliceKeys);
check("the recipient's derived key controls the address", account.address === getAddress(a));
const spendKey = stealthPrivateKey(first.payment.ephemeralPublicKey, aliceKeys);
const before = await balanceOf(cfg, a);
const signer = localSigner(cfg, spendKey);
const sink: Address = "0x000000000000000000000000000000000000dEaD";
await mined(cfg, await signer.sendTransaction({ to: sink, value: before / 2n, data: "0x" }));
check("the recipient can spend from it, paying gas with the money received", (await balanceOf(cfg, a)) < before / 2n + 1n);

console.log(failures ? `\n${failures} FAILED` : `\nall passed${localOnly ? " (local path only: ENS not tested)" : ""}`);
stopWorkers();
process.exit(failures ? 1 : 0);
