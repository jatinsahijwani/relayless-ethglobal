import { useEffect, useRef, useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { MempoolComparison, WithdrawHandle } from "@relayless/sdk";
import { rpc } from "@relayless/sdk/chain";
import type { Session } from "../App";
import { cfg } from "../config";
import { demo, named } from "../demo";
import { Button, Problem, Screen, plainError } from "../ui";
import { watchProving } from "../wallet";

const num = (n: bigint | number | null) => (n === null ? "unknown" : Number(n).toLocaleString("en"));
/** The sidecar keeps resolved entries listed for a long time, so only recent ones are news. */
const RECENT_MS = 5 * 60 * 1000;
const someone = (): Address => privateKeyToAccount(generatePrivateKey()).address;

export function useProvingClock() {
  const [ms, setMs] = useState<number | null>(null);
  const [proving, setProving] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = watchProving((on) => {
      clearInterval(timer);
      setProving(on);
      if (on) {
        const start = performance.now();
        setMs(0);
        timer = setInterval(() => setMs(performance.now() - start), 100);
      }
    });
    return () => { stop(); clearInterval(timer); };
  }, []);
  return { ms, proving, seconds: ms === null ? "" : (ms / 1000).toFixed(1) };
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3 border-t border-line py-1.5"><dt className="text-slate">{k}</dt><dd className="tnum text-right font-bold">{children}</dd></div>;
}

export function CompareMempools({ s }: { s: Session }) {
  const [result, setResult] = useState<MempoolComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clock = useProvingClock();
  const run = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      setResult(await s.rl.compareMempools({ to: someone(), amount: parseEther("0.02") }));
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  const used = result?.alt.verifyGasUsed ?? null;
  const budget = result?.alt.budget ?? null;
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-2xl font-bold">Same withdrawal, two mempools</h2>
      <p className="mb-3 max-w-2xl">This proves one real withdrawal and asks both mempools about it. It's a dry run: nothing is sent, the note isn't spent, and the pool's reputation doesn't move.</p>
      <Button disabled={busy || s.notes.every((n) => n.spent)} onClick={run}>{busy ? (clock.proving ? `Proving… ${clock.seconds} s` : "Asking both…") : "Compare mempools"}</Button>
      {s.notes.every((n) => n.spent) && <p className="mt-2 text-sm text-slate">This needs a note of at least 0.02 ETH. Add money first.</p>}
      {error && <Problem>{error}</Problem>}
      {result && (
        <div className="mt-5 grid gap-4 md:grid-cols-2" data-testid="compare">
          <article className="rounded-lg border-2 border-alarm bg-paper p-4">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate">Canonical mempool (ethrex)</h3>
            <p className={`mt-1 font-display text-3xl font-bold ${result.canonical.admitted ? "text-pool" : "text-alarm"}`}>{result.canonical.admitted ? "Would admit" : "Rejected"}</p>
            {result.canonical.reason && <p className="mt-3 break-words rounded bg-fog p-2 font-mono text-sm">{result.canonical.reason}</p>}
            {!result.canonical.admitted && <p className="mt-3 text-sm">A flat cap on validation gas, whoever the sender is. A Groth16 check can't fit under it.</p>}
            <dl className="mt-3 text-sm"><Row k="Validation gas used">{num(result.canonical.verifyGasUsed)}</Row><Row k="Cap">100,000</Row></dl>
          </article>
          <article className="rounded-lg border-2 border-pool bg-paper p-4">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate">Alt mempool (sidecar)</h3>
            <p className={`mt-1 font-display text-3xl font-bold ${result.alt.admitted ? "text-pool" : "text-alarm"}`}>{result.alt.admitted ? "Would admit" : "Rejected"}</p>
            {result.alt.reason && <p className="mt-3 break-words rounded bg-fog p-2 font-mono text-sm">{result.alt.reason}</p>}
            <dl className="mt-3 text-sm">
              <Row k="Entity">{named(result.alt.entity, "The pool")} (payer)</Row>
              <Row k="Stake">{result.alt.stake === null ? "unknown" : `${formatEther(result.alt.stake)} ETH${result.alt.staked ? ", staked" : ", not enough"}`}</Row>
              <Row k="Reputation">{result.alt.reputation ? `${result.alt.reputation.status}: seen ${result.alt.reputation.seen}, included ${result.alt.reputation.included}` : "no history yet"}</Row>
              <Row k="Validation gas used">{num(used)}</Row>
              <Row k="Budget for this entity">{num(budget)}</Row>
            </dl>
            {used !== null && budget !== null && (
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-line" role="img" aria-label={`${num(used)} of ${num(budget)} gas budget`}>
                <div className="h-full bg-pool" style={{ width: `${Math.min(100, Number((used * 100n) / budget))}%` }} />
              </div>
            )}
          </article>
        </div>
      )}
      {result && <p className="mt-3 max-w-2xl text-sm text-slate">Both got the same bytes and the same proof. The sidecar's dry run overwrites the limits of every frame after VERIFY, and those limits are part of what the proof commits to, so this proof was made for them. The VERIFY frame being judged is the normal one. The budget shown is our patch's default for a staked entity.</p>}
    </section>
  );
}

interface Row { hash: string; nonceKey: string; status: string; firstSeen: number; block?: number }

export function LiveMempool({ s }: { s: Session }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [peak, setPeak] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const clock = useProvingClock();
  const known = useRef(new Map<string, Row>());
  const pool = s.rl.poolAddress.toLowerCase();

  useEffect(() => {
    let on = true;
    const tick = async () => {
      const list = await rpc(cfg.mempool, "skandha_explorer_listTransactions", [{ limit: 50 }]).catch(() => null);
      if (!on) return;
      if (list) {
        const pendingNow = new Set<string>();
        for (const t of list.items as any[]) {
          if (t.sender?.toLowerCase() !== pool) continue;
          const old = known.current.get(t.txHash);
          const recent = (t.submittedTime ?? t.lastUpdatedTime) > Date.now() - RECENT_MS;
          if (recent && /^(New|Pending|Submitted|OnChain)$/i.test(t.status)) pendingNow.add(t.txHash);
          if (!old && pendingNow.has(t.txHash)) known.current.set(t.txHash, { hash: t.txHash, nonceKey: t.nonceKeys?.[0] ?? "", status: t.status, firstSeen: Date.now() });
          else if (old && !old.block) old.status = t.status;
        }
        await Promise.all([...known.current.values()].filter((r) => !r.block).map(async (r) => {
          const receipt = await rpc(cfg.rpc, "eth_getTransactionReceipt", [r.hash]).catch(() => null);
          if (receipt) r.block = Number(receipt.blockNumber);
        }));
        const all = [...known.current.values()].sort((a, b) => b.firstSeen - a.firstSeen).slice(0, 8);
        const pending = all.filter((r) => !r.block).length;
        if (on) { setRows(all); setPeak((p) => Math.max(p, pending)); }
      }
      if (on) setTimeout(tick, 700);
    };
    tick();
    return () => { on = false; };
  }, [pool]);

  const payThree = async () => {
    setSending(true); setError(""); setPeak(0);
    try {
      const handles: WithdrawHandle[] = await s.rl.payMany([0, 1, 2].map(() => ({ to: someone(), amount: parseEther("0.01") })));
      await Promise.all(handles.map((h) => h.wait()));
      await s.refresh();
    } catch (e) {
      setError(plainError(e));
    } finally {
      setSending(false);
    }
  };
  const free = s.notes.filter((n) => !n.spent && n.value >= parseEther("0.01")).length;
  const pendingCount = rows.filter((r) => !r.block).length;

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-2xl font-bold">Live mempool</h2>
      <p className="mb-3 max-w-2xl">Pending withdrawals from the pool, read from the sidecar as they arrive. Every user shares one sender, and each has its own nullifier as its nonce key, so they don't wait for each other.</p>
      {demo && (
        <div className="mb-3">
          <Button disabled={sending || free < 3} onClick={payThree}>{sending ? (clock.proving ? `Proving… ${clock.seconds} s` : "Waiting for a block…") : "Pay 3 people at once"}</Button>
          {free < 3 && !sending && <p className="mt-2 text-sm text-slate">This needs 3 separate notes, and this wallet has {free}. Run <code>pnpm demo:reset</code>.</p>}
        </div>
      )}
      {error && <Problem>{error}</Problem>}
      <p className="tnum mb-2 font-bold" aria-live="polite" data-testid="pending-count">{pendingCount} pending now{peak > 1 ? `, ${peak} at once at the peak` : ""}</p>
      {rows.length === 0 ? (
        <p className="text-slate">Nothing in the last 5 minutes. Make a payment and it appears here.</p>
      ) : (
        <ul className="max-w-2xl space-y-1" data-testid="mempool-rows">
          {rows.map((r) => (
            <li key={r.hash} className="tnum flex flex-wrap items-center gap-x-3 rounded bg-paper px-3 py-2 text-sm">
              <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-full ${r.block ? "bg-pool" : "bg-flare"}`} />
              <span className="font-mono">nonce key {r.nonceKey.slice(0, 8)}…{r.nonceKey.slice(-4)}</span>
              <span className="ml-auto font-bold">{r.block ? `confirmed in block ${r.block}` : "pending"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Hood({ s }: { s: Session }) {
  return (
    <Screen title="Under the hood">
      <CompareMempools s={s} />
      <LiveMempool s={s} />
    </Screen>
  );
}
