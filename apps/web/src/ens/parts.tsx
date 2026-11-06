import { useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import type { EnsConfig, NameAccess } from "@relayless/sdk/ens";
import { ensReader, nymReadError, nymRequested } from "./nym";
import { Button, Problem, plainError, short } from "../ui";

/** Shown wherever a step needs the pool. The static demo has no chain to send it to, and says so plainly. */
export const DevnetNotice = ({ what }: { what: string }) => (
  <p className="max-w-xl border-l-4 border-flare pl-3 text-slate"><strong className="text-ink">{what} runs on the local devnet; see video.</strong> The pool's transactions need an alt mempool that public networks don't have yet.</p>
);

export const Mono = ({ children }: { children: ReactNode }) => <code className="break-all font-mono text-sm">{children}</code>;

export const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid gap-x-3 border-t border-line py-1.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
    <dt className="text-sm text-slate">{label}</dt>
    <dd className="min-w-0">{children}</dd>
  </div>
);

export const AddressLink = ({ cfg, address }: { cfg: EnsConfig; address: Address }) => (
  <a className="underline decoration-line underline-offset-2 hover:decoration-ink" href={`${cfg.explorer}/address/${address}`} target="_blank" rel="noreferrer"><Mono>{short(address)}</Mono></a>
);

function RoleTable({ cfg, title, rows }: { cfg: EnsConfig; title: string; rows: NameAccess["resolverRoles"] }) {
  return (
    <div className="mt-3">
      <h4 className="font-bold">{title}</h4>
      {rows.length === 0 ? <p className="text-slate">Nobody holds a role here.</p> : (
        <ul>
          {rows.map((r) => (
            <li key={`${r.scope}:${r.account}`} className="border-t border-line py-1.5">
              <AddressLink cfg={cfg} address={r.account} /> <span className="text-sm text-slate">on {r.scope}</span>
              <div className="break-words font-mono text-xs text-slate">{r.roles.join(", ")}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Who can change a name, read live from its role events. */
export function Access({ cfg, name }: { cfg: EnsConfig; name: string }) {
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<NameAccess | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || access !== undefined) return;
    ensReader(cfg).nameAccess(name).then(setAccess).catch((e) => setError(nymRequested ? nymReadError : plainError(e)));
  }, [open]);
  return (
    <div className="mt-2">
      <Button variant="quiet" className="!min-h-10 !px-0" aria-expanded={open} onClick={() => setOpen(!open)}>Who can change this name</Button>
      {open && error && <Problem>{error}</Problem>}
      {open && !error && access === undefined && <p className="text-slate">Reading role events…</p>}
      {open && access === null && <p className="text-slate">This name has no resolver.</p>}
      {open && access && (
        <div>
          <p className="mt-1">Its registry is <strong>{access.emancipated ? "emancipated" : "not emancipated"}</strong>: {access.emancipated ? "no account holds a role at registry level that could override this name's owner." : "an account can override this name's owner."}</p>
          <RoleTable cfg={cfg} title="On the registry" rows={access.registryRoles} />
          <RoleTable cfg={cfg} title="On the resolver" rows={access.resolverRoles} />
        </div>
      )}
    </div>
  );
}
