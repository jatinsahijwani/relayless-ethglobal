import { useEffect, useState } from "react";
import { parseEther } from "viem";
import { TARGET_BITS, anonymity, fundingComparison, type AnonymityReport } from "@relayless/sdk";
import type { Session } from "../App";
import { Crowd, oneIn } from "../Crowd";
import { Field, Screen, inputClass } from "../ui";

// Every note the user has held, spent or not: the crowd shows deposits, and a spent deposit is still theirs to find.
const ownLeaves = (s: Session) => new Set(s.notes.map((n) => n.leafIndex));

/** The crowd plus the one sentence that matters. Kept beside every screen on desktop. */
export function MeterPanel({ s, report: given }: { s: Session; report?: AnonymityReport }) {
  const r = given ?? s.report;
  if (!r || r.setSize === 0) return <p className="text-slate">Nobody has added money to this pool yet. Your crowd appears here once they do.</p>;
  return (
    <div>
      <Crowd report={r} own={ownLeaves(s)} />
      <p className="mt-3 font-display text-2xl font-bold">You could be picked out of about {oneIn(r)}.</p>
      <p className="mt-1 text-sm text-slate">Each dot is a deposit, sized by how suspicious it looks from outside. Yours are marigold. Even dots are good.</p>
    </div>
  );
}

export function Meter({ s }: { s: Session }) {
  const [amount, setAmount] = useState("0.05");
  const [report, setReport] = useState<AnonymityReport | null>(null);
  useEffect(() => {
    let live = true;
    s.rl.sync().then((state) => {
      if (!live) return;
      let wei: bigint | undefined;
      try { wei = amount ? parseEther(amount) : undefined; } catch { wei = undefined; }
      const note = s.notes.find((n) => !n.spent && wei !== undefined && n.value >= wei);
      setReport(anonymity({ state, amount: wei, own: note ? { depositor: note.depositor, leafIndex: note.leafIndex } : undefined }));
    }).catch(() => {});
    return () => { live = false; };
  }, [amount, s.notes]);
  const compare = report && fundingComparison(report);
  return (
    <Screen title="How hidden would you be?">
      <div className="max-w-xs"><Field label="If you paid this much, in ETH"><input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>
      {report && (
        <>
          <div className="max-w-2xl"><MeterPanel s={s} report={report} /></div>
          <div className="mt-4 h-3 max-w-md overflow-hidden rounded-full bg-line" role="img" aria-label={`${report.minEntropyBits.toFixed(1)} of ${TARGET_BITS} bits`}>
            <div className="h-full bg-pool" style={{ width: `${Math.min(100, (report.minEntropyBits / TARGET_BITS) * 100)}%` }} />
          </div>
          <p className="tnum mt-1 text-sm text-slate">{report.minEntropyBits.toFixed(2)} bits against the most suspicious deposit, and {TARGET_BITS} is the goal. {report.shannonBits.toFixed(2)} bits overall, across {report.setSize} possible deposits.</p>
          <h2 className="mb-2 mt-7 text-2xl font-bold">What would help</h2>
          <ul className="max-w-lg list-disc space-y-1 pl-5">{report.advice.map((a) => <li key={a}>{a}</li>)}</ul>
          {compare && (
            <>
              <h2 className="mb-2 mt-7 text-2xl font-bold">Compared with the other ways</h2>
              <div className="overflow-x-auto">
                <table className="w-full max-w-xl text-left">
                  <thead className="text-slate"><tr><th className="py-1 pr-3 font-normal">How the new wallet gets gas</th><th className="tnum py-1 pr-3 font-normal">Bits</th><th className="py-1 font-normal">What it costs you</th></tr></thead>
                  <tbody className="align-top">
                    <tr className="border-t border-line"><td className="py-2 pr-3 font-bold">You fund it</td><td className="tnum py-2 pr-3">{compare.selfFunded.minEntropyBits.toFixed(2)}</td><td className="py-2">{compare.selfFunded.note}</td></tr>
                    <tr className="border-t border-line"><td className="py-2 pr-3 font-bold">A relayer pays</td><td className="tnum py-2 pr-3">{compare.relayer.minEntropyBits.toFixed(2)}</td><td className="py-2">{compare.relayer.note}</td></tr>
                    <tr className="border-t border-line"><td className="py-2 pr-3 font-bold">Relayless</td><td className="tnum py-2 pr-3">{compare.relayless.minEntropyBits.toFixed(2)}</td><td className="py-2">{compare.relayless.note}</td></tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="mt-5 max-w-lg text-sm text-slate">This is a model built only from public data, not a guarantee. It reads every deposit in the pool rather than only yours, so the check doesn't reveal which ones are yours. The node you connect to still sees your IP address.</p>
        </>
      )}
    </Screen>
  );
}
