// Compliance path, locally: only labels in the association set can withdraw privately; anyone else can still exit publicly.
// The ASP here is a plain local key behind the SDK's AssociationSetProvider interface, as any third-party ASP would be.
import { concat, keccak256, numberToHex, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NotAdmittedError, NotApprovedError, Relayless, checkRecentRoot, profileOf, fileProver, publishedSetProvider, rootOf, siblings, type AssociationSetProvider } from "@relayless/sdk";
import { CIRCUITS, balanceOf, fundedKey, loadConfig, localSigner, mined, rpc, stopWorkers } from "./lib.js";

const SALT = keccak256(toHex("relayless.asp"));
const cfg = loadConfig("local-asp");
const deployerKey = process.env.DEPLOYER_KEY as Hex;
const aspKey = process.env.ASP_KEY as Hex;
const asp = privateKeyToAccount(aspKey);
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

let approved: bigint[] = [];
let ref: { sourceId: Hex; slot: bigint; root: Hex } | null = null;
const SOURCE = keccak256(concat([asp.address, SALT]));
const provider: AssociationSetProvider = publishedSetProvider(async () => ({ sourceId: SOURCE, labels: approved, ref }));

async function publish(labels: bigint[]) {
  approved = labels;
  const root = numberToHex(rootOf(labels), { size: 32 });
  const nonce = Number(await rpc(cfg.rpc, "eth_getTransactionCount", [asp.address, "pending"]));
  const raw = await asp.signTransaction({ chainId: cfg.chainId, nonce, to: "0x0000000000000000000000000000000000008272", data: concat([SALT, root]), gas: 400_000n, gasPrice: 2_000_000_000n, type: "legacy" });
  const r = await mined(cfg, await rpc<Hex>(cfg.rpc, "eth_sendRawTransaction", [raw]));
  const block = await rpc(cfg.rpc, "eth_getBlockByNumber", [r.blockNumber, false]);
  ref = { sourceId: SOURCE, slot: BigInt(block.slotNumber), root };
  for (;;) {
    const head = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
    if (BigInt(head.slotNumber) > ref.slot) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
}

const connect = (key: Hex, p: AssociationSetProvider = provider) => Relayless.connect({ rpc: cfg.rpc, mempool: cfg.mempool, profile: cfg.profile, pool: cfg.pool as Address, signer: localSigner(cfg, key), prover: fileProver(CIRCUITS), chainId: cfg.chainId, asp: p });
const aliceKey = await fundedKey(cfg, deployerKey, "alice", parseEther("1"));
const bobKey = await fundedKey(cfg, deployerKey, "bob", parseEther("1"));
const alice = await connect(aliceKey);
const bob = await connect(bobKey);
await mined(cfg, (await alice.deposit({ amount: parseEther("0.2") })).hash);
await mined(cfg, (await bob.deposit({ amount: parseEther("0.2") })).hash);
const aliceNote = (await alice.notes())[0];
const bobNote = (await bob.notes())[0];
await publish([aliceNote.label]);
check("the provider's source is the one the pool accepts, and its root is on the chain", (await provider.sourceId()) === cfg.aspSourceId && (await checkRecentRoot(cfg.rpc, (await provider.currentRoot())!, profileOf(cfg.profile).recentRoot)).status === "verified");

const to = alice.freshAddress(0);
const h = await alice.withdraw({ to, amount: parseEther("0.05") });
const r = await h.wait();
check("a note in the approved set withdraws privately, with two root references", r?.status === "0x1" && (await balanceOf(cfg, to)) > parseEther("0.049"), `verify gas ${Number(r.frameReceipts[0].gasUsed)}`);

const changeNote = (await alice.notes()).find((n) => !n.spent)!;
const h2 = await alice.withdraw({ to: alice.freshAddress(1), amount: parseEther("0.05"), note: changeNote });
check("its change note inherits approval through the label", (await h2.wait())?.status === "0x1");

let refused: unknown = null;
await bob.withdraw({ to: bob.freshAddress(0), amount: parseEther("0.05") }).catch((e) => (refused = e));
check("a note outside the set can't withdraw privately", refused instanceof NotApprovedError);

// Lying about membership, three ways. None may reach the mempool.
const outcome = (p: Promise<unknown>) => p.then(() => "SENT", (e) => e);

// 1. A proof that doesn't reach the provider's own root: the SDK refuses before proving.
const inconsistent: AssociationSetProvider = { ...provider, membershipProof: async (label) => ({ ref: ref!, index: 0, siblings: siblings([label], 0) }) };
const r1 = await outcome((await connect(bobKey, inconsistent)).withdraw({ to: bob.freshAddress(0), amount: parseEther("0.05") }));
check("a membership proof that doesn't reach its root is refused before proving", r1 !== "SENT" && /doesn't match its root/.test(r1.message), r1.message?.slice(0, 70));

// 2. A self-consistent proof against a root the ASP never published: only the chain can catch this, and it does.
const fakeRoot = numberToHex(rootOf([bobNote.label]), { size: 32 });
const lying: AssociationSetProvider = { ...provider, membershipProof: async (label) => ({ ref: { ...ref!, root: fakeRoot }, index: 0, siblings: siblings([label], 0) }) };
const r2 = await outcome((await connect(bobKey, lying)).withdraw({ to: bob.freshAddress(0), amount: parseEther("0.05") }));
check("a proof against a root the ASP never published is refused by the chain's root check, and not broadcast", r2 instanceof NotAdmittedError && /simulation failed/.test(r2.message), r2.message?.slice(0, 70));

// 3. A provider that writes under another source: the pool wouldn't accept its roots, so the SDK refuses at once.
const other: AssociationSetProvider = { ...provider, sourceId: async () => keccak256(toHex("someone else")) };
const r3 = await outcome((await connect(bobKey, other)).withdraw({ to: bob.freshAddress(0), amount: parseEther("0.05") }));
check("a provider for another source is refused before proving", r3 !== "SENT" && /only accepts/.test(r3.message), r3.message?.slice(0, 70));

const depositor = localSigner(cfg, bobKey).address;
const before = await balanceOf(cfg, depositor);
const exit = await bob.ragequit(bobNote);
const er = await exit.wait();
check("that note can still exit publicly to its depositor", er?.status === "0x1" && (await balanceOf(cfg, depositor)) > before, `gas ${Number(er?.gasUsed)}`);
check("and it can't be spent again", (await bob.notes()).every((n) => n.spent));

await publish([aliceNote.label, bobNote.label]);
check("a later root can add members", approved.length === 2);

console.log(failures ? `\n${failures} failed\n` : "\nall passed\n");
await stopWorkers();
process.exit(failures ? 1 : 0);
