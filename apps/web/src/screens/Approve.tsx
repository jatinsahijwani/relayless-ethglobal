import { useEffect, useRef, useState, type ComponentType } from "react";
import type { Session } from "../App";
import { Button, Problem, Screen, plainError } from "../ui";
import { cfg } from "../config";

interface AspConfig { allowlist?: boolean; enabled: boolean; app_id: `app_${string}` | null; action: string; environment: "production" | "staging" }

/** Why a verification didn't complete, and what to do. Every path ends somewhere: nobody is stuck. */
export function worldErrorMessage(code: string): string {
  switch (code) {
    case "user_rejected":
    case "cancelled":
      return "You cancelled, so nothing was shared and nothing changed. You can try again whenever you like.";
    case "credential_unavailable":
    case "world_id_3_not_available":
    case "world_id_4_not_available":
      return "This needs a World ID verified at an Orb, and this account doesn't have one. You can still get your money back with a public exit.";
    case "max_verifications_reached":
    case "nullifier_replayed":
      return "This World ID has already been used to approve an address. You can still get your money back with a public exit.";
    case "timeout":
    case "connection_failed":
      return "World App didn't respond in time. Nothing changed. Try again.";
    case "verification_rejected":
      return "You declined in World App, so nothing changed.";
    default:
      return `World ID couldn't complete this (${code}). Nothing changed. Try again, or use a public exit.`;
  }
}

export function Approve({ s }: { s: Session }) {
  const [config, setConfig] = useState<AspConfig | null>(null);
  const [approved, setApproved] = useState(false);
  const [rpContext, setRpContext] = useState<any>(null);
  const [widget, setWidget] = useState<{ Widget: ComponentType<any>; preset: any } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Whether this attempt has already ended in an answer, so closing the window afterward says nothing more.
  const settled = useRef(false);

  const closed = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen && !settled.current) {
      settled.current = true;
      setError(worldErrorMessage("cancelled"));
    }
  };

  const checkApproved = async () => {
    const res = await fetch(`${cfg.aspUrl}/set`);
    if (!res.ok) return;
    const { labels } = (await res.json()) as { labels: string[] };
    const mine = s.notes.filter((n) => !n.spent);
    setApproved(mine.length > 0 && mine.every((n) => labels.includes(n.label.toString())));
  };

  useEffect(() => {
    fetch(`${cfg.aspUrl}/config`).then((r) => r.json()).then(setConfig).catch(() => setError("The approval server isn't reachable right now. You can still use a public exit."));
    checkApproved().catch(() => {});
  }, [s.notes]);

  const begin = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`${cfg.aspUrl}/rp-context`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).message);
      setRpContext(await res.json());
      // Loaded only here, so nothing talks to World until the user asks.
      const idkit = await import("@worldcoin/idkit");
      setWidget({ Widget: idkit.IDKitRequestWidget as ComponentType<any>, preset: idkit.orbLegacy({ signal: s.signer.address }) });
      settled.current = false;
      setOpen(true);
    } catch (e) { setError(plainError(e)); } finally { setBusy(false); }
  };

  // Runs before success is shown. The server's answer decides, never the browser's.
  const verifyOnServer = async (result: unknown) => {
    if (!s.signer.signMessage) throw new Error("This wallet can't sign messages.");
    const message = `Join the Relayless approved set for pool ${cfg.pool.toLowerCase()} as ${s.signer.address.toLowerCase()}`;
    const signature = await s.signer.signMessage(message);
    const res = await fetch(`${cfg.aspUrl}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ depositor: s.signer.address, signature, result }) });
    settled.current = true;
    if (!res.ok) {
      const message = (await res.json()).message as string;
      setError(message);
      throw new Error(message);
    }
  };

  return (
    <Screen title="Get approved">
      <p className="mb-3 max-w-md">This pool only lets approved money leave privately. Show you're one real person, and every deposit from this wallet is approved.</p>
      <p className="mb-5 max-w-md text-slate">World ID proves that without sharing your name or documents. We keep a private code that stops one person approving many wallets, linked to this wallet, which is already public because it added money.</p>

      {approved ? (
        <p role="status" className="border-l-4 border-pool pl-3">You're approved. You can pay privately now.</p>
      ) : config?.allowlist ? (
        <p className="max-w-md border-l-4 border-line pl-3">On this pool the ASP's operator approves deposits directly. World ID isn't used here.</p>
      ) : config?.enabled ? (
        <Button disabled={busy} onClick={begin}>{busy ? "Opening…" : "Verify with World ID"}</Button>
      ) : (
        config && <p className="max-w-md border-l-4 border-line pl-3">World ID isn't set up on this pool yet, so nobody can be approved right now.</p>
      )}
      {error && <Problem>{error}</Problem>}

      <h2 className="mb-2 mt-8 text-2xl font-bold">If you can't or won't verify</h2>
      <p className="mb-2 max-w-md">Your money isn't stuck. A public exit sends it back to the wallet that added it. Everyone can see that exit, but nobody can block it.</p>
      <Button variant="quiet" className="!px-0" onClick={() => s.go("Recover")}>Go to public exit</Button>

      {widget && config?.app_id && rpContext && (
        <widget.Widget
          open={open}
          onOpenChange={closed}
          app_id={config.app_id}
          action={config.action}
          rp_context={rpContext}
          allow_legacy_proofs
          preset={widget.preset}
          environment={config.environment}
          handleVerify={verifyOnServer}
          onSuccess={() => { setApproved(true); s.refresh().catch(() => {}); }}
          onError={(code: string) => {
            settled.current = true;
            setError((current) => current || worldErrorMessage(code));
          }}
        />
      )}
    </Screen>
  );
}
