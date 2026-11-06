// Shared by the demo scripts. The demo pool is the allowlist ASP's pool: approving a depositor there is that ASP's stated
// policy, so demo data never appears under the World ID ASP's name.
import { existsSync, readFileSync } from "node:fs";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { allowMessage } from "../apps/asp/src/asp.js";
import { loadConfig } from "./lib.js";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export const DEMO_NETWORK = process.env.RELAYLESS_NETWORK ?? "local-asp2";
export const cfg = loadConfig(DEMO_NETWORK);
export const SEED_COUNT = 56;
/** Served only by the local dev server, and ignored by git. A throwaway devnet key: never shown on screen or logged. */
export const DEMO_WALLET = "apps/web/public/demo-wallet.json";

/** Throwaway and public by construction: the same index always gives the same key, which is what makes seeding idempotent. */
export const seedKey = (i: number): Hex => keccak256(toHex(`relayless-demo-seed:${cfg.pool.toLowerCase()}:${i}`));
export const seedAddress = (i: number): Address => privateKeyToAccount(seedKey(i)).address;

export const readDemoWallet = (): { id: string; key: Hex } | null => (existsSync(DEMO_WALLET) ? JSON.parse(readFileSync(DEMO_WALLET, "utf8")) : null);

export const aspUrl = (): string => {
  if (!cfg.aspUrl) throw new Error(`config/${DEMO_NETWORK}.deployed.json has no aspUrl`);
  return cfg.aspUrl;
};

export async function aspSet(): Promise<{ labels: string[]; ref: { slot: string; root: Hex } | null }> {
  const res = await fetch(`${aspUrl()}/set`);
  if (!res.ok) throw new Error(`the ASP answered ${res.status}`);
  return res.json();
}

/** Approves depositors on the demo pool's ASP. Resolves once the new root is usable on the chain. */
export async function allow(depositors: Address[]): Promise<void> {
  const operatorKey = process.env.ASP2_KEY as Hex;
  if (!operatorKey) throw new Error("set ASP2_KEY");
  const signature = await privateKeyToAccount(operatorKey).signMessage({ message: allowMessage(cfg.pool, depositors) });
  const res = await fetch(`${aspUrl()}/allow`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ depositors, signature }) });
  if (!res.ok) throw new Error(`the ASP refused: ${(await res.json()).message}`);
}
