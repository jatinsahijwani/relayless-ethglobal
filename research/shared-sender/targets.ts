// The mempools the harness attacks. Local chains only: every target refuses to run unless its RPC is on localhost.
export type Node = { name: string; url: string; mines: boolean };
export type Target = {
  id: string;
  /** The config/<network>.deployed.json whose pool and chain the run uses. */
  network: string;
  kind: "sidecar" | "ethrex";
  /** Where transactions are sent. A sidecar target has a mining node and a node that never mines; ethrex runs one. */
  nodes: Node[];
  matcha: boolean;
  /** What the target is, for the results. */
  describe: string;
};

const sidecarNodes: Node[] = [
  { name: "A (mines)", url: "http://127.0.0.1:14347/rpc/", mines: true },
  { name: "B (never mines)", url: "http://127.0.0.1:14348/rpc/", mines: false },
];

export const TARGETS: Record<string, Target> = {
  "sidecar-nofix": {
    id: "sidecar-nofix",
    network: "local",
    kind: "sidecar",
    nodes: sidecarNodes,
    matcha: false,
    describe:
      "ERC-8421 sidecar, upstream 2e22ff0a plus per-entity budgets and the precompile default (branch feat/per-entity-budgets-precompiles), WITHOUT the replacement-counting fix. Two instances on the devnet-8421 chain (ethrex 9aa3645d), no gossip between them: A mines, B is in manual mode",
  },
  "sidecar-fix": {
    id: "sidecar-fix",
    network: "local",
    kind: "sidecar",
    nodes: sidecarNodes,
    matcha: false,
    describe:
      "The same, WITH the replacement-counting fix (branch local/integration-pr1-pr2 = fix/replacement-not-seen + feat/per-entity-budgets-precompiles)",
  },
  "ethrex-64b8fc09": {
    id: "ethrex-64b8fc09",
    network: "local-hegota",
    kind: "ethrex",
    nodes: [{ name: "ethrex 64b8fc09", url: "http://127.0.0.1:18645", mines: true }],
    matcha: false,
    describe:
      "ethrex 64b8fc09 (chain 8141's revision) in dev mode, one node, --mempool.max-verify-gas 500000. Relaxes one-pending-per-sender for disjoint nonce keys; no width budget",
  },
  "ethrex-247e2dd2": {
    id: "ethrex-247e2dd2",
    network: "local-matcha",
    kind: "ethrex",
    nodes: [{ name: "ethrex 247e2dd2", url: "http://127.0.0.1:18745", mines: true }],
    matcha: true,
    describe:
      "ethrex 247e2dd2 (MATCHA width budget, on by default) in dev mode, one node, --mempool.max-verify-gas 500000, default MATCHA policy",
  },
};
