// Everything the SDK reads from or sends to the network. Deposits are fetched whole, never filtered to the user's own,
// so what the RPC sees does not reveal which notes are theirs.
import { decodeEventLog, encodeEventTopics, parseAbi, type Address, type Hex } from "viem";

export const POOL_ABI = parseAbi([
  "event LeafInserted(uint256 indexed leafIndex, uint256 commitment)",
  "event RootPublished(uint256 rootCommit, uint256 treeRoot, uint256 leafCount)",
  "event Deposited(address indexed depositor, uint256 label, uint256 value, uint256 precommitment, uint256 commitment, uint256 leafIndex)",
  "event Withdrawn(address indexed recipient, uint256 amount, uint256 fee, uint256 changeCommitment, uint256 nullifierHash, uint256 k)",
  "event Ragequit(address indexed depositor, uint256 label, uint256 value, uint256 fee, uint256 nullifierHash)",
  "event PaymentDeferred(address indexed recipient, uint256 amount)",
  "function deposit(uint256 precommitment) payable returns (uint256)",
  "function withdraw(address recipient, uint256 amount, uint256 fee, uint256 changeCommitment, uint256 nullifierHash, uint256 k)",
  "function ragequit(uint256 label, uint256 value, uint256 fee, uint256 nullifierHash)",
  "function refund()",
  "function claim(address to)",
  "function republishRoot()",
  "function fundReserve() payable",
  "function reserve() view returns (uint256)",
  "function liabilities() view returns (uint256)",
  "function claimable(address) view returns (uint256)",
  "function ROOT_SALT() view returns (bytes32)",
  "function ASP_SOURCE_ID() view returns (bytes32)",
]);

export class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

export async function rpc<T = any>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new RpcError(body.error.code, body.error.message);
  return body.result as T;
}

/**
 * Resolves once a mined transaction's nonce shows as used. Right after a receipt appears the node's nonce view can lag,
 * so a next transaction signed at that moment could reuse the nonce and never mine.
 */
export async function nonceSettled(url: string, hash: Hex, timeoutMs = 30_000): Promise<void> {
  const tx = await rpc(url, "eth_getTransactionByHash", [hash]);
  // Frame transactions use keyed nonces, so they have no account nonce to wait for.
  if (!tx || tx.nonce === undefined) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = BigInt(await rpc(url, "eth_getTransactionCount", [tx.from, "pending"]));
    const latest = BigInt(await rpc(url, "eth_getTransactionCount", [tx.from, "latest"]));
    if (latest > BigInt(tx.nonce) && pending > BigInt(tx.nonce)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

export interface DepositEvent { depositor: Address; label: bigint; value: bigint; precommitment: bigint; commitment: bigint; leafIndex: number; blockNumber: number; txHash: Hex }
export interface WithdrawEvent { recipient: Address; amount: bigint; fee: bigint; changeCommitment: bigint; nullifierHash: bigint; k: bigint; blockNumber: number; txHash: Hex }
export interface RagequitEvent { depositor: Address; label: bigint; value: bigint; fee: bigint; nullifierHash: bigint; blockNumber: number; txHash: Hex }
export interface RootEvent { rootCommit: bigint; treeRoot: bigint; leafCount: number; blockNumber: number }

export interface PoolState {
  leaves: bigint[];
  deposits: DepositEvent[];
  withdrawals: WithdrawEvent[];
  ragequits: RagequitEvent[];
  roots: RootEvent[];
}

/**
 * Fetches logs, splitting the range around blocks the node can't serve. ethrex can lose the number index for a run of
 * blocks, after which any range touching them errors. Skipped blocks are safe only because fetchPoolState checks the
 * result: if a gap hid one of the pool's leaves, it fails rather than building a wrong tree.
 */
async function logsAround(rpcUrl: string, pool: Address, lo: number, hi: number): Promise<any[]> {
  if (lo > hi) return [];
  try {
    return await rpc<any[]>(rpcUrl, "eth_getLogs", [{ address: pool, fromBlock: `0x${lo.toString(16)}`, toBlock: `0x${hi.toString(16)}` }]);
  } catch (e) {
    if (!(e instanceof RpcError) || !/could not get header/i.test(e.message)) throw e;
    if (lo === hi) return [];
    const mid = lo + Math.floor((hi - lo) / 2);
    return [...(await logsAround(rpcUrl, pool, lo, mid)), ...(await logsAround(rpcUrl, pool, mid + 1, hi))];
  }
}

export async function fetchPoolState(rpcUrl: string, pool: Address, fromBlock = 0): Promise<PoolState> {
  const head = Number(await rpc<string>(rpcUrl, "eth_blockNumber", []));
  const logs = await logsAround(rpcUrl, pool, fromBlock, head);
  const state: PoolState = { leaves: [], deposits: [], withdrawals: [], ragequits: [], roots: [] };
  for (const log of logs) {
    let ev: any;
    try {
      ev = decodeEventLog({ abi: POOL_ABI, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    const a = ev.args;
    const at = { blockNumber: Number(log.blockNumber), txHash: log.transactionHash as Hex };
    switch (ev.eventName) {
      case "LeafInserted":
        state.leaves[Number(a.leafIndex)] = a.commitment;
        break;
      case "RootPublished":
        state.roots.push({ rootCommit: a.rootCommit, treeRoot: a.treeRoot, leafCount: Number(a.leafCount), blockNumber: at.blockNumber });
        break;
      case "Deposited":
        state.deposits.push({ depositor: a.depositor, label: a.label, value: a.value, precommitment: a.precommitment, commitment: a.commitment, leafIndex: Number(a.leafIndex), ...at });
        break;
      case "Withdrawn":
        state.withdrawals.push({ recipient: a.recipient, amount: a.amount, fee: a.fee, changeCommitment: a.changeCommitment, nullifierHash: a.nullifierHash, k: a.k, ...at });
        break;
      case "Ragequit":
        state.ragequits.push({ depositor: a.depositor, label: a.label, value: a.value, fee: a.fee, nullifierHash: a.nullifierHash, ...at });
        break;
    }
  }
  // A missing index means the node couldn't serve a block holding one of the pool's leaves.
  const expected = state.roots.reduce((m, r) => Math.max(m, r.leafCount), 0);
  const count = Math.max(state.leaves.length, expected);
  for (let i = 0; i < count; i++) {
    if (state.leaves[i] === undefined) throw new Error(`this node is missing pool data (leaf ${i}), so your notes can't be rebuilt safely: try another node`);
  }
  return state;
}

export const topicsOf = encodeEventTopics;
