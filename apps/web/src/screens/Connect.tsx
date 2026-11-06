import { useState } from "react";
import type { Relayless, Signer } from "@relayless/sdk";
import { Button, Problem, plainError } from "../ui";
import { browserSigner, connectPool, demoSigner, hasBrowserWallet, testSigner } from "../wallet";
import { demo } from "../demo";
import { LiveQr } from "../Findings";
import { cfg } from "../config";

// A static crowd for the first screen: the idea before any data exists. Uniform on purpose, with one marked dot.
const CROWD = Array.from({ length: 84 }, (_, i) => i);

export function Connect({ onConnected }: { onConnected(c: { rl: Relayless; signer: Signer }): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async (make: () => Signer | Promise<Signer>) => {
    setBusy(true);
    setError("");
    try {
      const signer = await make();
      const rl = await connectPool(signer);
      await rl.unlock();
      onConnected({ rl, signer });
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto grid min-h-full max-w-5xl items-center gap-10 px-4 py-6 md:grid-cols-2">
      <div>
        <h1 className="text-5xl font-bold md:text-6xl">Pay from a wallet with no history.</h1>
        <p className="mt-4 max-w-md text-lg">Put money in. Later, send it anywhere, even to a brand-new wallet holding zero ETH. Nobody funds that wallet, and no relayer sees you.</p>
        <p className="mt-3 max-w-md text-slate">Your wallet signs once. That signature is your only backup, so there's nothing new to write down.</p>
        <div className="mt-5 flex flex-col items-start gap-1">
          {demo && <Button disabled={busy} onClick={() => start(demoSigner)}>{busy ? "Connecting…" : "Use the demo wallet"}</Button>}
          {!demo && hasBrowserWallet() && <Button disabled={busy} onClick={() => start(browserSigner)}>Connect wallet</Button>}
          <Button variant={demo || hasBrowserWallet() ? "quiet" : "primary"} disabled={busy} onClick={() => start(testSigner)}>{busy ? "Connecting…" : "Use a test wallet"}</Button>
        </div>
        {error && <Problem>{error}</Problem>}
        <p className="mt-3 text-sm text-slate">Test network only ({cfg.name}). Don't use real funds. <a href={demo ? "/findings?demo=1" : "/findings"} className="underline underline-offset-4">What we found building this</a></p>
        <LiveQr className="mt-3" />
      </div>
      <svg viewBox="0 0 280 240" className="w-full" aria-hidden="true">
        {CROWD.map((i) => (
          <circle key={i} className="dot" style={{ animationDelay: `${(i % 12) * 40 + Math.floor(i / 12) * 60}ms` }} cx={(i % 12) * 23 + 13} cy={Math.floor(i / 12) * 33 + 22} r={8} fill={i === 40 ? "#F0A202" : "#0B6B70"} fillOpacity={i === 40 ? 1 : 0.75} stroke={i === 40 ? "#16233A" : "none"} strokeWidth={1.5} />
        ))}
      </svg>
    </main>
  );
}
