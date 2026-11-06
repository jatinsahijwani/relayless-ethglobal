import { useEffect, useState } from "react";
import { crossCheckRoot, type AspEntry, type EnsConfig, type RootCheck } from "@relayless/sdk/ens";
import { Button, Problem, Screen, plainError } from "../ui";
import { Access, AddressLink, DevnetNotice, Mono, Row } from "./parts";
import { ensReader, nymReadError, nymRequested } from "./nym";

const VERDICT: Record<RootCheck["status"], { good: boolean; text: string }> = {
  verified: { good: true, text: "Checked. The pool's chain holds this exact root from this operator, and the pool takes roots only from that operator." },
  mismatch: { good: false, text: "Warning: the pool's chain doesn't hold this root. Don't rely on this entry." },
  "wrong-operator": { good: false, text: "Warning: this pool doesn't take roots from this operator, so this name isn't its ASP. The name may have changed hands." },
  "expired-slot": { good: false, text: "Can't confirm: this root is too old for the chain to prove. The ASP should publish again soon." },
  stale: { good: false, text: "Slightly behind: the ASP has already moved to a newer root, and ENS hasn't caught up. Try again in a minute." },
  "no-root": { good: false, text: "This ASP hasn't published a root yet." },
  "devnet-unreachable": { good: false, text: "Not checked: the pool's chain can't be reached from here. Treat this entry as unverified." },
};

async function serverRoot(endpoint: string | null) {
  if (!endpoint) return null;
  try {
    const r = await fetch(`${endpoint}/set`);
    return r.ok ? (await r.json()).ref?.root ?? null : null;
  } catch {
    return null;
  }
}

function Entry({ cfg, asp, devnetRpc, chainId, onUse }: { cfg: EnsConfig; asp: AspEntry; devnetRpc: string | null; chainId: number | null; onUse?: (a: AspEntry, check: RootCheck) => void }) {
  const [check, setCheck] = useState<RootCheck | null>(null);
  const onThisChain = devnetRpc !== null && (asp.chainId === null || asp.chainId === chainId);
  useEffect(() => {
    if (!onThisChain) return;
    (async () => crossCheckRoot(asp, { rpc: devnetRpc!, saltPreimage: cfg.aspSaltPreimage, serverRoot: await serverRoot(asp.endpoint) }))().then(setCheck).catch(() => setCheck({ status: "devnet-unreachable" }));
  }, [asp.root, asp.slot, devnetRpc]);
  const verdict = check && VERDICT[check.status];
  return (
    <li className="rounded-lg border-2 border-line bg-paper p-4">
      <h2 className="break-all text-2xl font-bold">{asp.name}</h2>
      <p className="mb-2 mt-1">{asp.policy ?? "No policy published."}</p>
      <dl>
        <Row label="Root"><Mono>{asp.root ?? "none yet"}</Mono></Row>
        <Row label="At slot"><Mono>{asp.slot?.toString() ?? "none yet"}</Mono></Row>
        <Row label="Pool">{asp.pool ? <Mono>{asp.pool}</Mono> : "not set"}{asp.chainId !== null && <span className="text-sm text-slate"> on chain {asp.chainId}</span>}</Row>
        <Row label="Operator">{asp.operator ? <AddressLink cfg={cfg} address={asp.operator} /> : "not set"}</Row>
        <Row label="Resolver"><AddressLink cfg={cfg} address={asp.resolver} /></Row>
        <Row label="Approval service">{asp.endpoint ? <Mono>{asp.endpoint}</Mono> : "none listed"}</Row>
        <Row label="Listed until">{new Date(Number(asp.expiry) * 1000).toLocaleDateString("en", { dateStyle: "medium" })}</Row>
      </dl>
      <div className="mt-3" aria-live="polite">
        {!onThisChain ? <DevnetNotice what="Checking this root against the pool" />
          : !verdict ? <p className="text-slate">Checking against the pool's chain…</p>
          : <p role={verdict.good ? undefined : "alert"} className={`border-l-4 pl-3 ${verdict.good ? "border-pool text-pool" : "border-alarm text-alarm"}`}>{verdict.text}</p>}
      </div>
      {onUse && check && asp.pool && <Button className="mt-3" variant={verdict?.good ? "primary" : "quiet"} onClick={() => onUse(asp, check)}>{verdict?.good ? "Use this ASP" : "Use it anyway"}</Button>}
      <Access cfg={cfg} name={asp.name} />
    </li>
  );
}

export function Directory({ cfg, devnetRpc, chainId, onUse }: { cfg: EnsConfig; devnetRpc: string | null; chainId: number | null; onUse?: (a: AspEntry, check: RootCheck) => void }) {
  const [asps, setAsps] = useState<AspEntry[] | null>(null);
  const [error, setError] = useState("");
  const load = () => {
    setError("");
    setAsps(null);
    ensReader(cfg).listAsps().then(setAsps).catch((e) => setError(nymRequested ? nymReadError : plainError(e)));
  };
  useEffect(load, []);
  return (
    <Screen title="Who approves deposits">
      <p className="mb-5 max-w-2xl">Association-set providers decide which deposits can withdraw privately. Each one here is a name under <strong className="break-all">{cfg.names.directory}</strong>, listed from that registry's own events. The app keeps no list.</p>
      {error && (<><Problem>{error}</Problem><Button className="mt-3" onClick={load}>Try again</Button></>)}
      {!error && asps === null && <p className="text-slate">Reading the directory from Sepolia…</p>}
      {asps?.length === 0 && <p>No ASPs are listed yet.</p>}
      {asps && asps.length > 0 && <ul className="grid gap-4">{asps.map((a) => <Entry key={a.name} cfg={cfg} asp={a} devnetRpc={devnetRpc} chainId={chainId} onUse={onUse} />)}</ul>}
    </Screen>
  );
}
