// Run before recording or judging: a green or red line for everything the demo depends on. Reads only, unless you accept
// a fix. A fix can seed, prepare a new demo wallet or start the demo ASP. Nothing here restarts the chain.
// usage: scripts/demo-prep.sh [--fix]
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { encodeFunctionData, parseEther, type Hex } from "viem";
import { POOL_ABI, createEnsReader, crossCheckRoot } from "@relayless/sdk";
import { balanceOf, connect, rpc, stopWorkers } from "./lib.js";
import { fetchPoolState } from "../packages/sdk/src/chain.js";
import { loadEnsConfig } from "./ens/lib.js";
import { DEMO_NETWORK, SEED_COUNT, aspSet, cfg, readDemoWallet, seedAddress } from "./demo-lib.js";

const ROOT_LIFE_SLOTS = 8191;
/** Below this, a recording could outlast the root. An hour is 600 slots. */
const MIN_ROOT_SLOTS_LEFT = 1200;
const WEB = process.env.RELAYLESS_WEB_URL ?? "http://127.0.0.1:5199";
const WORLD_ASP = "http://127.0.0.1:8790";

interface Fix { label: string; run(): Promise<void> | void }
const results: { ok: boolean; name: string; detail: string; fix?: Fix; manual?: string }[] = [];
const color = process.stdout.isTTY;
const paint = (ok: boolean) => (ok ? (color ? "\x1b[32m✔\x1b[0m" : "✔") : color ? "\x1b[31m✘\x1b[0m" : "✘");

async function check(name: string, f: () => Promise<{ ok: boolean; detail?: string; fix?: Fix; manual?: string }>) {
  let r: { ok: boolean; detail?: string; fix?: Fix; manual?: string };
  try {
    r = await f();
  } catch (e: any) {
    r = { ok: false, detail: String(e?.message ?? e).split("\n")[0].slice(0, 160) };
  }
  results.push({ ok: r.ok, name, detail: r.detail ?? "", fix: r.fix, manual: r.manual });
  console.log(`${paint(r.ok)} ${name}${r.detail ? `: ${r.detail}` : ""}`);
  return r.ok;
}

const pnpmScript = (script: string): Fix => ({
  label: `pnpm ${script}`,
  run() {
    const done = spawnSync("pnpm", ["--silent", script], { stdio: "inherit" });
    if (done.status !== 0) throw new Error(`pnpm ${script} failed`);
  },
});
const seedFix = pnpmScript("demo:seed");
const resetFix = pnpmScript("demo:reset");
const aspFix: Fix = {
  label: "start the demo ASP on 8791",
  async run() {
    spawn("scripts/demo-asp.sh", { detached: true, stdio: "ignore" }).unref();
    await new Promise((r) => setTimeout(r, 6000));
  },
};
const webCommand = `RELAYLESS_NETWORK=${DEMO_NETWORK} pnpm web`;

console.log(`\nRelayless demo check: ${DEMO_NETWORK}, pool ${cfg.pool}\n`);

const headBlock = async () => rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);

await check("Chain is up and past the block-number hole", async () => {
  const head = Number(await rpc<string>(cfg.rpc, "eth_blockNumber", []));
  const code = await rpc<string>(cfg.rpc, "eth_getCode", ["0x0000000000000000000000000000000000008272", "latest"]);
  if (code === "0x") return { ok: false, detail: `block ${head}, frame transactions not active yet`, manual: "wait: they activate about 11 minutes after genesis" };
  const probe = await Promise.all([...Array(60).keys()].map((i) => rpc(cfg.rpc, "eth_getBlockByNumber", [`0x${(130 + i).toString(16)}`, false]).then((b) => (b ? null : 130 + i)).catch(() => 130 + i)));
  const holes = probe.filter((x): x is number => x !== null && x <= head);
  const last = holes.at(-1);
  const seconds = await (async () => {
    const a = await headBlock();
    return Math.floor(Date.now() / 1000) - Number(a.timestamp);
  })();
  if (head < 200) return { ok: false, detail: `block ${head}: the hole usually appears at about 149, so wait for block 200` };
  if (seconds > 60) return { ok: false, detail: `the last block is ${seconds} s old: the chain may have stalled` };
  return { ok: true, detail: `block ${head}, last block ${seconds} s ago${last ? `, hole at ${holes[0]}–${last} is behind us` : ""}` };
});

await check("Sidecar is up, and the pool is staked with healthy reputation", async () => {
  const list = await rpc(cfg.mempool, "skandha_explorer_listReputation", [{ limit: 200 }]);
  const entry = list.items.find((x: any) => x.address.toLowerCase() === cfg.pool.toLowerCase());
  if (!entry) {
    // A pool the node hasn't seen yet has no entry, so read the stake from the registry's view of it instead.
    const code = await rpc<string>(cfg.rpc, "eth_getCode", [cfg.pool, "latest"]);
    return { ok: code !== "0x", detail: "no reputation history yet, which counts as healthy" };
  }
  const detail = `${entry.status}, staked ${entry.isStaked}, seen ${entry.opsSeen}, included ${entry.opsIncluded}`;
  return { ok: entry.status === "ok" && entry.isStaked, detail };
});

await check("Pool gas reserve is funded", async () => {
  const reserve = BigInt(await rpc(cfg.rpc, "eth_call", [{ to: cfg.pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: "reserve" }) }, "latest"]));
  return { ok: reserve >= parseEther("0.1"), detail: `${Number(reserve) / 1e18} ETH`, manual: reserve >= parseEther("0.1") ? undefined : "call fundReserve() on the pool" };
});

const aspUp = await check("Demo pool's ASP is up (allowlist, 8791)", async () => {
  const res = await fetch(`${cfg.aspUrl}/config`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
  if (!res?.ok) return { ok: false, detail: "no answer", fix: aspFix };
  const body = (await res.json()) as { allowlist?: boolean };
  return { ok: Boolean(body.allowlist), detail: body.allowlist ? "allowlist policy" : "running without the allowlist policy", fix: body.allowlist ? undefined : aspFix };
});

await check("World ID ASP is up (8790), for the World ID segment", async () => {
  const res = await fetch(`${WORLD_ASP}/config`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
  if (!res?.ok) return { ok: false, detail: "no answer", manual: "RELAYLESS_NETWORK=local-asp ASP_ENS_LABEL=world ASP_ALLOWED_ORIGIN=http://127.0.0.1:5199 pnpm --filter @relayless/asp start" };
  const body = (await res.json()) as { enabled: boolean; environment: string };
  const set = (await (await fetch(`${WORLD_ASP}/set`)).json()) as { ref: { slot: string } | null };
  const slot = BigInt((await headBlock()).slotNumber);
  const left = set.ref ? BigInt(ROOT_LIFE_SLOTS) - (slot - BigInt(set.ref.slot)) : 0n;
  return { ok: body.enabled && left > BigInt(MIN_ROOT_SLOTS_LEFT), detail: `World ID ${body.enabled ? "on" : "off"} (${body.environment}), root has ${Number(left)} slots left`, manual: "restart that ASP: it republishes its root on start" };
});

await check("Web app responds, on the demo pool", async () => {
  const res = await fetch(WEB, { signal: AbortSignal.timeout(4000) }).catch(() => null);
  if (!res?.ok) return { ok: false, detail: `no answer at ${WEB}`, manual: webCommand };
  const env = await (await fetch(`${WEB}/@vite/env`)).text().catch(() => "");
  const serving = /"pool":"(0x[0-9a-fA-F]{40})"/.exec(env)?.[1];
  if (serving && serving.toLowerCase() !== cfg.pool.toLowerCase()) return { ok: false, detail: `it's serving another pool, ${serving}`, manual: `stop it, then: ${webCommand}` };
  return { ok: true, detail: WEB };
});

await check("Sepolia RPC and the ENS directory resolve", async () => {
  const ens = loadEnsConfig();
  const list = await createEnsReader(ens).listAsps();
  const allow = list.find((a: any) => a.label === "allowlist");
  const world = list.find((a: any) => a.label === (ens as any).names.worldAspLabel);
  if (!allow || !world) return { ok: false, detail: `found ${list.map((a: any) => a.label).join(", ")}` };
  const salt = (ens as any).aspSaltPreimage;
  const [c1, c2] = await Promise.all([crossCheckRoot(world, { rpc: cfg.rpc, saltPreimage: salt }), crossCheckRoot(allow, { rpc: cfg.rpc, saltPreimage: salt })]);
  const ok = c1.status === "verified" && c2.status === "verified";
  return { ok, detail: `${list.length} ASPs, roots against the chain: world ${c1.status}, allowlist ${c2.status}`, fix: c2.status === "verified" ? undefined : resetFix, manual: c1.status === "verified" ? undefined : "restart the World ID ASP: it republishes its root on start" };
});

const state = await fetchPoolState(cfg.rpc, cfg.pool).catch(() => null);

await check("Anonymity set is seeded", async () => {
  if (!state) return { ok: false, detail: "couldn't read the pool" };
  const depositors = new Set(state.deposits.map((d) => d.depositor.toLowerCase()));
  const made = [...Array(SEED_COUNT).keys()].filter((i) => depositors.has(seedAddress(i).toLowerCase())).length;
  return { ok: made === SEED_COUNT, detail: `${made} of ${SEED_COUNT} seed deposits, ${state.deposits.length} deposits in all`, fix: made === SEED_COUNT ? undefined : seedFix };
});

const wallet = readDemoWallet();
const demo = wallet ? await connect(cfg, wallet.key) : null;

await check("Demo deposit is approved in the association set", async () => {
  if (!demo) return { ok: false, detail: "no demo wallet yet", fix: resetFix };
  if (!aspUp) return { ok: false, detail: "the ASP is down", fix: aspFix };
  const notes = (await demo.notes()).filter((n) => !n.spent);
  const set = await aspSet();
  const approved = notes.filter((n) => set.labels.includes(n.label.toString())).length;
  const slot = BigInt((await headBlock()).slotNumber);
  const left = set.ref ? BigInt(ROOT_LIFE_SLOTS) - (slot - BigInt(set.ref.slot)) : 0n;
  const ok = notes.length >= 4 && approved === notes.length && left > BigInt(MIN_ROOT_SLOTS_LEFT);
  return { ok, detail: `${approved} of ${notes.length} unspent notes approved (a take needs 4), root has ${Number(left)} slots left`, fix: ok ? undefined : resetFix };
});

await check("A fresh recipient holds 0 ETH", async () => {
  if (!demo) return { ok: false, detail: "no demo wallet yet", fix: resetFix };
  const b = await balanceOf(cfg, demo.freshAddress(0));
  return { ok: b === 0n, detail: b === 0n ? "0 ETH" : "already paid: this wallet has been used for a take", fix: b === 0n ? undefined : resetFix };
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} ready\n`);

if (failed.length) {
  const fixes = [...new Map(failed.filter((r) => r.fix).map((r) => [r.fix!.label, r.fix!])).values()];
  for (const r of failed) if (r.manual) console.log(`  by hand, for "${r.name}": ${r.manual}`);
  if (fixes.length) {
    const auto = process.argv.includes("--fix");
    let go = auto;
    if (!auto && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      go = /^y/i.test(await rl.question(`Safe fixes available: ${fixes.map((f) => f.label).join(", ")}. Run them? [y/N] `));
      rl.close();
    } else if (!auto) {
      console.log(`  safe fixes available with --fix: ${fixes.map((f) => f.label).join(", ")}`);
    }
    if (go) {
      for (const f of fixes) {
        console.log(`\nRunning: ${f.label}`);
        await f.run();
      }
      console.log("\nDone. Run this check again to confirm.");
    }
  }
}
await stopWorkers();
process.exit(failed.length ? 1 : 0);
