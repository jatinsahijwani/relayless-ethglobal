import { concat, keccak256, numberToHex, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fetchPoolState, rootOf } from "@relayless/sdk";
import { nonceSettled, rpc } from "@relayless/sdk/chain";
import type { Chain } from "./asp.js";

export const ASP_SALT = keccak256(toHex("relayless.asp"));
const RECENT_ROOT: Address = "0x0000000000000000000000000000000000008272";

export function liveChain(cfg: { rpc: string; pool: Address; chainId: number }, aspKey: Hex): Chain {
  const account = privateKeyToAccount(aspKey);
  return {
    async deposits() {
      return (await fetchPoolState(cfg.rpc, cfg.pool)).deposits.map((d) => ({ depositor: d.depositor, label: d.label }));
    },
    async publish(labels) {
      const root = numberToHex(rootOf(labels), { size: 32 });
      const nonce = Number(await rpc(cfg.rpc, "eth_getTransactionCount", [account.address, "pending"]));
      const block = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
      const raw = await account.signTransaction({ chainId: cfg.chainId, nonce, to: RECENT_ROOT, data: concat([ASP_SALT, root]), gas: 400_000n, gasPrice: BigInt(block.baseFeePerGas) * 3n + 1000n, type: "legacy" });
      const hash = await rpc<Hex>(cfg.rpc, "eth_sendRawTransaction", [raw]);
      let receipt: any = null;
      for (let i = 0; i < 90 && !receipt; i++) {
        receipt = await rpc(cfg.rpc, "eth_getTransactionReceipt", [hash]);
        if (!receipt) await new Promise((r) => setTimeout(r, 1000));
      }
      if (!receipt || receipt.status !== "0x1") throw new Error("publishing the approved set failed");
      await nonceSettled(cfg.rpc, hash);
      const slot = BigInt((await rpc(cfg.rpc, "eth_getBlockByNumber", [receipt.blockNumber, false])).slotNumber);
      // A root can't be referenced in the slot it was written.
      for (let i = 0; i < 60; i++) {
        const head = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
        if (BigInt(head.slotNumber) > slot) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return { sourceId: keccak256(concat([account.address, ASP_SALT])), slot, root };
    },
  };
}
