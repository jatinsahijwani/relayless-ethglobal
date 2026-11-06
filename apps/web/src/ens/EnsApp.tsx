import { useState } from "react";
import { Directory } from "./Directory";
import { Names } from "./Names";
import { ens } from "./config";
import { NymToggle } from "./NymToggle";
import { nymRequested } from "./nym";

const TABS = ["ASP directory", "Private names"] as const;

/** The public static demo: everything that works on Sepolia alone, with no local chain and no server of ours. */
export function EnsApp() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("ASP directory");
  if (!ens) return <main className="p-6">The directory isn't deployed yet.</main>;
  return (
    <div className="mx-auto min-h-full max-w-3xl px-4 pb-16 pt-5">
      <header className="mb-6">
        <span className="font-display text-xl font-bold">Relayless</span>
        <span className="ml-2 text-slate">on ENSv2, Sepolia</span>
        <a href="/findings" className="ml-3 text-slate underline underline-offset-4">Findings</a>
        <p className="mt-2 max-w-2xl text-slate">ENS as the directory of a privacy pool. This page reads Sepolia {nymRequested ? "through the mixnet" : "directly"} from your browser. The pool itself runs on a local devnet.</p>
      </header>
      <NymToggle />
      <nav aria-label="Main" className="mb-7 flex gap-1">
        {TABS.map((t) => <button key={t} onClick={() => setTab(t)} aria-current={t === tab ? "page" : undefined} className={`min-h-11 rounded-lg px-4 font-bold ${t === tab ? "bg-ink text-paper" : "text-slate hover:text-ink"}`}>{t}</button>)}
      </nav>
      {tab === "ASP directory" ? <Directory cfg={ens.cfg} devnetRpc={null} chainId={null} /> : <Names cfg={ens.cfg} />}
    </div>
  );
}
