import { useCallback, useEffect, useState } from "react";
import { anonymity, type AnonymityReport, type Note, type Relayless, type Signer } from "@relayless/sdk";
import { Connect } from "./screens/Connect";
import { Pay } from "./screens/Pay";
import { Deposit } from "./screens/Deposit";
import { Meter, MeterPanel } from "./screens/Meter";
import { Activity } from "./screens/Activity";
import { Recover } from "./screens/Recover";
import { Approve } from "./screens/Approve";
import { cfg } from "./config";
import { eth } from "./ui";

const TABS = ["Pay", "Add money", "Privacy", "Activity", "Recover", "Get approved"] as const;
export type Tab = (typeof TABS)[number];

export interface Session {
  rl: Relayless;
  signer: Signer;
  notes: Note[];
  report: AnonymityReport | null;
  refresh(): Promise<void>;
  go(tab: Tab): void;
}

export function App() {
  const [conn, setConn] = useState<{ rl: Relayless; signer: Signer } | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [report, setReport] = useState<AnonymityReport | null>(null);
  const [tab, setTab] = useState<Tab>("Pay");

  const refresh = useCallback(async () => {
    if (!conn) return;
    const n = await conn.rl.notes();
    setNotes(n);
    setReport(anonymity({ state: await conn.rl.sync() }));
  }, [conn]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  if (!conn) return <Connect onConnected={setConn} />;
  const session: Session = { ...conn, notes, report, refresh, go: setTab };
  const balance = notes.filter((n) => !n.spent).reduce((s, n) => s + n.value, 0n);

  return (
    <div className="mx-auto min-h-full max-w-5xl px-4 pb-24 pt-5 md:pb-10">
      <header className="mb-7 flex items-baseline justify-between">
        <span className="font-display text-xl font-bold">Relayless</span>
        <span className="tnum text-slate">Private balance <strong className="text-ink">{eth(balance)} ETH</strong></span>
      </header>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 flex border-t-2 border-line bg-paper md:static md:mb-8 md:gap-1 md:border-none md:bg-transparent">
        {TABS.filter((t) => t !== "Get approved" || cfg.aspUrl).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-current={t === tab ? "page" : undefined} className={`min-h-14 flex-1 px-1 text-sm font-bold md:min-h-10 md:flex-none md:rounded-lg md:px-4 md:text-base ${t === tab ? "bg-ink text-paper" : "text-slate hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </nav>
      <div className={`grid gap-10 ${tab === "Privacy" ? "" : "md:grid-cols-[minmax(0,1fr)_320px]"}`}>
        <main>
          {tab === "Pay" && <Pay s={session} />}
          {tab === "Add money" && <Deposit s={session} />}
          {tab === "Privacy" && <Meter s={session} />}
          {tab === "Activity" && <Activity s={session} />}
          {tab === "Recover" && <Recover s={session} />}
          {tab === "Get approved" && <Approve s={session} />}
        </main>
        {tab !== "Privacy" && <aside className="hidden md:block"><MeterPanel s={session} /></aside>}
      </div>
    </div>
  );
}
