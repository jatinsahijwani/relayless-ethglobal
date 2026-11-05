import type { ButtonHTMLAttributes, ReactNode } from "react";
import { formatEther } from "viem";

export const eth = (w: bigint, digits = 4) => {
  const n = Number(formatEther(w));
  if (n === 0) return "0";
  return n < 0.0001 ? "<0.0001" : n.toLocaleString("en", { maximumFractionDigits: digits });
};
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" }) {
  const look = variant === "primary" ? "bg-ink text-paper hover:bg-pool disabled:bg-slate" : "bg-transparent text-ink underline underline-offset-4 decoration-line hover:decoration-ink";
  return <button {...rest} className={`min-h-12 rounded-lg px-5 font-bold transition-colors ${look} ${className}`} />;
}

export const Screen = ({ title, children }: { title: string; children: ReactNode }) => (
  <section>
    <h1 className="mb-5 text-4xl font-bold">{title}</h1>
    {children}
  </section>
);

export const Problem = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="mt-3 border-l-4 border-alarm pl-3 text-alarm">{children}</p>
);

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block font-bold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-slate">{hint}</span>}
    </label>
  );
}

export const inputClass = "tnum min-h-12 w-full rounded-lg border-2 border-line bg-paper px-3 text-lg focus:border-pool focus:outline-none";

/** Turns SDK and node errors into a next step. */
export function plainError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/insufficient funds|Insufficient/i.test(m)) return "This wallet doesn't have enough ETH for that, including gas. Add test ETH or lower the amount.";
  if (/user rejected|denied/i.test(m)) return "You declined in your wallet. Nothing was sent.";
  if (/MAX_VERIFY_GAS/.test(m)) return "This network's mempool doesn't accept withdrawals yet: its gas limit for checking proofs is too low. Nothing was sent, and your money is safe.";
  if (/banned|throttled/i.test(m)) return "This mempool node is limiting the pool right now. Nothing was sent. Try again later or use another node.";
  return m;
}
