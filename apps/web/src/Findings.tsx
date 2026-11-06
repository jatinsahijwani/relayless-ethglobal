import qr from "../../../docs/img/live-qr.svg";

const REPO = "https://github.com/jatinsahijwani/relayless-ethglobal/blob/main";
export const LIVE_URL = "https://relayless-ens.vercel.app";

const Doc = ({ path, children }: { path: string; children: string }) => <a className="font-bold text-pool underline underline-offset-4" href={`${REPO}/${path}`}>{children}</a>;

export const LiveQr = ({ className = "" }: { className?: string }) => (
  <figure className={`flex items-center gap-3 ${className}`}>
    <img src={qr} alt={`QR code for ${LIVE_URL}`} width={104} height={104} className="rounded-lg" />
    <figcaption className="max-w-44 text-sm text-slate">Scan to try the ENS directory and private names on your phone.</figcaption>
  </figure>
);

/** What building a shared-sender privacy pool found out about the alt mempool. Every claim links to its repro. */
export function Findings() {
  return (
    <main className="mx-auto min-h-full max-w-3xl px-4 pb-16 pt-5">
      <header className="mb-8">
        <a href="/" className="font-display text-xl font-bold">Relayless</a>
        <h1 className="mt-5 text-4xl font-bold md:text-5xl">What we found</h1>
        <p className="mt-3 max-w-2xl text-lg">Building a pool where every user shares one sender surfaced three problems in the alt mempool. Each one reproduces.</p>
      </header>

      <section className="mb-9">
        <h2 className="mb-2 text-2xl font-bold">1. The public gateway rejects on-chain ZK verification, twice</h2>
        <ul className="max-w-2xl list-disc space-y-2 pl-5">
          <li><strong>A staked sender is still capped at 100k.</strong> The cap runs before stake is looked up: <code className="text-sm">250000 exceeds MAX_VERIFY_GAS 100000</code>. Our verification uses 253,176 gas.</li>
          <li><strong>Precompile calls are refused in validation, under the cap too</strong> (<code className="text-sm">COD-010</code>), because the gateway's <code className="text-sm">precompiles</code> config is empty.</li>
        </ul>
        <p className="mt-2 text-slate">Fixed locally: per-entity budgets in our sidecar patch, and the precompile list in its config. <Doc path="docs/repro-gateway.md">Repro</Doc></p>
      </section>

      <section className="mb-9">
        <h2 className="mb-2 text-2xl font-bold">2. Fee bumps inflate reputation</h2>
        <p className="max-w-2xl">Every replacement counted as a new <code className="text-sm">seen</code>, against ERC-8421's REPUTATION-040. The alt mempool authors confirmed it's a prototype bug. 8 bumps from one note moved <code className="text-sm">seen</code> from 0 to 8 before our fix, and from 0 to 1 after.</p>
        <p className="mt-2 text-slate">Fixed in our patch. <Doc path="docs/upstream-pr.md">Write-up for upstream</Doc></p>
      </section>

      <section className="mb-9">
        <h2 className="mb-2 text-2xl font-bold">3. A note owner can grief the shared sender across nodes</h2>
        <p className="max-w-2xl">A node that never sees the transaction mined keeps it against the pool. The same note sent to two nodes left <code className="text-sm">seen 2, included 0</code> on the one that didn't mine it. At that rate, throttling a node takes about 110 notes and banning about 510. Those two numbers are calculated, not reached in a run.</p>
        <p className="mt-2 text-slate"><strong className="text-alarm">Still open:</strong> it needs a rule change. <Doc path="docs/reputation-analysis.md">Analysis and mitigations</Doc></p>
      </section>

      <section className="mb-9 border-l-4 border-pool pl-4">
        <h2 className="mb-2 text-2xl font-bold">Why allowing precompiles in validation is safe</h2>
        <p className="max-w-2xl">ERC-8421's CALLING-040 already allows <code className="text-sm">0x01–0x11</code> and <code className="text-sm">P256VERIFY</code>. Only the gateway's config blocks them. These precompiles are pure, stateless, deterministic and gas-bounded. They read no state that another pending transaction could change, so they add no mass-invalidation risk for builders: nothing that lands in a block can flip their result.</p>
        <p className="mt-2 max-w-2xl">The patch otherwise changes only per-entity gas budgets, plus the replacement fix. Allowing precompiles is a config value.</p>
        <p className="mt-2 max-w-2xl text-slate">One limit: this is about correctness, not cost. Gas doesn't price CPU evenly, so a node should set its budget with that in mind.</p>
      </section>

      <LiveQr />
      <p className="mt-3 text-sm text-slate">Runs on a local devnet with a patched sidecar, which the alt mempool authors confirmed is fine for judging. Not audited.</p>
    </main>
  );
}
