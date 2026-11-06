// Prepares one take: a new demo wallet with 4 approved notes and a fresh recipient holding 0 ETH. Run it between takes.
// The wallet's key goes in a git-ignored file that only the local dev server serves. It's never printed.
// usage: pnpm demo:reset
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { balanceOf, connect, mined, rpc, stopWorkers } from "./lib.js";
import { DEMO_NETWORK, DEMO_WALLET, allow, aspSet, cfg } from "./demo-lib.js";

// One note for the headline payment, and enough for "Pay 3 people at once" after it.
const NOTES = ["0.3", "0.1", "0.1", "0.1"];

const key = generatePrivateKey();
const address = privateKeyToAccount(key).address;
console.log(`${DEMO_NETWORK}: preparing a new demo wallet`);
// The sidecar's faucet gives 1 ETH. Using it rather than the deployer means this can't race another script's nonce.
await rpc(cfg.mempool, "skandha_explorer_faucet", [address]);
for (let i = 0; (await balanceOf(cfg, address)) === 0n; i++) {
  if (i === 60) throw new Error("the faucet didn't pay out in 60 s");
  await new Promise((r) => setTimeout(r, 1000));
}
const rl = await connect(cfg, key);
for (const amount of NOTES) {
  await mined(cfg, (await rl.deposit({ amount: parseEther(amount) })).hash);
  console.log(`  deposited ${amount} ETH`);
}
await allow([address]);
const notes = await rl.notes();
const set = await aspSet();
const approved = notes.filter((n) => set.labels.includes(n.label.toString())).length;
if (approved !== NOTES.length) throw new Error(`only ${approved} of ${NOTES.length} notes are in the approved set`);
const recipient = rl.freshAddress(0);
if ((await balanceOf(cfg, recipient)) !== 0n) throw new Error("the fresh recipient isn't empty");
writeFileSync(DEMO_WALLET, JSON.stringify({ id: randomUUID(), key }), { mode: 0o600 });
console.log(`ready: ${NOTES.length} approved notes, fresh recipient holds 0 ETH`);
console.log("open http://127.0.0.1:5199/?demo=1 and click Use the demo wallet");
await stopWorkers();
process.exit(0);
