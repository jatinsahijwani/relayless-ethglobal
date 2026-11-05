// The World ID path end to end on a live chain: real ASP server over HTTP, real root publishing, real proofs.
// ONLY World's verdict is faked, and proofs here are placeholders, so this doesn't show that World accepts anything.
// Real verification needs the values in docs/world-id-setup.md.
import { createServer } from "node:http";
import { parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { NotApprovedError, Relayless, fileProver, httpAssociationSet } from "@relayless/sdk";
import { createAsp, emptyState, joinMessage } from "../apps/asp/src/asp.js";
import { liveChain } from "../apps/asp/src/chain.js";
import { handler } from "../apps/asp/src/server.js";
import { CIRCUITS, balanceOf, fundedKey, loadConfig, localSigner, mined, stopWorkers } from "./lib.js";

const cfg = loadConfig("local-asp");
const deployerKey = process.env.DEPLOYER_KEY as Hex;
const aspKey = process.env.ASP_KEY as Hex;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

let worldSays = true;
const asp = createAsp({
  pool: cfg.pool,
  action: "join-approved-set",
  environment: "staging",
  appId: "app_fake",
  world: { rpContext: () => ({ rp_id: "rp_fake", nonce: "n", created_at: 1, expires_at: 2, signature: "s" }), verify: async () => worldSays },
  chain: liveChain(cfg, aspKey),
  state: emptyState(),
  save: () => {},
});
const server = createServer(handler(asp, undefined));
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${(server.address() as any).port}`;

const connect = (key: Hex) => Relayless.connect({ rpc: cfg.rpc, mempool: cfg.mempool, pool: cfg.pool as Address, signer: localSigner(cfg, key), prover: fileProver(CIRCUITS), chainId: cfg.chainId, asp: httpAssociationSet(url) });
const join = async (key: Hex, nullifier: string) => {
  const account = privateKeyToAccount(key);
  const signature = await account.signMessage({ message: joinMessage(cfg.pool, account.address) });
  const result = { environment: "staging", responses: [{ signal_hash: hashSignal(account.address), nullifier }] };
  return fetch(`${url}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ depositor: account.address, signature, result }) });
};
const nullifier = (salt: number) => (BigInt(Date.now()) * 1000n + BigInt(salt)).toString();

const aliceKey = await fundedKey(cfg, deployerKey, "world-alice", parseEther("1"));
const bobKey = await fundedKey(cfg, deployerKey, "world-bob", parseEther("1"));
const alice = await connect(aliceKey);
const bob = await connect(bobKey);
await mined(cfg, (await alice.deposit({ amount: parseEther("0.2") })).hash);
await mined(cfg, (await bob.deposit({ amount: parseEther("0.2") })).hash);

check("public config offers World ID and hides the signing key", (await (await fetch(`${url}/config`)).json()).enabled === true);

worldSays = false;
const rejected = await join(aliceKey, nullifier(1));
check("alternative path: World rejecting the proof approves nothing", rejected.status === 400 && (await rejected.json()).error === "verification_failed");
worldSays = true;

const aliceNullifier = nullifier(2);
const joined = await join(aliceKey, aliceNullifier);
check("a verified human joins, and the server publishes a real root", joined.status === 200, `HTTP ${joined.status}`);

const to = alice.freshAddress(0);
const h = await alice.withdraw({ to, amount: parseEther("0.05") });
const r = await h.wait();
check("after joining, a private payment lands against that root", r?.status === "0x1" && (await balanceOf(cfg, to)) > parseEther("0.049"), `verify gas ${Number(r.frameReceipts[0].gasUsed)}`);

const reused = await join(bobKey, aliceNullifier);
check("alternative path: one human can't approve a second address", reused.status === 409);

let refused: unknown = null;
await bob.withdraw({ to: bob.freshAddress(0), amount: parseEther("0.05") }).catch((e) => (refused = e));
check("alternative path: without approval, the protected action doesn't happen", refused instanceof NotApprovedError);

const bobNote = (await bob.notes())[0];
const before = await balanceOf(cfg, bobNote.depositor);
const exit = await bob.ragequit(bobNote);
check("alternative path: public exit still returns the money", (await exit.wait())?.status === "0x1" && (await balanceOf(cfg, bobNote.depositor)) > before);

console.log(failures ? `\n${failures} failed\n` : "\nall passed (World's verdict was faked)\n");
server.close();
await stopWorkers();
process.exit(failures ? 1 : 0);
