import { useEffect, useRef, useState } from "react";
import { isAddress, parseEther, type Address, type Hex } from "viem";
import type { Session } from "../App";
import { Button, Field, Problem, Screen, eth, inputClass, plainError } from "../ui";
import { addActivity, nextFreshIndex, walletBalance } from "../wallet";
import { named } from "../demo";
import { UnderTheHood } from "./UnderTheHood";
import { useProvingClock } from "./Hood";

type Stage = 0 | 1 | 2 | 3 | 4;
const STAGES = ["Proving this money is yours", "Sending to the mempool", "Waiting for a block", "Arrived"];

export function Pay({ s }: { s: Session }) {
  const [useNew, setUseNew] = useState(true);
  const [custom, setCustom] = useState("");
  const [fresh, setFresh] = useState<Address | null>(null);
  const [amount, setAmount] = useState("0.05");
  const [minAnon, setMinAnon] = useState(0);
  const [stage, setStage] = useState<Stage>(0);
  const [recipient, setRecipient] = useState<Address | null>(null);
  const [live, setLive] = useState<bigint | null>(null);
  const [hashes, setHashes] = useState<Hex[]>([]);
  const [error, setError] = useState("");
  const [hood, setHood] = useState(false);
  const before = useRef<bigint>(0n);
  const clock = useProvingClock();
  const proved = useRef(false);

  useEffect(() => {
    if (!fresh) setFresh(s.rl.freshAddress(Number(localStorage.getItem("relayless.freshIndex") ?? 0)));
  }, []);

  const chosen = useNew ? fresh : (isAddress(custom) ? (custom as Address) : null);
  const watched = recipient ?? chosen;

  // The recipient's real balance, read from the chain the whole time, before the payment as well as after.
  useEffect(() => {
    if (!watched) { setLive(null); return; }
    let on = true;
    const tick = async () => {
      const b = await walletBalance(watched).catch(() => null);
      if (on && b !== null) setLive(b);
      if (on) setTimeout(tick, 1200);
    };
    tick();
    return () => { on = false; };
  }, [watched]);

  // Stage 1 ends when the prover really finishes.
  useEffect(() => {
    if (stage === 1 && proved.current && !clock.proving) setStage(2);
    if (clock.proving) proved.current = true;
  }, [clock.proving, stage]);

  const unspent = s.notes.filter((n) => !n.spent);
  const leaves = Math.max(0, ...unspent.map((n) => n.leafIndex));
  let wei = 0n;
  try { wei = parseEther(amount || "0"); } catch { wei = 0n; }
  const available = unspent.reduce((t, n) => t + n.value, 0n);
  const target = useNew ? fresh : custom;
  const valid = wei > 0n && wei <= available && target && isAddress(target);
  const parts = wei > 0n && !unspent.some((n) => n.value >= wei) && wei <= available;

  const pay = async () => {
    const to = target as Address;
    setError(""); setHashes([]); setHood(false);
    before.current = await walletBalance(to);
    setLive(before.current);
    setRecipient(to);
    proved.current = false;
    setStage(1);
    try {
      const handles = await s.rl.pay({ to, amount: wei, minAnon });
      if (useNew) nextFreshIndex();
      handles.forEach((h) => addActivity({ hash: h.hash, to, amount: h.amount.toString(), fee: h.fee.toString(), at: Date.now(), fresh: useNew, proveMs: h.proveMs }));
      setHashes(handles.map((h) => h.hash));
      setStage(3);
      await Promise.all(handles.map((h) => h.wait()));
      setStage(4);
      setLive(await walletBalance(to));
      await s.refresh();
      if (useNew) setFresh(s.rl.freshAddress(Number(localStorage.getItem("relayless.freshIndex") ?? 0)));
    } catch (e) {
      setError(plainError(e));
      setRecipient(null);
      setStage(0);
    }
  };
  const busy = stage >= 1 && stage <= 3;

  return (
    <Screen title="Pay anyone">
      {unspent.length === 0 ? (
        <div>
          <p className="mb-4 max-w-md">You have no private money yet. Add some first, then you can pay from it.</p>
          <Button onClick={() => s.go("Add money")}>Add money</Button>
        </div>
      ) : !recipient ? (
        <div className="max-w-md">
          {chosen && (
            <div className="mb-5" data-testid="balance-before">
              <p className="text-slate">{useNew ? "The new wallet" : named(chosen, "Their wallet")} holds</p>
              <p className="tnum font-display text-5xl font-bold md:text-6xl">{live === null ? "…" : eth(live, 5)} <span className="text-2xl md:text-3xl">ETH</span></p>
            </div>
          )}
          <fieldset className="mb-4" disabled={busy}>
            <legend className="mb-1 font-bold">Pay to</legend>
            <label className="flex min-h-11 items-center gap-2"><input type="radio" checked={useNew} onChange={() => setUseNew(true)} /> A new wallet of mine, holding zero ETH</label>
            <label className="flex min-h-11 items-center gap-2"><input type="radio" checked={!useNew} onChange={() => setUseNew(false)} /> Someone's address</label>
          </fieldset>
          {!useNew && <Field label="Their address"><input className={inputClass} value={custom} onChange={(e) => setCustom(e.target.value.trim())} placeholder="0x…" disabled={busy} /></Field>}
          <Field label="Amount in ETH" hint={parts ? "No single note covers this, so it goes out as several payments, all at once." : `You have ${eth(available)} ETH. A little is held for gas, and what isn't used comes back.`}>
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
          </Field>
          <Field label={`Only spend money with at least ${minAnon} notes added after it`} hint="Enforced in the proof, and visible on-chain. Higher hides you better but may mean waiting. 0 turns it off.">
            <input type="range" className="w-full accent-pool" min={0} max={Math.max(32, leaves)} value={minAnon} onChange={(e) => setMinAnon(Number(e.target.value))} disabled={busy} />
          </Field>
          <Button className="w-full" disabled={!valid || busy} onClick={pay}>{busy ? "Paying…" : `Pay ${amount} ETH`}</Button>
          {error && <Problem>{error}</Problem>}
        </div>
      ) : null}

      {recipient && (
        <div>
          <p className="text-slate">{useNew ? named(recipient, "The new wallet") : named(recipient, "Their wallet")} holds</p>
          <p key={stage === 4 ? "done" : "wait"} data-testid="balance-live" className={`tnum rounded-lg font-display text-6xl font-bold md:text-8xl ${stage === 4 ? "arrived" : ""}`} aria-live="polite">{live === null ? "…" : eth(live, 5)} <span className="text-3xl md:text-5xl">ETH</span></p>
          <ol className="mt-4 space-y-1">
            {STAGES.map((label, i) => {
              const n = (i + 1) as Stage;
              const state = stage > n || stage === 4 ? "done" : stage === n ? "now" : "later";
              return (
                <li key={label} className={`flex items-center gap-2 ${state === "later" ? "text-slate" : ""} ${state === "now" ? "font-bold" : ""}`}>
                  <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-full ${state === "done" ? "bg-pool" : state === "now" ? "bg-flare" : "bg-line"}`} />
                  {n === 1 && state === "now" && clock.proving ? `Proving… ${clock.seconds} s` : n === 1 && state === "done" && clock.ms !== null ? `Proved in ${clock.seconds} s` : label}
                </li>
              );
            })}
          </ol>
          {stage === 4 && <p className="mt-3 max-w-md">Nobody funded this wallet, and no relayer was involved. The pool paid the gas out of your note, and sent back what it didn't use.</p>}
          {hashes.length > 0 && (
            <div className="mt-3">
              <Button variant="quiet" className="!px-0" onClick={() => setHood(!hood)} aria-expanded={hood}>Under the hood</Button>
              {hood && hashes.map((h) => <UnderTheHood key={h} hash={h} />)}
              {hood && <Button variant="quiet" className="!px-0" onClick={() => s.go("Under the hood")}>Compare mempools and see the live mempool</Button>}
            </div>
          )}
          {stage === 4 && <Button className="mt-5" onClick={() => { setRecipient(null); setStage(0); setHashes([]); setHood(false); }}>Make another payment</Button>}
        </div>
      )}
    </Screen>
  );
}
