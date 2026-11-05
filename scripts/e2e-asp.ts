// Compliance path, locally: only labels in the association set can withdraw privately; anyone else can still exit publicly.
// The ASP here is a plain local key. World ID and the ENS name are what would sit in front of it.
import { concat, keccak256, numberToHex, parseEther, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NotApprovedError, Relayless, fileProver, rootOf } from "@relayless/sdk";
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
const provider = { load: async () => ({ labels: approved, ref: ref! }) };

async function publish(labels: bigint[]) {
  approved = labels;
  const root = numberToHex(rootOf(labels), { size: 32 });
  const nonce = Number(await rpc(cfg.rpc, "eth_getTransactionCount", [asp.address, "pending"]));
  const raw = await asp.signTransaction({ chainId: cfg.chainId, nonce, to: "0x0000000000000000000000000000000000008272", data: concat([SALT, root]), gas: 400_000n, gasPrice: 2_000_000_000n, type: "legacy" });
  const r = await mined(cfg, await rpc<Hex>(cfg.rpc, "eth_sendRawTransaction", [raw]));
  const block = await rpc(cfg.rpc, "eth_getBlockByNumber", [r.blockNumber, false]);
  ref = { sourceId: keccak256(concat([asp.address, SALT])), slot: BigInt(block.slotNumber), root };
  for (;;) {
    const head = await rpc(cfg.rpc, "eth_getBlockByNumber", ["latest", false]);
    if (BigInt(head.slotNumber) > ref.slot) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
}

const connect = (key: Hex) => Relayless.connect({ rpc: cfg.rpc, mempool: cfg.mempool, pool: cfg.pool as Address, signer: localSigner(cfg, key), prover: fileProver(CIRCUITS), chainId: cfg.chainId, asp: provider });
const aliceKey = await fundedKey(cfg, deployerKey, "alice", parseEther("1"));
const bobKey = await fundedKey(cfg, deployerKey, "bob", parseEther("1"));
const alice = await connect(aliceKey);
const bob = await connect(bobKey);
await mined(cfg, (await alice.deposit({ amount: parseEther("0.2") })).hash);
await mined(cfg, (await bob.deposit({ amount: parseEther("0.2") })).hash);
const aliceNote = (await alice.notes())[0];
const bobNote = (await bob.notes())[0];
await publish([aliceNote.label]);

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

// Lying about membership: claim Alice's slot in the set with Bob's label. The circuit must refuse.
let forged = "";
const forgingProvider = { load: async () => ({ labels: [bobNote.label], ref: ref! }) };
const forger = await Relayless.connect({ rpc: cfg.rpc, mempool: cfg.mempool, pool: cfg.pool as Address, signer: localSigner(cfg, bobKey), prover: fileProver(CIRCUITS), chainId: cfg.chainId, asp: forgingProvider });
await forger.withdraw({ to: bob.freshAddress(0), amount: parseEther("0.05") }).then(() => (forged = "SENT"), (e) => (forged = e.message));
check("faking membership can't produce a proof", forged !== "SENT" && /Assert Failed|Error in template|simulation failed/i.test(forged), forged.slice(0, 70));

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
