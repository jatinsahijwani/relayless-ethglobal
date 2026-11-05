#!/usr/bin/env -S npx tsx
// relayless deposit|withdraw|anonymity|recover|fresh|ragequit
// Reads config/<network>.deployed.json and RELAYLESS_KEY (devnet keys only).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEther, formatEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Relayless, fileProver, rpcCall, type InFlight, type InFlightStore, type Signer } from "./deps.js";

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const network = process.env.RELAYLESS_NETWORK ?? "local";
const cfg = JSON.parse(readFileSync(`config/${network}.deployed.json`, "utf8"));
const key = process.env.RELAYLESS_KEY as Hex;

/** The in-flight ledger, on disk: a second run of this command must not resend a pending note. */
class FileStore implements InFlightStore {
  private file = `.relayless/${network}-inflight.json`;
  private read(): Record<string, InFlight> {
    return existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : {};
  }
  private write(m: Record<string, InFlight>) {
    mkdirSync(".relayless", { recursive: true });
    writeFileSync(this.file, JSON.stringify(m, null, 2));
  }
  get(n: bigint) { return this.read()[n.toString()]; }
  set(e: InFlight) { this.write({ ...this.read(), [e.nullifierHash]: e }); }
  delete(n: bigint) { const m = this.read(); delete m[n.toString()]; this.write(m); }
  all() { return Object.values(this.read()); }
}

function signer(): Signer {
  if (!key) throw new Error("set RELAYLESS_KEY to a devnet key");
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    signTypedData: (a) => account.signTypedData(a as any),
    async sendTransaction({ to, value, data }) {
      const nonce = Number(await rpcCall(cfg.rpc, "eth_getTransactionCount", [account.address, "pending"]));
      const block = await rpcCall(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
      const raw = await account.signTransaction({ chainId: cfg.chainId, nonce, to, value, data, gas: 5_000_000n, gasPrice: BigInt(block.baseFeePerGas) * 3n + 1000n, type: "legacy" });
      return rpcCall(cfg.rpc, "eth_sendRawTransaction", [raw]);
    },
  };
}

const rl = await Relayless.connect({ rpc: cfg.rpc, mempool: cfg.mempool, pool: cfg.pool as Address, signer: signer(), prover: fileProver("packages/circuits/build"), store: new FileStore(), chainId: cfg.chainId, feeRange: cfg.feeRange ? { min: BigInt(cfg.feeRange.min), max: BigInt(cfg.feeRange.max) } : undefined });
const out = (s: string) => console.log(s);

switch (cmd) {
  case "deposit": {
    const amount = parseEther(flag("amount") ?? "");
    const { hash } = await rl.deposit({ amount });
    out(`deposit sent: ${hash}`);
    break;
  }
  case "fresh": {
    await rl.unlock();
    out(rl.freshAddress(Number(flag("index") ?? 0)));
    break;
  }
  case "recover": {
    const notes = await rl.notes();
    for (const n of notes) out(`${n.spent ? "spent  " : "unspent"}  ${formatEther(n.value)} ETH  leaf ${n.leafIndex}`);
    out(`balance: ${formatEther(notes.filter((n) => !n.spent).reduce((s, n) => s + n.value, 0n))} ETH across ${notes.filter((n) => !n.spent).length} notes`);
    break;
  }
  case "anonymity": {
    const a = flag("amount");
    const r = await rl.anonymity({ amount: a ? parseEther(a) : undefined });
    out(`hard to single out: ${r.minEntropyBits.toFixed(2)} bits (min-entropy)`);
    out(`overall:            ${r.shannonBits.toFixed(2)} bits (Shannon), worth about ${r.effectiveSetSize.toFixed(1)} equal deposits`);
    out(`could be any of:    ${r.setSize} deposits`);
    for (const line of r.advice) out(`- ${line}`);
    out("This is a model built on public data, not a guarantee.");
    break;
  }
  case "withdraw": {
    const to = flag("to") as Address;
    const amount = parseEther(flag("amount") ?? "");
    const h = await rl.withdraw({ to, amount, minAnon: Number(flag("min-anon") ?? 0) });
    out(`proved in ${h.proveMs} ms, admitted: ${h.hash}`);
    const r = await h.wait();
    out(r ? `mined in block ${Number(r.blockNumber)}, gas ${Number(r.gasUsed)}` : "landed");
    break;
  }
  case "ragequit": {
    const leaf = Number(flag("leaf"));
    const note = (await rl.notes()).find((n) => n.leafIndex === leaf && !n.spent);
    if (!note) throw new Error(`no unspent note at leaf ${leaf}`);
    const h = await rl.ragequit(note);
    out(`public exit admitted: ${h.hash}`);
    await h.wait();
    out(`paid to the original depositor ${note.depositor}`);
    break;
  }
  default:
    out("usage: relayless deposit --amount 1 | withdraw --to 0x.. --amount 0.5 [--min-anon 32] | anonymity [--amount 0.5] | recover | fresh [--index 0] | ragequit --leaf N");
}
(globalThis as any).curve_bn128?.terminate?.();
process.exit(0);
