import type { AnonymityReport } from "@relayless/sdk";

/**
 * The crowd: every deposit that could have funded this payment. A dot's size is how suspicious an outside observer would
 * find it, and marigold marks the user's own. Even dots mean nobody stands out.
 */
export function Crowd({ report, own, className = "" }: { report: AnonymityReport; own: Set<number>; className?: string }) {
  const c = report.candidates;
  // A fixed dot scale, so a small crowd looks small: that is the honest picture.
  const cols = Math.max(12, Math.ceil(Math.sqrt(c.length * 1.8)));
  const rows = Math.max(2, Math.ceil(c.length / cols));
  const cell = 24;
  const maxP = Math.max(...c.map((x) => x.p), 0.0001);
  return (
    <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} className={`block w-full ${className}`} role="img" aria-label={`${c.length} deposits could have funded this payment`}>
      {c.map((x, i) => {
        const mine = own.has(x.leafIndex);
        const r = 2.5 + 8 * Math.sqrt(x.p / maxP);
        return (
          <circle
            key={x.leafIndex}
            className="dot"
            style={{ animationDelay: `${i * 18}ms` }}
            cx={(i % cols) * cell + cell / 2}
            cy={Math.floor(i / cols) * cell + cell / 2}
            r={r}
            fill={mine ? "#F0A202" : "#0B6B70"}
            fillOpacity={mine ? 1 : 0.75}
            stroke={mine ? "#16233A" : "none"}
            strokeWidth={mine ? 1.5 : 0}
          />
        );
      })}
    </svg>
  );
}

export const oneIn = (report: AnonymityReport) => Math.max(1, Math.round(Math.pow(2, report.minEntropyBits)));
