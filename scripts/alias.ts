// Aliased statement values must be refused. With the withdrawal statement compressed (eprint 2025/1500), the verifier
// sees only [beta, gamma, alpha], never the values. A value plus r gives a new alpha for the same field element, so a
// prover can make a proof for it that verifies. Only the validator's own range checks stop it, and this script shows
// both halves on a real chain: for each value a sender chooses, the aliased proof verifies off-chain against the pool's
// verifying key, and the node's simulation still refuses the transaction. Nothing is broadcast.
// usage: tsx scripts/alias.ts [network]   (local, local-hegota)
import { readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, parseEther, type Address, type Hex } from "viem";
// @ts-ignore: no types for snarkjs outside the SDK
import * as snarkjsModule from "snarkjs";
const snarkjs: any = snarkjsModule;
import { POOL_ABI, R, Relayless, alphaOfWords, encodeWithdrawProof, fileProver, profileOf, rawOf, sigHashOf, type Note } from "@relayless/sdk";
import { CIRCUITS, feeRangeOf, fundedKey, loadConfig, localSigner, mined, rpc, stopWorkers } from "./lib.js";

if (!process.env.DEPLOYER_KEY) throw new Error("set DEPLOYER_KEY (the chain's funded key)");

const network = process.argv[2] ?? "local";
const cfg = loadConfig(network);
const profile = profileOf(cfg.profile);
const V = profile.rootCarrier === "frame" ? 1 : 0;
const S = V + 1;
const vk = JSON.parse(readFileSync(`${CIRCUITS}/withdraw.vk.json`, "utf8"));

// The SDK's own prover, wrapped so the script can see the honest witness and re-prove a variant of it.
const files = fileProver(CIRCUITS);
let lastInput: Record<string, any> = {};
const prover = { prove: (c: "withdraw" | "ragequit", input: Record<string, unknown>) => ((lastInput = input), files.prove(c, input)) };
const rl = await Relayless.connect({ rpc: cfg.rpc, mempool: cfg.mempool, profile: cfg.profile, pool: cfg.pool as Address, signer: localSigner(cfg, await fundedKey(cfg, process.env.DEPLOYER_KEY as Hex, "alias", parseEther("0.2"))), prover, chainId: cfg.chainId, feeRange: feeRangeOf(cfg) });

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const simulate = (tx: any) => rpc<any>(cfg.rpc, "ethrex_simulateFrameTransaction", profile.simulateParams(rawOf(profile, tx)));
// The SDK's own preflight rule. On a public-mempool profile, `valid` is the node's admission verdict. On devnet-8421 the
// canonical rules refuse every withdrawal on MAX_VERIFY_GAS, so there it is: no execution error, and every frame up to
// and including SENDER succeeded.
function verdict(sim: any): { admitted: boolean; why: string } {
  if (sim.executionError) return { admitted: false, why: String(sim.executionError) };
  if (profile.submit === "public-mempool" && sim.valid !== true) return { admitted: false, why: String(sim.violation ?? "not valid") };
  const failed = (sim.frames ?? []).slice(0, S + 1).findIndex((f: any) => !f.succeeded);
  if (!sim.frames?.length) return { admitted: false, why: "no frames in the simulation" };
  return failed >= 0 ? { admitted: false, why: `frame ${failed} failed` } : { admitted: true, why: "" };
}

console.log(`\n== aliased statement values, ${network} (${profile.id}): pool ${cfg.pool}\n`);
const d = await rl.deposit({ amount: parseEther("0.05") });
await mined(cfg, d.hash);
const note = (await rl.notes()).find((n) => !n.spent && n.value === parseEther("0.05")) as Note;
const state = await rl.sync();
const head = await rpc<any>(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
const caps = { maxFeePerGas: BigInt(head.baseFeePerGas) * 10n + 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n };
const to = rl.freshAddress(7_000 + Math.floor(Math.random() * 1_000));
const { tx: honest } = await rl.prepare(note, { to, amount: parseEther("0.02") }, 0n, state, caps);
const honestInput = { ...lastInput };

const control = verdict(await simulate(honest));
check("control: the honest withdrawal is admitted", control.admitted, control.why);

// The SENDER frame's withdraw(recipient, amount, fee, change, nullifierHash, k), re-encoded with one value aliased.
const [recipient, amount, change, nh, k] = [to, BigInt(honestInput.withdrawnValue), BigInt(honestInput.changeCommitment), BigInt(honestInput.nullifierHash), BigInt(honestInput.k)];
const honestFee = BigInt(`0x${honest.frames[S].data.slice(2 + 8 + 64 * 2, 2 + 8 + 64 * 3)}`);
const cases: { name: string; amount?: bigint; change?: bigint; nh?: bigint; k?: bigint }[] = [
  { name: "amount + r", amount: amount + R },
  { name: "change commitment + r", change: change + R },
  { name: "k + r", k: k + R },
  { name: "nullifier hash + r (a fresh nonce key for the same note)", nh: nh + R },
];

for (const c of cases) {
  const a = c.amount ?? amount, ch = c.change ?? change, n = c.nh ?? nh, kk = c.k ?? k;
  const tx = structuredClone(honest);
  tx.frames[S].data = encodeFunctionData({ abi: POOL_ABI, functionName: "withdraw", args: [recipient, a, honestFee, ch, n, kk] });
  tx.nonceKeys = [n];
  const sigHash = BigInt(sigHashOf(profile, tx)) % R;
  // The words the validator would hash: the aliased value as the transaction carries it. The circuit sees it mod r.
  const words = [BigInt(honestInput.rootCommit), n, ch, a, sigHash, kk, BigInt(honestInput.aspRoot)];
  const input = { ...honestInput, sigHash: sigHash.toString(), alpha: alphaOfWords(words).toString() };
  const { proof, publicSignals } = await files.prove("withdraw", input);
  const verifies = await snarkjs.groth16.verify(vk, publicSignals, proof);
  tx.signatures[0].signature = encodeWithdrawProof(proof, BigInt(publicSignals[0])) as Hex;
  const v = verdict(await simulate(tx));
  check(`${c.name}: the aliased proof verifies off-chain, and the node refuses the transaction`, verifies === true && !v.admitted, `proof verifies: ${verifies}; node: ${v.admitted ? "admitted" : `refused, ${v.why.slice(0, 80)}`}`);
}
check("nothing was broadcast or spent", !(await rl.isSpent(note.nullifierHash)));

writeFileSync(`.relayless-alias-${network}.json`, JSON.stringify({ network, profile: profile.id, pool: cfg.pool, at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed\n`);
await stopWorkers();
process.exit(failed ? 1 : 0);
