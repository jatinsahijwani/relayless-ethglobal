import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { rpc } from "@relayless/sdk/chain";
import { cfg } from "../config";

const FRAMES = ["Check the proof and approve payment", "Pay the recipient and add the change note", "Refund the fee that gas didn't use"];

/** The technical view, for anyone who wants to check the claims. Everything here is read from the chain and the node. */
export function UnderTheHood({ hash }: { hash: Hex }) {
  const [receipt, setReceipt] = useState<any>(null);
  const [admission, setAdmission] = useState<any>(null);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const r = await rpc(cfg.rpc, "eth_getTransactionReceipt", [hash]).catch(() => null);
      if (!live) return;
      setReceipt(r);
      setAdmission(await rpc(cfg.mempool, "skandha_explorer_getTransaction", [hash]).catch(() => null));
      if (!r && live) setTimeout(tick, 2000);
    };
    tick();
    return () => { live = false; };
  }, [hash]);
  const checks: any[] = admission?.admission?.checks ?? admission?.checks ?? [];
  const passed = checks.filter((c) => c.verdict === "pass").length;
  return (
    <div className="mt-2 rounded-lg bg-paper p-4 text-sm">
      <p className="break-all"><strong>Transaction</strong> {hash}</p>
      {!receipt && <p className="mt-2 text-slate">Waiting for a block.</p>}
      {receipt && (
        <>
          <p className="tnum mt-2"><strong>Block</strong> {Number(receipt.blockNumber)}. <strong>Total gas</strong> {Number(receipt.gasUsed).toLocaleString()}. The pool paid; the recipient needed no ETH.</p>
          <h3 className="mb-1 mt-3 text-base font-bold">Frames</h3>
          <ol className="list-decimal space-y-1 pl-5">
            {(receipt.frameReceipts ?? []).map((f: any, i: number) => (
              <li key={i} className="tnum">{FRAMES[i] ?? `Frame ${i}`}: {f.status === "0x1" ? "succeeded" : "failed"}, {Number(f.gasUsed).toLocaleString()} gas{Number(f.stateGasUsed) > 0 ? ` plus ${Number(f.stateGasUsed).toLocaleString()} state gas` : ""}</li>
            ))}
          </ol>
        </>
      )}
      {checks.length > 0 && (
        <>
          <h3 className="mb-1 mt-3 text-base font-bold">Mempool admission</h3>
          <p className="tnum">{passed} of {checks.length} rule checks passed.</p>
          <p className="mt-1 break-words text-slate">{checks.map((c) => c.rule).join(", ")}</p>
        </>
      )}
    </div>
  );
}
