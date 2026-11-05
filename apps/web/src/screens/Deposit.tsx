import { useEffect, useState } from "react";
import { parseEther } from "viem";
import type { Session } from "../App";
import { Button, Field, Problem, Screen, eth, inputClass, plainError } from "../ui";
import { askFaucet, waitMined, walletBalance } from "../wallet";

export function Deposit({ s }: { s: Session }) {
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const load = () => walletBalance(s.signer.address).then(setBalance).catch(() => {});
  useEffect(() => { load(); }, []);

  const deposit = async () => {
    setError(""); setDone(""); setBusy("Adding your money…");
    try {
      const { hash } = await s.rl.deposit({ amount: parseEther(amount) });
      await waitMined(hash);
      await s.refresh();
      await load();
      setDone(`Added ${amount} ETH. Waiting a while before you spend it makes you harder to spot.`);
    } catch (e) { setError(plainError(e)); } finally { setBusy(""); }
  };
  const faucet = async () => {
    setError(""); setBusy("Asking for test ETH…");
    try {
      await askFaucet(s.signer.address);
      for (let i = 0; i < 30; i++) {
        const b = await walletBalance(s.signer.address);
        setBalance(b);
        if (b > 0n) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (e) { setError(plainError(e)); } finally { setBusy(""); }
  };
  return (
    <Screen title="Add money">
      <p className="mb-5 max-w-md">This comes from your public wallet, so anyone can see that you added it. What they can't see is where it goes afterward.</p>
      <p className="tnum mb-5 text-slate">Your public wallet holds <strong className="text-ink">{balance === null ? "…" : eth(balance)} ETH</strong>{balance === 0n && <> <Button variant="quiet" onClick={faucet} disabled={Boolean(busy)}>Get test ETH</Button></>}</p>
      <div className="max-w-sm">
        <Field label="Amount in ETH" hint="At least 0.01 ETH.">
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Button className="w-full" disabled={Boolean(busy) || !(Number(amount) >= 0.01)} onClick={deposit}>{busy || `Add ${amount} ETH`}</Button>
      </div>
      {done && <p role="status" className="mt-4 border-l-4 border-pool pl-3">{done}</p>}
      {error && <Problem>{error}</Problem>}
    </Screen>
  );
}
