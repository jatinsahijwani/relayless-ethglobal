import { useEffect, useState } from "react";
import { Button, Problem } from "../ui";
import { nymRequested, reloadWithNym, useNym } from "./nym";

const SLOW_AFTER_MS = 30_000;

/** Ticks while something is waiting, so "slow" appears without anything else changing. */
function useElapsed(since: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, now - since);
}

export function NymToggle() {
  const nym = useNym();
  const waitingSince = nym.state === "connecting" ? nym.since : nym.state === "ready" ? nym.waitingSince : null;
  const elapsed = useElapsed(waitingSince);
  const slow = elapsed > SLOW_AFTER_MS;
  return (
    <section aria-label="Network privacy" className="mb-6 rounded-lg border-2 border-line bg-paper p-3">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 font-bold">
        <input type="checkbox" className="h-5 w-5" checked={nymRequested} onChange={(e) => reloadWithNym(e.target.checked)} />
        Route through Nym mixnet
      </label>
      {nym.state === "off" && (
        <p className="text-slate">Off: the Sepolia RPC sees your IP and what you look up. Turning this on hides your IP from it. It reloads the page, downloads about 18 MB once, and is much slower. Reads made before you turn it on have already gone directly.</p>
      )}
      {nym.state === "connecting" && (
        <p role="status" className="text-slate">
          Connecting to the mixnet, usually under a minute. Nothing goes to Sepolia until it connects.{slow && " It's slower than usual. Still trying."}
        </p>
      )}
      {nym.state === "ready" && (
        <p role="status" className="border-l-4 border-pool pl-3 text-pool">
          Routed via Nym: {nym.requests} {nym.requests === 1 ? "request" : "requests"} so far{nym.lastMs !== null && `, last took ${(nym.lastMs / 1000).toFixed(1)} s`}.
          {slow && " This one is slow. Still waiting, and it won't go direct."}
        </p>
      )}
      {nym.state === "failed" && (
        <div>
          <Problem>The mixnet isn't answering, so these reads stopped. Nothing was sent directly. A new connection often uses a different exit and works.</Problem>
          <p className="mt-1 break-words text-sm text-slate">Details: {nym.reason}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => location.reload()}>Try a new connection</Button>
            <Button variant="quiet" onClick={() => reloadWithNym(false)}>Turn off Nym and connect directly</Button>
          </div>
        </div>
      )}
      {nym.state !== "off" && (
        <p className="mt-2 text-sm text-slate">
          Covers ENS reads only. Your network can see you use Nym, and the RPC still sees what you ask, but not who asked. A claim's transactions go through your wallet's own RPC. Anything on the local chain stays direct. To start routed next time, keep this page's address, which ends in <code>?nym=1</code>.
        </p>
      )}
    </section>
  );
}
