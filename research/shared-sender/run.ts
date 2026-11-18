// Shared-sender attacks against a mempool, with Relayless as the shared sender: every withdrawal is the pool's own
// frame transaction, on its own EIP-8250 nonce key. Records what each target admits, refuses, counts and charges.
// usage: tsx research/shared-sender/run.ts <target>   (see targets.ts; the run-*.sh wrappers start what each needs)
// Local chains only. Never point this at a public network.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { profileOf, rawOf, txHashOf, type FrameTx, type Note } from "@relayless/sdk";
import { toWire } from "../../packages/sdk/src/frame.js";
import { connect, fundedKey, loadConfig, mined, rpc, stopWorkers } from "../../scripts/lib.js";
import { TARGETS, type Node } from "./targets.js";

const target = TARGETS[process.argv[2] ?? ""];
if (!target) throw new Error(`usage: run.ts <target>, one of ${Object.keys(TARGETS).join(", ")}`);
const cfg = loadConfig(target.network);
for (const u of [cfg.rpc, ...target.nodes.map((n) => n.url)]) if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) throw new Error(`refusing to run against ${u}: local chains only`);
if (target.kind === "sidecar") cfg.mempool = target.nodes[0].url;
const profile = profileOf(cfg.profile);
const S = profile.rootCarrier === "frame" ? 2 : 1;
const deployerKey = process.env.DEPLOYER_KEY as Hex;
if (!deployerKey) throw new Error("set DEPLOYER_KEY for the target's chain");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fresh = (): Address => privateKeyToAccount(keccak256(toHex(`ss:${Math.random()}`))).address;
const now = () => Date.now();
const out: any = { target: target.id, describe: target.describe, network: target.network, pool: cfg.pool, startedAt: new Date().toISOString(), attacks: {}, widthTimeline: [] };
const log = (...a: unknown[]) => console.log(...a);

// ---------- observation ----------
async function head() {
  const b = await rpc<any>(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
  return { number: Number(b.number), baseFee: BigInt(b.baseFeePerGas ?? 0) };
}
async function clientVersion(url: string) {
  return rpc<string>(url, "web3_clientVersion", []).catch(() => "unknown");
}
const normalCaps = async () => {
  const h = await head();
  return { maxFeePerGas: h.baseFee * 10n + 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n };
};
/** Below the current base fee: valid, but not includable until the base fee falls under it. */
const lowCaps = async () => {
  const h = await head();
  const fee = h.baseFee > 1n ? h.baseFee - 1n : 1n;
  return { maxFeePerGas: fee, maxPriorityFeePerGas: 1n };
};
/** The cheapest price that is still includable: the base fee plus a 1-wei tip. */
const minimumCaps = async () => {
  const h = await head();
  return { maxFeePerGas: h.baseFee * 2n + 1n, maxPriorityFeePerGas: 1n };
};

async function reputation(node: Node) {
  if (target.kind !== "sidecar") return null;
  const r = await rpc<any>(node.url, "skandha_explorer_listReputation", [{ limit: 500 }]);
  const e = r.items.find((x: any) => x.address.toLowerCase() === cfg.pool.toLowerCase());
  return e ? { seen: e.opsSeen, included: e.opsIncluded, status: e.status } : { seen: 0, included: 0, status: "ok" };
}
const reps = async () => Object.fromEntries(await Promise.all(target.nodes.map(async (n) => [n.name, await reputation(n)])));
async function sidecarStatuses(node: Node, hashes: string[]) {
  const r = await rpc<any>(node.url, "skandha_explorer_listTransactions", [{ limit: 500 }]);
  const by = new Map<string, string>(r.items.map((x: any) => [x.txHash.toLowerCase(), x.status]));
  return hashes.map((h) => by.get(h.toLowerCase()) ?? "absent");
}
async function width(label: string) {
  if (!target.matcha) return null;
  const w = await rpc<any>(cfg.rpc, "ethrex_matchaWidth", [cfg.pool]);
  const h = await head();
  const row = { label, block: h.number, at: new Date().toISOString(), width: Number(BigInt(w.width)), pendingFrameTxs: Number(w.pendingFrameTxs), pendingCharges: Number(BigInt(w.pendingCharges ?? 0)), widthCap: Number(BigInt(w.widthCap)) };
  out.widthTimeline.push(row);
  return row;
}

// ---------- sending ----------
async function send(node: Node, tx: FrameTx): Promise<{ ok: boolean; hash: string; error?: string; ms: number }> {
  const t = now();
  const hash = txHashOf(profile, tx);
  try {
    if (target.kind === "sidecar") await rpc(node.url, "eth_sendFrameTransaction", [toWire(tx)]);
    else await rpc(node.url, "eth_sendRawTransaction", [rawOf(profile, tx)]);
    return { ok: true, hash, ms: now() - t };
  } catch (e: any) {
    return { ok: false, hash, error: String(e.message ?? e).slice(0, 200), ms: now() - t };
  }
}
async function simulate(tx: FrameTx) {
  let sim: any;
  try {
    sim = await rpc<any>(cfg.rpc, "ethrex_simulateFrameTransaction", profile.simulateParams(rawOf(profile, tx)));
  } catch (e: any) {
    return { admitted: false, why: String(e.message ?? e).slice(0, 160), matchaCharge: undefined, matchaAdmissible: undefined, matchaRefusal: undefined };
  }
  let admitted = !sim.executionError && (sim.frames ?? []).slice(0, S + 1).every((f: any) => f.succeeded) && (sim.frames ?? []).length > 0;
  if (profile.submit === "public-mempool") admitted = admitted && sim.valid === true;
  return { admitted, why: sim.executionError ?? sim.violation ?? null, matchaCharge: sim.matchaCharge ? Number(BigInt(sim.matchaCharge)) : undefined, matchaAdmissible: sim.matchaAdmissible, matchaRefusal: sim.matchaRefusal };
}
async function receipt(hash: string) {
  return rpc<any>(cfg.rpc, "eth_getTransactionReceipt", [hash]);
}
async function inPool(hash: string) {
  const t = await rpc<any>(cfg.rpc, "eth_getTransactionByHash", [hash]).catch(() => null);
  return t != null && t.blockNumber == null;
}
async function waitLanded(hashes: string[], timeoutMs: number) {
  const start = now();
  const landed = new Map<string, { block: number; at: number; status: string }>();
  while (now() - start < timeoutMs && landed.size < hashes.length) {
    for (const h of hashes) {
      if (landed.has(h)) continue;
      const r = await receipt(h);
      if (r) landed.set(h, { block: Number(r.blockNumber), at: now() - start, status: r.status });
    }
    if (landed.size < hashes.length) await sleep(1000);
  }
  return landed;
}
const waitBlocks = async (n: number) => {
  const start = (await head()).number;
  while ((await head()).number < start + n) await sleep(500);
};

// ---------- setup ----------
const versions = Object.fromEntries(await Promise.all([[ "chain", cfg.rpc ], ...target.nodes.map((n) => [n.name, n.url])].map(async ([k, u]) => [k, await clientVersion(u)])));
out.versions = versions;
log(`\n== shared-sender harness: ${target.id}\n   ${target.describe}\n   pool ${cfg.pool}\n`);
const key = await fundedKey(cfg, deployerKey, "shared-sender", parseEther("6"));
const rl = await connect(cfg, key);
// A transaction priced below the base fee can't be simulated ("Insufficient max fee per gas"), so the SDK can't price
// it. For the harness only: fall back to an over-estimate (every frame's limits plus 200,000 for intrinsic gas), which
// only makes the note's fee larger than it needs to be. Whether the node admits such a transaction is a result.
const sdkMaxCost = (rl as any).maxCostOf.bind(rl);
(rl as any).maxCostOf = async (tx: FrameTx) => {
  try {
    return await sdkMaxCost(tx);
  } catch (e: any) {
    if (!/Insufficient max fee/i.test(String(e.message))) throw e;
    const gas = tx.frames.reduce((a, f) => a + f.limits.execution + f.limits.state, 200_000n);
    return gas * tx.fees.maxFeePerGas;
  }
};
const NOTES = Number(process.env.NOTES ?? 52);
const t0 = now();
for (let i = 0; i < NOTES; i++) await mined(cfg, (await rl.deposit({ amount: parseEther("0.05") })).hash);
log(`   ${NOTES} deposits of 0.05 ETH in ${((now() - t0) / 1000).toFixed(0)} s`);
let pool: Note[] = (await rl.notes()).filter((n) => !n.spent);
const take = (): Note => {
  const n = pool.shift();
  if (!n) throw new Error("out of notes: raise NOTES");
  return n;
};
const AMOUNT = parseEther("0.03"); // room for ten 15% fee bumps of the refundable gas deposit
const prepare = async (note: Note, caps: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }, to: Address = fresh()) => (await rl.prepare(note, { to, amount: AMOUNT }, 0n, await rl.sync(), caps)).tx;
await width("after deposits");
out.reputationStart = await reps();

// ---------- MATCHA bootstrap: a fresh shared sender has no width ----------
// How many blocks finality trails the head on this chain (ETHREX_DEV_FINALITY_LAG on the dev node). Width is credited
// only at finality, so reads wait this long after a withdrawal lands.
const LAG = Number(process.env.FINALITY_LAG ?? 0);
out.finalityLagBlocks = LAG;
if (target.matcha) {
  // Three at once from a pool that has never had a transaction finalize.
  const first = await Promise.all([0, 1, 2].map(async () => prepare(take(), await normalCaps())));
  const sims = await Promise.all(first.map(simulate));
  const sent = [];
  for (const tx of first) sent.push(await send(target.nodes[0], tx));
  const landedFirst = await waitLanded(sent.filter((r) => r.ok).map((r) => r.hash), 60_000);
  out.attacks.freshPool = {
    measured: { sent: 3, widthAtStart: out.widthTimeline.at(-1)?.width, admitted: sent.filter((r) => r.ok).length, refusals: sent.filter((r) => !r.ok).map((r) => r.error), matchaChargePerAdditional: sims[0].matchaCharge, landed: landedFirst.size },
  };
  log("   fresh pool:", JSON.stringify(out.attacks.freshPool.measured));
  const boot: any[] = [];
  for (let i = 0; i < 3; i++) {
    const tx = await prepare(take(), await normalCaps());
    const r = await send(target.nodes[0], tx);
    const landed = r.ok ? await waitLanded([r.hash], 60_000) : new Map();
    const atLanding = await width(`bootstrap ${i + 1}: landed`);
    await waitBlocks(LAG + 2);
    boot.push({ sent: r.ok, error: r.error, gasUsed: landed.size ? Number(BigInt((await receipt(r.hash)).gasUsed)) : null, widthAtLanding: atLanding?.width, widthAfterFinality: (await width(`bootstrap ${i + 1}: finalized`))?.width });
  }
  out.attacks.bootstrap = { measured: boot };
  log("   bootstrap:", JSON.stringify(boot));
}

// ---------- 5a. honest throughput, before any attack ----------
async function honestThroughput(label: string, H: number) {
  const before = await width(`${label}: before`);
  const txs = [];
  for (let i = 0; i < H; i++) txs.push(await prepare(take(), await normalCaps()));
  const sims = target.matcha ? await Promise.all(txs.map(simulate)) : [];
  const start = now();
  const results = await Promise.all(txs.map((tx) => send(target.nodes[0], tx)));
  const admitted = results.filter((r) => r.ok);
  const landed = await waitLanded(admitted.map((r) => r.hash), 120_000);
  const blocks = [...landed.values()].map((l) => l.block);
  const after = await width(`${label}: after`);
  // Retry the refused ones until they land, to measure recovery.
  const refusedTx = txs.filter((_, i) => !results[i].ok);
  const retry: any[] = [];
  const rStart = now();
  for (const tx of refusedTx) {
    for (let a = 0; a < 60; a++) {
      const r = await send(target.nodes[0], tx);
      if (r.ok) {
        const l = await waitLanded([r.hash], 60_000);
        retry.push({ attempts: a + 1, landedAfterMs: now() - rStart, block: l.get(r.hash)?.block });
        break;
      }
      if (a === 59) retry.push({ attempts: 60, landed: false, error: r.error });
      await waitBlocks(1);
    }
  }
  const m = {
    sent: H,
    admittedAtOnce: admitted.length,
    refusals: results.filter((r) => !r.ok).map((r) => r.error),
    landed: landed.size,
    allLandedMs: landed.size ? Math.max(...[...landed.values()].map((l) => l.at)) : null,
    blocks: [...new Set(blocks)].sort((a, b) => a - b),
    matchaCharges: sims.map((s) => s.matchaCharge),
    matchaAdmissibleBefore: sims.map((s) => s.matchaAdmissible),
    widthBefore: before?.width,
    widthAfter: after?.width,
    refusedThenRetried: retry,
    sinceSendMs: now() - start,
  };
  log(`   ${label}: ${m.admittedAtOnce}/${H} admitted at once, ${m.landed} landed in ${m.allLandedMs} ms, blocks ${m.blocks.join(",")}${m.refusals.length ? `; refused: ${m.refusals[0]}` : ""}`);
  return m;
}
out.attacks.honestBefore = { measured: await honestThroughput("honest throughput, before attacks", 6) };

// ---------- 1. conflicting withdrawals of one note, sent to different nodes ----------
{
  const K = 3;
  const rows: any[] = [];
  const repBefore = await reps();
  const widthBefore = await width("conflicts: before");
  const spent: Note[] = [];
  for (let i = 0; i < K; i++) {
    const note = take();
    const caps = await normalCaps();
    const a = await prepare(note, caps);
    const b = await prepare(note, caps);
    if (target.nodes.length > 1) {
      const onB = await send(target.nodes[1], b);
      const onA = await send(target.nodes[0], a);
      rows.push({ onA: onA.ok ? "admitted" : onA.error, onB: onB.ok ? "admitted" : onB.error });
    } else {
      // One node: the second version is a conflicting transaction at the same fee.
      const first = await send(target.nodes[0], a);
      const second = await send(target.nodes[0], b);
      rows.push({ first: first.ok ? "admitted" : first.error, secondSameFee: second.ok ? "admitted" : second.error });
    }
    spent.push(note);
  }
  for (const n of spent) for (let w = 0; w < 60 && !(await rl.isSpent(n.nullifierHash)); w++) await sleep(1000);
  await waitBlocks(3);
  await sleep(5000);
  out.attacks.conflictAcrossNodes = {
    measured: { pairs: K, rows, reputationBefore: repBefore, reputationAfter: await reps(), allSpentOnce: (await Promise.all(spent.map((n) => rl.isSpent(n.nullifierHash)))).every(Boolean), widthBefore: widthBefore?.width, widthAfter: (await width("conflicts: after"))?.width },
    notes: target.nodes.length > 1 ? [] : ["One node only (dev mode, p2p disabled), so the cross-node case reduces to a same-fee conflict on one node."],
  };
  log("   conflicts:", JSON.stringify(out.attacks.conflictAcrossNodes.measured));
}

// ---------- 2. fee-bump replacement spam on one node ----------
{
  const BUMPS = 10;
  const repBefore = await reps();
  // On MATCHA, replacing the free baseline costs nothing, so put a baseline in place first and spam an additional one.
  // On MATCHA, replacing the free baseline costs nothing, so a baseline goes first, in the same block window as the burst.
  const baselineTx = target.matcha ? await prepare(take(), await normalCaps()) : null;
  const note = take();
  const start = await normalCaps();
  const prepared: FrameTx[] = [];
  let fee = start.maxFeePerGas;
  let tip = start.maxPriorityFeePerGas > 0n ? start.maxPriorityFeePerGas : 1n;
  for (let i = 0; i < BUMPS; i++) {
    prepared.push(await prepare(note, { maxFeePerGas: fee, maxPriorityFeePerGas: tip }));
    fee = (fee * 115n) / 100n + 1n;
    tip = (tip * 115n) / 100n + 1n;
  }
  const widthBefore = await width("replacement spam: before");
  const t = now();
  const baselineSent = baselineTx ? await send(target.nodes[0], baselineTx) : null;
  const baseline = baselineSent ? (baselineSent.ok ? "admitted just before the burst" : `refused: ${baselineSent.error}`) : null;
  const sent = [];
  for (const tx of prepared) sent.push(await send(target.nodes[0], tx));
  const burstMs = now() - t;
  const repAfterBurst = await reps();
  const widthAfterBurst = await width("replacement spam: after burst");
  for (let w = 0; w < 90 && !(await rl.isSpent(note.nullifierHash)); w++) await sleep(1000);
  await waitBlocks(3);
  await sleep(5000);
  out.attacks.replacementSpam = {
    measured: {
      bumps: BUMPS,
      burstMs,
      accepted: sent.filter((s) => s.ok).length,
      refusals: sent.filter((s) => !s.ok).map((s) => s.error),
      reputationBefore: repBefore,
      reputationAfterBurst: repAfterBurst,
      reputationAfterLanding: await reps(),
      noteSpentOnce: await rl.isSpent(note.nullifierHash),
      baseline,
      widthBefore: widthBefore?.width,
      widthAfterBurst: widthAfterBurst?.width,
      widthAfterLanding: (await width("replacement spam: after landing"))?.width,
      widthAfterFinality: LAG ? (await waitBlocks(LAG + 2), (await width("replacement spam: after finality"))?.width) : undefined,
    },
  };
  log("   replacement spam:", JSON.stringify(out.attacks.replacementSpam.measured));
}

// ---------- 3. width draining: many valid low-fee withdrawals that sit pending ----------
{
  const M = 10;
  const repBefore = await reps();
  const widthBefore = await width("width draining: before");
  const hashes: string[] = [];
  let results = [];
  // First, below the base fee, which would sit pending. If the node refuses that, the cheapest includable price.
  const probe = await send(target.nodes[0], await prepare(take(), await lowCaps()));
  const belowBaseFee = { admitted: probe.ok, error: probe.error };
  const caps = probe.ok ? lowCaps : minimumCaps;
  if (probe.ok) hashes.push(probe.hash);
  for (let i = probe.ok ? 1 : 0; i < M; i++) {
    const r = await send(target.nodes[0], await prepare(take(), await caps()));
    results.push(r);
    if (r.ok) hashes.push(r.hash);
  }
  if (probe.ok) results = [probe, ...results];
  await waitBlocks(2);
  const pendingNow = target.kind === "ethrex" ? (await Promise.all(hashes.map(inPool))).filter(Boolean).length : null;
  const widthAfterAdmit = await width("width draining: after admission");
  // An honest withdrawal at a normal fee, right after.
  const honestTx = await prepare(take(), await normalCaps());
  const honestSim = await simulate(honestTx);
  const honest = await send(target.nodes[0], honestTx);
  const honestLanded = honest.ok ? await waitLanded([honest.hash], 60_000) : new Map();
  // Watch the attack transactions and the width for a while.
  const watch: any[] = [];
  for (let i = 0; i < 6; i++) {
    await waitBlocks(5);
    const w = await width(`width draining: +${(i + 1) * 5} blocks`);
    const pending = target.kind === "ethrex" ? (await Promise.all(hashes.map(inPool))).filter(Boolean).length : null;
    const statuses = target.kind === "sidecar" ? await sidecarStatuses(target.nodes[0], hashes) : null;
    watch.push({ afterBlocks: (i + 1) * 5, width: w?.width, attackPending: pending, sidecarStatuses: statuses ? countBy(statuses) : null });
  }
  out.attacks.widthDraining = {
    measured: {
      belowBaseFee,
      priced: probe.ok ? "below the base fee (1-wei tip)" : "the cheapest includable price (1-wei tip)",
      sent: M,
      admitted: results.filter((r) => r.ok).length,
      refusals: [...new Set(results.filter((r) => !r.ok).map((r) => r.error))],
      attackPendingAfter2Blocks: pendingNow,
      widthBefore: widthBefore?.width,
      widthAfterAdmission: widthAfterAdmit?.width,
      honest: { matchaAdmissibleBySimulation: honestSim.matchaAdmissible, matchaRefusal: honestSim.matchaRefusal, admitted: honest.ok, error: honest.error, landedMs: honestLanded.get(honest.hash)?.at ?? null },
      watch,
      reputationBefore: repBefore,
      reputationAfter: await reps(),
    },
  };
  log("   width draining:", JSON.stringify(out.attacks.widthDraining.measured));
}
// ---------- 3b. replacement draining: several note holders each bump a pending withdrawal, then an honest one ----------
{
  const HOLDERS = 4;
  const BUMPS = 5;
  const repBefore = await reps();
  const baselineTx = await prepare(take(), await normalCaps());
  const bursts: FrameTx[][] = [];
  for (let h = 0; h < HOLDERS; h++) {
    const note = take();
    const c = await normalCaps();
    const versions: FrameTx[] = [];
    let fee = c.maxFeePerGas;
    let tip = c.maxPriorityFeePerGas;
    for (let b = 0; b < BUMPS; b++) {
      versions.push(await prepare(note, { maxFeePerGas: fee, maxPriorityFeePerGas: tip }));
      fee = (fee * 115n) / 100n + 1n;
      tip = (tip * 115n) / 100n + 1n;
    }
    bursts.push(versions);
  }
  const honestTx = await prepare(take(), await normalCaps());
  const widthBefore = await width("replacement draining: before");
  const t = now();
  const baseline = await send(target.nodes[0], baselineTx);
  const results: { ok: boolean; error?: string }[] = [];
  for (const versions of bursts) for (const tx of versions) results.push(await send(target.nodes[0], tx));
  const honest = await send(target.nodes[0], honestTx);
  const burstMs = now() - t;
  const widthAfterBurst = await width("replacement draining: after burst");
  // If the honest withdrawal was refused, retry it every block until it gets in.
  let honestRetry: any = null;
  if (!honest.ok) {
    const rStart = now();
    const startBlock = (await head()).number;
    for (let a = 1; a <= 200; a++) {
      await waitBlocks(1);
      const r = await send(target.nodes[0], honestTx);
      if (r.ok) {
        honestRetry = { attempts: a, blocks: (await head()).number - startBlock, ms: now() - rStart, width: (await width("replacement draining: honest admitted"))?.width };
        break;
      }
      if (a === 200) honestRetry = { attempts: a, admitted: false, lastError: r.error };
    }
  }
  await waitBlocks(3);
  await sleep(5000);
  out.attacks.replacementDraining = {
    measured: {
      holders: HOLDERS,
      bumpsEach: BUMPS,
      burstMs,
      baseline: baseline.ok ? "admitted" : baseline.error,
      attackAccepted: results.filter((r) => r.ok).length,
      attackSent: results.length,
      attackRefusals: [...new Set(results.filter((r) => !r.ok).map((r) => r.error))],
      honest: { admittedRightAway: honest.ok, error: honest.error, retry: honestRetry },
      widthBefore: widthBefore?.width,
      widthAfterBurst: widthAfterBurst?.width,
      reputationBefore: repBefore,
      reputationAfter: await reps(),
    },
  };
  log("   replacement draining:", JSON.stringify(out.attacks.replacementDraining.measured));
}
function countBy(xs: string[]) {
  return xs.reduce((m: Record<string, number>, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
}

// ---------- 4. mass invalidation: does one state change invalidate many pending withdrawals? ----------
{
  const N = 6;
  const txs = [];
  for (let i = 0; i < N; i++) txs.push(await prepare(take(), await normalCaps()));
  const valid0 = (await Promise.all(txs.map(simulate))).filter((s) => s.admitted).length;
  // Where a node holds them without mining (sidecar B), park them there too, and watch its revalidation.
  const parked = target.nodes.find((n) => !n.mines);
  const parkedHashes = parked ? (await Promise.all(txs.map((tx) => send(parked, tx)))).filter((r) => r.ok).map((r) => r.hash) : [];
  const changes: any[] = [];
  const check = async (what: string) => {
    const sims = await Promise.all(txs.map(simulate));
    changes.push({ after: what, stillValid: sims.filter((s) => s.admitted).length, reasons: [...new Set(sims.filter((s) => !s.admitted).map((s) => s.why))], parkedStatuses: parked ? countBy(await sidecarStatuses(parked, parkedHashes)) : null });
  };
  await mined(cfg, (await rl.deposit({ amount: parseEther("0.05") })).hash); // a new leaf, a new root published
  await waitBlocks(2);
  await check("a deposit (new leaf, new root published, pool balance up)");
  const w = await send(target.nodes[0], await prepare(take(), await normalCaps())); // another withdrawal lands
  if (w.ok) await waitLanded([w.hash], 60_000);
  await waitBlocks(2);
  await check("another withdrawal landed (new leaf, new root, pool balance down, a nonce key consumed)");
  await waitBlocks(20);
  await check("20 more blocks");
  out.attacks.massInvalidation = {
    measured: { pending: N, validAtStart: valid0, parkedOnNonMiningNode: parkedHashes.length, changes },
    notes: ["Validity checked by the target chain's own simulation after each change. The only state a withdrawal's validation depends on is its own nonce key, the recent-root window and the pool's balance covering its maxCost."],
  };
  log("   mass invalidation:", JSON.stringify(out.attacks.massInvalidation.measured));
}

// ---------- 5b. honest throughput, after the attacks ----------
out.attacks.honestAfter = { measured: await honestThroughput("honest throughput, after attacks", 6) };

out.reputationEnd = await reps();
out.finishedAt = new Date().toISOString();
mkdirSync("research/shared-sender/results", { recursive: true });
writeFileSync(`research/shared-sender/results/${target.id}.json`, JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
log(`\nwrote research/shared-sender/results/${target.id}.json`);
await stopWorkers();
process.exit(0);
