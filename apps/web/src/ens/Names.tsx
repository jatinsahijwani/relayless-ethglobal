import { useState } from "react";
import { BaseError, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { claimReceiveName, type EnsConfig } from "@relayless/sdk/ens";
import { deriveStealthPayment, isMetaAddress, metaAddressOf, scanAnnouncements, stealthKeysFromSignature, stealthTypedData, type ReceivedPayment, type StealthKeys, type StealthPayment } from "@relayless/sdk/stealth";
import type { Relayless, Signer } from "@relayless/sdk";
import { Button, Field, Problem, Screen, eth, inputClass, plainError, short } from "../ui";
import { Access, DevnetNotice, Mono, Row } from "./parts";
import { sepoliaWallet } from "./sepolia";
import { ensReader, ensTransportOptions, nymReadError, nymRequested } from "./nym";

/** Present only in the local app, where there's a pool to pay from. */
export interface DevnetSession {
  rl: Relayless;
  signer: Signer;
  rpc: string;
  announcer: { address: Address; deployBlock: number } | null;
  refresh(): Promise<void>;
}

const ensError = (e: unknown) => {
  // On the mixnet a failed read can mention anything in its payload, so only errors from outside viem count as a bad name.
  const fromRead = e instanceof BaseError;
  if (!(nymRequested && fromRead) && /normaliz|invalid|disallowed|label/i.test(String((e as Error)?.message ?? e))) return "That isn't a valid name. Check the spelling.";
  return nymRequested && fromRead ? nymReadError : plainError(e);
};

function LookUp({ cfg, name, setName, metaAddress, setMetaAddress }: { cfg: EnsConfig; name: string; setName(n: string): void; metaAddress: string | null | undefined; setMetaAddress(m: string | null | undefined): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [derived, setDerived] = useState<StealthPayment[]>([]);
  const look = async () => {
    setBusy(true); setError(""); setDerived([]); setMetaAddress(undefined);
    try {
      setMetaAddress(await ensReader(cfg).stealthMetaAddress(name));
    } catch (e) {
      setError(ensError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mb-9 max-w-2xl">
      <h2 className="mb-2 text-2xl font-bold">Look up a name</h2>
      <Field label="Name" hint={nymRequested ? "Your browser asks a Sepolia RPC through the mixnet. No server of ours sees this." : "Your browser asks a Sepolia RPC directly. No server of ours sees this."}>
        <input className={inputClass} value={name} autoCapitalize="none" spellCheck={false} onChange={(e) => { setName(e.target.value.trim()); setMetaAddress(undefined); setDerived([]); }} placeholder={`alice.${cfg.names.parent}`} />
      </Field>
      <Button disabled={busy || !name} onClick={look}>{busy ? "Looking…" : "Look up"}</Button>
      {error && <Problem>{error}</Problem>}
      {metaAddress === null && <Problem>This name has no stealth record, so it can't be paid privately.</Problem>}
      {metaAddress && !isMetaAddress(metaAddress) && <Problem>This name's stealth record isn't valid.</Problem>}
      {isMetaAddress(metaAddress) && (
        <div className="mt-4">
          <dl><Row label="Stealth record"><Mono>{metaAddress}</Mono></Row></dl>
          <p className="mt-3 max-w-xl">This record never changes between payments, and it isn't an address anyone can pay. Each payer turns it into a new address, on their own device.</p>
          <Button className="mt-3" onClick={() => setDerived([deriveStealthPayment(metaAddress), ...derived])}>{derived.length ? "Derive another" : "Derive a one-time address"}</Button>
          {derived.length > 0 && (
            <ul className="mt-3">
              {derived.map((d) => <li key={d.stealthAddress} className="border-t border-line py-1.5"><Mono>{d.stealthAddress}</Mono></li>)}
            </ul>
          )}
          {derived.length > 1 && <p className="mt-2 max-w-xl text-slate">Different every time, and nothing on-chain connects them. Only this name's viewing key can recognise them.</p>}
          <Access cfg={cfg} name={name} />
        </div>
      )}
    </section>
  );
}

function Claim({ cfg }: { cfg: EnsConfig }) {
  const [label, setLabel] = useState("");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const claim = async () => {
    setError(""); setDone(null);
    try {
      setStep("Checking that name");
      if (!(await ensReader(cfg).isClaimable(label))) throw new Error("That name is taken.");
      setStep("Connecting your wallet");
      const { sender, keys } = await sepoliaWallet(cfg);
      setStep("Sign once to make your keys");
      const k = await keys();
      setStep("Confirm three transactions: your resolver, its record, then the name");
      const { name } = await claimReceiveName(cfg, sender, { label, metaAddress: metaAddressOf(k), appAddress: privateKeyToAccount(k.appKey).address, transport: ensTransportOptions(cfg) });
      setDone(name);
    } catch (e) {
      setError(ensError(e));
    } finally {
      setStep("");
    }
  };
  return (
    <section className="mb-9 max-w-2xl">
      <h2 className="mb-2 text-2xl font-bold">Claim a name</h2>
      <p className="mb-3">It's free apart from Sepolia gas, and it's yours: it never expires, and no one, including us, can edit or take it. This app's key gets a role that can change only your stealth record.</p>
      <Field label="Your name" hint={label ? `${label}.${cfg.names.parent}` : `Becomes something.${cfg.names.parent}`}>
        <input className={inputClass} value={label} autoCapitalize="none" spellCheck={false} onChange={(e) => setLabel(e.target.value.trim().toLowerCase())} disabled={Boolean(step)} />
      </Field>
      <Button disabled={Boolean(step) || !label} onClick={claim}>{step ? "Working…" : "Claim"}</Button>
      {step && <p className="mt-2 text-slate" aria-live="polite">{step}</p>}
      {error && <Problem>{error}</Problem>}
      {done && <p className="mt-3 border-l-4 border-pool pl-3">You own <strong>{done}</strong>. Anyone can now pay it privately.</p>}
    </section>
  );
}

function Pay({ s, name, metaAddress }: { s: DevnetSession; name: string; metaAddress: string }) {
  const [amount, setAmount] = useState("0.03");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paid, setPaid] = useState<Address[]>([]);
  const pay = async () => {
    setBusy(true); setError("");
    try {
      const { payment, handles } = await s.rl.payStealth({ metaAddress, amount: parseEther(amount), announcer: s.announcer!.address });
      await Promise.all(handles.map((h) => h.wait()));
      setPaid([payment.stealthAddress, ...paid]);
      await s.refresh();
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Field label="Amount in ETH" hint="Also costs about one extra withdrawal's gas, to publish the announcement from a new wallet.">
        <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
      </Field>
      <Button disabled={busy || !s.announcer} onClick={pay}>{busy ? "Proving, announcing, paying…" : `Pay ${name} privately`}</Button>
      {error && <Problem>{error}</Problem>}
      {paid.length > 0 && <ul className="mt-3">{paid.map((a) => <li key={a} className="border-t border-line py-1.5">Paid <Mono>{a}</Mono></li>)}</ul>}
    </div>
  );
}

function Receive({ s }: { s: DevnetSession }) {
  const [keys, setKeys] = useState<StealthKeys | null>(null);
  const [found, setFound] = useState<(ReceivedPayment & { balance: bigint })[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scan = async () => {
    setBusy(true); setError("");
    try {
      const k = keys ?? stealthKeysFromSignature(await s.signer.signTypedData(stealthTypedData() as any) as Hex);
      setKeys(k);
      const result = await scanAnnouncements(s.rpc, s.announcer!.address, k, s.announcer!.deployBlock);
      setUnread(result.unreadableBlocks.length);
      setFound(await Promise.all(result.received.map(async (r) => ({ ...r, balance: BigInt(await fetchBalance(s.rpc, r.stealthAddress)) }))));
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <p className="mb-3 max-w-xl">Reads every announcement and tests each one on this device. The node can't tell which are yours.</p>
      <Button disabled={busy || !s.announcer} onClick={scan}>{busy ? "Scanning…" : "Find my payments"}</Button>
      {error && <Problem>{error}</Problem>}
      {unread > 0 && <Problem>{unread} block{unread > 1 ? "s" : ""} couldn't be read, so this list may be incomplete.</Problem>}
      {found?.length === 0 && <p className="mt-3 text-slate">Nothing for this wallet's keys yet.</p>}
      {found && found.length > 0 && <ul className="mt-3">{found.map((f) => <li key={f.txHash} className="border-t border-line py-1.5"><Mono>{short(f.stealthAddress)}</Mono> holds <strong>{eth(f.balance)} ETH</strong></li>)}</ul>}
    </div>
  );
}

async function fetchBalance(rpcUrl: string, address: Address): Promise<string> {
  const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }) });
  return (await r.json()).result;
}

export function Names({ cfg, session }: { cfg: EnsConfig; session?: DevnetSession }) {
  const [name, setName] = useState("");
  const [metaAddress, setMetaAddress] = useState<string | null | undefined>(undefined);
  return (
    <Screen title="Private receive names">
      <p className="mb-6 max-w-2xl">Pay a name, and no one can link two payments to its owner. The name holds a stealth record instead of an address, and each payment goes to a new one-time address.</p>
      <LookUp cfg={cfg} name={name} setName={setName} metaAddress={metaAddress} setMetaAddress={setMetaAddress} />
      <section className="mb-9 max-w-2xl">
        <h2 className="mb-2 text-2xl font-bold">Pay it from the pool</h2>
        {!session ? <DevnetNotice what="The private payment" />
          : !isMetaAddress(metaAddress) ? <p className="text-slate">Look up a name above first.</p>
          : <Pay s={session} name={name} metaAddress={metaAddress} />}
      </section>
      <section className="mb-9 max-w-2xl">
        <h2 className="mb-2 text-2xl font-bold">Find payments to you</h2>
        {session ? <Receive s={session} /> : <DevnetNotice what="Scanning for payments" />}
      </section>
      <Claim cfg={cfg} />
    </Screen>
  );
}
