// Publishes this ASP's root to its ENS name, so clients can find it there and check it against the pool's chain.
//
// ENS is a directory, not part of approving anyone: the pool's chain already has the root by the time this runs. So a
// Sepolia outage must never delay or fail a join. Publishing runs in the background, one at a time, and if several
// roots arrive while one is in flight only the newest goes out.
import { createPublicClient, createWalletClient, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ensTransport, publishRootCall, type EnsConfig } from "@relayless/sdk/ens";

export interface RootRef {
  root: Hex;
  slot: bigint;
}

/** Writes a root. May throw; `directoryQueue` is what keeps that away from the join path. */
export type PublishRoot = (ref: RootRef) => Promise<void>;

export function directoryQueue(publish: PublishRoot, onError: (e: unknown) => void) {
  let inFlight = false;
  let next: RootRef | null = null;
  let idle: Promise<void> = Promise.resolve();

  async function drain() {
    while (next) {
      const ref = next;
      next = null;
      try {
        await publish(ref);
      } catch (e) {
        onError(e);
      }
    }
    inFlight = false;
  }

  return {
    /** Returns at once and never throws. */
    publish(ref: RootRef) {
      next = ref;
      if (!inFlight) {
        inFlight = true;
        idle = drain();
      }
    },
    /** For tests and shutdown. */
    settled: () => idle,
  };
}

const REGISTRY = parseAbi(["function getSubregistry(string label) view returns (address)", "function getResolver(string label) view returns (address)"]);
const ZERO: Address = "0x0000000000000000000000000000000000000000";

/**
 * Publishes as the ASP's operator, whose role covers only these records. The resolver is read fresh each time: writing
 * to one the name no longer uses would succeed and update records nobody reads.
 */
export function liveDirectory(cfg: EnsConfig, label: string, operatorKey: Hex): PublishRoot {
  const account = privateKeyToAccount(operatorKey);
  const pub = createPublicClient({ chain: sepolia, transport: ensTransport(cfg), ccipRead: false });
  const wallet = createWalletClient({ account, chain: sepolia, transport: ensTransport(cfg) });
  const name = `${label}.${cfg.names.directory}`;
  const sub = (address: Address, l: string) => pub.readContract({ address, abi: REGISTRY, functionName: "getSubregistry", args: [l] });

  return async ({ root, slot }) => {
    const [ensRoot, ensSlot] = await Promise.all([
      pub.getEnsText({ name, key: cfg.recordKeys.aspRoot, universalResolverAddress: cfg.contracts.universalResolver }).catch(() => null),
      pub.getEnsText({ name, key: cfg.recordKeys.aspSlot, universalResolverAddress: cfg.contracts.universalResolver }).catch(() => null),
    ]);
    if (ensRoot === root && ensSlot === slot.toString()) return;

    const r1 = await sub(cfg.contracts.ethRegistry, cfg.names.parentLabel);
    const r2 = await sub(r1, cfg.names.directoryLabel);
    const resolver = await pub.readContract({ address: r2, abi: REGISTRY, functionName: "getResolver", args: [label] });
    if (resolver === ZERO) throw new Error(`${name} has no resolver: has it expired?`);

    const hash = await wallet.sendTransaction({ to: resolver, data: publishRootCall(cfg, name, root, slot) });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
    if (receipt.status !== "success") throw new Error(`publishing to ${name} reverted: ${hash}`);
    console.log(`published root to ${name}: ${cfg.explorer}/tx/${hash}`);
  };
}
