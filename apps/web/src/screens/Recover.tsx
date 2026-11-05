import { useState } from "react";
import { formatEther } from "viem";
import type { Note } from "@relayless/sdk";
import type { Session } from "../App";
import { Button, Problem, Screen, plainError } from "../ui";
import { waitMined } from "../wallet";

const ethText = (w: bigint) => Number(formatEther(w)).toLocaleString("en", { maximumFractionDigits: 6 });

export function Recover({ s }: { s: Session }) {
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Note[] | null>(null);
  const [error, setError] = useState("");
  const [exitMsg, setExitMsg] = useState("");
  const scan = async () => {
    setBusy(true); setError("");
    try {
      const n = await s.rl.notes();
      setFound(n);
      await s.refresh();
    } catch (e) { setError(plainError(e)); } finally { setBusy(false); }
  };
  const exit = async (note: Note) => {
    setBusy(true); setError(""); setExitMsg("");
    try {
      const h = await s.rl.ragequit(note);
      await waitMined(h.hash);
      setExitMsg(`Sent ${ethText(note.value)} ETH, minus gas, back to ${note.depositor}. This exit is public.`);
      setFound(await s.rl.notes());
      await s.refresh();
    } catch (e) { setError(plainError(e)); } finally { setBusy(false); }
  };
  const unspent = found?.filter((n) => !n.spent) ?? [];
  return (
    <Screen title="Recover your money">
      <p className="mb-5 max-w-md">Lost this device or cleared your browser? Connect the same wallet on any device. Its signature rebuilds everything from the chain, so there's no backup file.</p>
      <Button disabled={busy} onClick={scan}>{busy ? "Reading the chain…" : "Find my money"}</Button>
      {error && <Problem>{error}</Problem>}
      {exitMsg && <p role="status" className="mt-4 border-l-4 border-pool pl-3">{exitMsg}</p>}
      {found && found.length === 0 && <p className="mt-5">No notes found for this wallet. Make sure it's the wallet you added money from.</p>}
      {found && found.length > 0 && (
        <>
          <p className="tnum mt-6 font-display text-2xl font-bold">Found {ethText(unspent.reduce((t, n) => t + n.value, 0n))} ETH in {unspent.length} {unspent.length === 1 ? "note" : "notes"}.</p>
          <ul className="mt-3">
            {found.map((n) => (
              <li key={n.leafIndex} className="tnum flex flex-wrap items-center justify-between gap-2 border-t border-line py-2">
                <span className={n.spent ? "text-slate" : ""}>{ethText(n.value)} ETH{n.spent ? ", already spent" : ""}</span>
                {!n.spent && <Button variant="quiet" className="!min-h-10 !px-0" disabled={busy} onClick={() => exit(n)}>Exit publicly to {n.depositor.slice(0, 6)}…</Button>}
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-md text-sm text-slate">A public exit sends a note back to the wallet that added it. It gives up privacy for that note, and works even if you're refused elsewhere.</p>
        </>
      )}
    </Screen>
  );
}
