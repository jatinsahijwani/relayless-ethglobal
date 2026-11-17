import { useEffect, useState } from "react";
import type { ApprovalStatus } from "@relayless/sdk";
import type { Session } from "../App";
import { Button, Problem, Screen, eth } from "../ui";
import { cfg } from "../config";
import { associationSet } from "../wallet";

interface AspConfig { policy: string; operator?: string }

const STATUS_TEXT: Record<ApprovalStatus, string> = {
  approved: "Approved: can leave privately",
  pending: "Waiting for review",
  declined: "Declined: public exit only",
  unknown: "Not approved yet",
};

/** Works with any association set provider: it only asks for each note's status. */
export function Approve({ s }: { s: Session }) {
  const [config, setConfig] = useState<AspConfig | null>(null);
  const [statuses, setStatuses] = useState<Map<string, ApprovalStatus> | null>(null);
  const [error, setError] = useState("");
  const unspent = s.notes.filter((n) => !n.spent);

  useEffect(() => {
    const provider = associationSet();
    if (!provider) return;
    // The reference server describes its policy. Another provider may not, and the statuses below still work.
    fetch(`${cfg.aspUrl}/config`).then((r) => (r.ok ? r.json() : null)).then(setConfig).catch(() => {});
    Promise.all(unspent.map(async (n) => [n.label.toString(), await provider.status(n.label)] as const))
      .then((pairs) => setStatuses(new Map(pairs)))
      .catch(() => setError("The approval server isn't reachable right now. You can still use a public exit."));
  }, [s.notes]);

  const approvedAll = statuses !== null && unspent.length > 0 && unspent.every((n) => statuses.get(n.label.toString()) === "approved");

  return (
    <Screen title="Get approved">
      <p className="mb-3 max-w-md">This pool only lets approved money leave privately. An approver, called an association set provider, decides which deposits are approved, and publishes that set on the chain.</p>
      {config?.policy === "allowlist" && (
        <p className="mb-5 max-w-md text-slate">On this pool the approver's operator approves wallets directly. Every deposit from an approved wallet is approved. Yours is <code className="break-all text-sm">{s.signer.address}</code>.</p>
      )}

      {approvedAll && <p role="status" className="mb-4 border-l-4 border-pool pl-3">You're approved. You can pay privately now.</p>}
      {statuses && unspent.length > 0 && (
        <ul className="mb-4 max-w-md divide-y divide-line">
          {unspent.map((n) => (
            <li key={n.nullifierHash.toString()} className="tnum flex justify-between py-2">
              <span>{eth(n.value)} ETH</span>
              <span className={statuses.get(n.label.toString()) === "approved" ? "text-pool" : "text-slate"}>{STATUS_TEXT[statuses.get(n.label.toString()) ?? "unknown"]}</span>
            </li>
          ))}
        </ul>
      )}
      {unspent.length === 0 && <p className="mb-4 max-w-md text-slate">You have no money in the pool yet.</p>}
      {error && <Problem>{error}</Problem>}

      <h2 className="mb-2 mt-8 text-2xl font-bold">If you aren't approved</h2>
      <p className="mb-2 max-w-md">Your money isn't stuck. A public exit sends it back to the wallet that added it. Everyone can see that exit, but nobody, the approver included, can block it.</p>
      <Button variant="quiet" className="!px-0" onClick={() => s.go("Recover")}>Go to public exit</Button>
    </Screen>
  );
}
