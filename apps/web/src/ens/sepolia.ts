// A browser wallet on Sepolia, for the only ENS step that writes: claiming a name.
import type { Address, Hex } from "viem";
import { createEnsReader, type EnsConfig, type EnsSender } from "@relayless/sdk/ens";
import { stealthKeysFromSignature, stealthTypedData, type StealthKeys } from "@relayless/sdk/stealth";

export async function sepoliaWallet(cfg: EnsConfig): Promise<{ sender: EnsSender; keys(): Promise<StealthKeys> }> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("Claiming needs a browser wallet with a little Sepolia ETH. Everything else here works without one.");
  const [address] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  const chainId = `0x${cfg.chainId.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch {
    await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: "Sepolia", rpcUrls: [cfg.rpc], nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [cfg.explorer] }] });
  }
  const { client } = createEnsReader(cfg);
  return {
    sender: {
      address,
      async send(to, data) {
        const hash: Hex = await eth.request({ method: "eth_sendTransaction", params: [{ from: address, to, data }] });
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 240_000 });
        if (receipt.status !== "success") throw new Error(`That transaction failed: ${cfg.explorer}/tx/${hash}`);
        return receipt;
      },
    },
    async keys() {
      const typed = stealthTypedData();
      const signature: Hex = await eth.request({
        method: "eth_signTypedData_v4",
        params: [address, JSON.stringify({ ...typed, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }], ...typed.types } })],
      });
      return stealthKeysFromSignature(signature);
    },
  };
}
