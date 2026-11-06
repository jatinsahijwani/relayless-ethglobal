import { serializeTypedData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { BrowserStore, Relayless, httpAssociationSet, type Prover, type Signer } from "@relayless/sdk";
import { nonceSettled, rpc } from "@relayless/sdk/chain";
import { cfg } from "./config";

const worker = new Worker(new URL("./prover.worker.ts", import.meta.url), { type: "module" });
let nextId = 0;
const provingWatchers = new Set<(proving: boolean) => void>();
/** Told when the prover really starts and stops, so a counter on screen shows proving and nothing else. */
export const watchProving = (f: (proving: boolean) => void) => {
  provingWatchers.add(f);
  return () => { provingWatchers.delete(f); };
};
const prover: Prover = {
  prove: (circuit, input) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      provingWatchers.forEach((f) => f(true));
      const onMessage = (e: MessageEvent) => {
        if (e.data.id !== id) return;
        worker.removeEventListener("message", onMessage);
        provingWatchers.forEach((f) => f(false));
        if (e.data.ok) resolve({ proof: e.data.proof, publicSignals: e.data.publicSignals });
        else reject(new Error(e.data.error));
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ id, circuit, input });
    }),
};

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* blocked storage: the value lasts until reload */ }
}

/** Devnet only: a throwaway key kept in this browser, so the demo needs no wallet extension. */
export function testSigner(): Signer {
  let key = read("relayless.testKey") as Hex | null;
  if (!key) {
    key = generatePrivateKey();
    write("relayless.testKey", key);
  }
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    signTypedData: (a) => account.signTypedData(a as any),
    signMessage: (message) => account.signMessage({ message }),
    async sendTransaction({ to, value, data }) {
      const nonce = Number(await rpc(cfg.rpc, "eth_getTransactionCount", [account.address, "pending"]));
      const block = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
      const raw = await account.signTransaction({ chainId: cfg.chainId, nonce, to, value, data, gas: 5_000_000n, gasPrice: BigInt(block.baseFeePerGas) * 3n + 1000n, type: "legacy" });
      return rpc(cfg.rpc, "eth_sendRawTransaction", [raw]);
    },
  };
}

/**
 * Demo only: the wallet `pnpm demo:reset` funded and approved. The dev server serves it, git ignores it, and the key is
 * never shown. A new one starts this browser clean, so each take begins with fresh addresses.
 */
export async function demoSigner(): Promise<Signer> {
  const res = await fetch("/demo-wallet.json");
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) throw new Error("No demo wallet yet. Run pnpm demo:reset, then try again.");
  const wallet = (await res.json()) as { id: string; key: Hex };
  if (read("relayless.demoId") !== wallet.id) {
    for (const k of ["relayless.freshIndex", "relayless.activity", "relayless.inflight"]) {
      try { localStorage.removeItem(k); } catch { /* blocked storage: nothing to clear */ }
    }
    write("relayless.demoId", wallet.id);
    write("relayless.testKey", wallet.key);
  }
  return testSigner();
}

export const hasBrowserWallet = () => Boolean((window as any).ethereum);

export async function browserSigner(): Promise<Signer> {
  const eth = (window as any).ethereum;
  const [address] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  const chainHex = `0x${cfg.chainId.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
  } catch {
    await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: chainHex, chainName: `Relayless ${cfg.name}`, rpcUrls: [cfg.walletRpc], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }] });
  }
  return {
    address,
    signTypedData: (a) => eth.request({ method: "eth_signTypedData_v4", params: [address, serializeTypedData(a as any)] }),
    signMessage: (message) => eth.request({ method: "personal_sign", params: [message, address] }),
    sendTransaction: ({ to, value, data }) => eth.request({ method: "eth_sendTransaction", params: [{ from: address, to, value: `0x${value.toString(16)}`, data, gas: "0x4C4B40" }] }),
  };
}

/** `choice` is an ASP picked from the ENS directory, which brings its own pool: each pool takes roots from one ASP. */
export const connectPool = (signer: Signer, choice?: { pool: Address; endpoint: string | null }) => {
  const aspUrl = choice ? choice.endpoint : cfg.aspUrl;
  return Relayless.connect({ rpc: cfg.rpc, mempool: cfg.mempool, pool: choice?.pool ?? cfg.pool, signer, prover, store: new BrowserStore(), chainId: cfg.chainId, feeRange: cfg.feeRange ? { min: BigInt(cfg.feeRange.min), max: BigInt(cfg.feeRange.max) } : undefined, asp: aspUrl ? httpAssociationSet(aspUrl) : undefined });
};

export const walletBalance = async (a: Address) => BigInt(await rpc(cfg.rpc, "eth_getBalance", [a, "latest"]));

export const askFaucet = (a: Address) => rpc(cfg.mempool, "skandha_explorer_faucet", [a]);

export async function waitMined(hash: Hex) {
  for (let i = 0; i < 90; i++) {
    const r = await rpc(cfg.rpc, "eth_getTransactionReceipt", [hash]);
    if (r) {
      await nonceSettled(cfg.rpc, hash);
      return r;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("Not mined after 90 seconds. Check Activity before trying again.");
}

export function nextFreshIndex(): number {
  const i = Number(read("relayless.freshIndex") ?? 0);
  write("relayless.freshIndex", String(i + 1));
  return i;
}

export interface ActivityEntry { hash: Hex; to: Address; amount: string; fee: string; at: number; fresh: boolean; proveMs: number }
export const readActivity = (): ActivityEntry[] => JSON.parse(read("relayless.activity") ?? "[]");
export const addActivity = (e: ActivityEntry) => write("relayless.activity", JSON.stringify([e, ...readActivity()].slice(0, 50)));
