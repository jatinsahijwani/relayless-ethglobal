import { useEffect, useState } from "react";
import { formatEther } from "viem";
import type { Session } from "../App";
import { Button, Screen, short } from "../ui";
import { readActivity, type ActivityEntry } from "../wallet";
import { UnderTheHood } from "./UnderTheHood";
import { cfg } from "../config";

export function Activity({ s }: { s: Session }) {
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setItems(readActivity()), []);
  if (items.length === 0)
    return (
      <Screen title="Activity">
        <p className="mb-4">Your payments will show up here. This list stays in this browser.</p>
        <Button onClick={() => s.go("Pay")}>Make a payment</Button>
      </Screen>
    );
  return (
    <Screen title="Activity">
      <ul>
        {items.map((a) => (
          <li key={a.hash} className="border-t border-line py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="tnum"><strong>{Number(formatEther(BigInt(a.amount))).toLocaleString("en", { maximumFractionDigits: 4 })} ETH</strong> to {short(a.to)}{a.fresh && " (new wallet)"}</span>
              <span className="text-sm text-slate">{new Date(a.at).toLocaleString()}</span>
            </div>
            <div className="flex flex-wrap gap-x-4">
              <Button variant="quiet" className="!px-0" onClick={() => setOpen(open === a.hash ? null : a.hash)} aria-expanded={open === a.hash}>Under the hood</Button>
              {cfg.explorer && <a className="flex min-h-12 items-center underline underline-offset-4" href={cfg.explorer} target="_blank" rel="noreferrer noopener">Look it up on the explorer</a>}
            </div>
            {open === a.hash && <UnderTheHood hash={a.hash} />}
          </li>
        ))}
      </ul>
    </Screen>
  );
}
