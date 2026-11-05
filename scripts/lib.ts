import { readFileSync } from "node:fs";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Relayless, fileProver, type Signer } from "@relayless/sdk";
import { rpc } from "../packages/sdk/src/chain.js";

export const loadConfig = (network = process.env.RELAYLESS_NETWORK ?? "local") => JSON.parse(readFileSync(`config/${network}.deployed.json`, "utf8"));
export const CIRCUITS = "packages/circuits/build";
export { rpc };

/** Devnet signer: signs locally and sends a plain transaction. */
export function localSigner(cfg: any, key: Hex): Signer {
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    signTypedData: (args) => account.signTypedData(args as any),
    async sendTransaction({ to, value, data }) {
      const nonce = Number(await rpc(cfg.rpc, "eth_getTransactionCount", [account.address, "pending"]));
      const block = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
      const raw = await account.signTransaction({ chainId: cfg.chainId, nonce, to, value, data, gas: 5_000_000n, gasPrice: BigInt(block.baseFeePerGas) * 3n + 1000n, type: "legacy" });
      return rpc<Hex>(cfg.rpc, "eth_sendRawTransaction", [raw]);
    },
  };
}

export const feeRangeOf = (cfg: any) => (cfg.feeRange ? { min: BigInt(cfg.feeRange.min), max: BigInt(cfg.feeRange.max) } : undefined);

export const connect = (cfg: any, key: Hex) =>
  Relayless.connect({ rpc: cfg.rpc, mempool: cfg.mempool, pool: cfg.pool as Address, signer: localSigner(cfg, key), prover: fileProver(CIRCUITS), chainId: cfg.chainId, feeRange: feeRangeOf(cfg) });

export async function mined(cfg: any, hash: Hex) {
  for (let i = 0; i < 90; i++) {
    const r = await rpc(cfg.rpc, "eth_getTransactionReceipt", [hash]);
    if (r) {
      if (r.status !== "0x1") throw new Error(`reverted: ${hash}`);
      return r;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`not mined: ${hash}`);
}

export const balanceOf = async (cfg: any, a: Address) => BigInt(await rpc(cfg.rpc, "eth_getBalance", [a, "latest"]));

/** A throwaway key funded from the deployer, so each test run starts with a fresh seed. */
export async function fundedKey(cfg: any, deployerKey: Hex, label: string, amount: bigint): Promise<Hex> {
  const key = keccak256(toHex(`${label}:${Date.now()}:${Math.random()}`));
  const signer = localSigner(cfg, deployerKey);
  await mined(cfg, await signer.sendTransaction({ to: privateKeyToAccount(key).address, value: amount, data: "0x" }));
  return key;
}

export const stopWorkers = () => (globalThis as any).curve_bn128?.terminate?.();
