// ENSv2 end to end: names and records on Sepolia, money on the local chain.
// usage: set -a; . ./.env; set +a; npx tsx scripts/e2e-ens.ts [--local-only]
//
// Needs scripts/ens/setup.ts and three runs of scripts/ens/add-asp.ts first: see scripts/ens/rehearse.sh, which does all
// of it on a throwaway fork of Sepolia. --local-only hands the meta-address straight to the payer, to test the payment
// path by itself. A pass in that mode says nothing about ENS.
import { readFileSync } from "node:fs";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { encodeFunctionData, getAddress, labelhash, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Relayless, aspSourceOf, claimReceiveName, createEnsReader, crossCheckRoot, fileProver, metaAddressOf, publishRootCall, scanAnnouncements, setStealthRecordCall, stealthAccount, stealthKeysFromSignature, stealthPrivateKey, stealthTypedData, type AssociationSet, type EnsConfig, type EnsSender } from "@relayless/sdk";
import { createAsp, emptyState, joinMessage } from "../apps/asp/src/asp.js";
import { liveChain } from "../apps/asp/src/chain.js";
import { directoryQueue, liveDirectory } from "../apps/asp/src/directory.js";
import { actor, dnsName, loadEnsConfig, MIN_BALANCE, REGISTRY_ABI, requireKey, TOP_UP, ZERO } from "./ens/lib.js";
import { CIRCUITS, balanceOf, connect, fundedKey, loadConfig, localSigner, mined, rpc, stopWorkers } from "./lib.js";

const localOnly = process.argv.includes("--local-only");
const local = loadConfig("local");
const deployerKey = process.env.DEPLOYER_KEY as Hex;
const { announcer, deployBlock } = JSON.parse(readFileSync("config/local.announcer.deployed.json", "utf8")) as { announcer: Address; deployBlock: number };
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const section = (s: string) => console.log(`\n--- ${s}`);

const aliceWallet = privateKeyToAccount(requireKey("E2E_ALICE_KEY"));
const aliceKeys = stealthKeysFromSignature(await aliceWallet.signTypedData(stealthTypedData()));
const stranger = stealthKeysFromSignature(await privateKeyToAccount(deployerKey).signTypedData(stealthTypedData()));
let metaAddress = metaAddressOf(aliceKeys);

if (!localOnly) {
  const ens: EnsConfig = loadEnsConfig();
  const reader = createEnsReader(ens);
  const pub = reader.client;
  const worldLabel: string = (ens as any).names.worldAspLabel;
  const secondLabel = "allowlist";
  const forgedLabel = "forged-demo";
  const curatorActor = actor(ens, requireKey("SEPOLIA_DEPLOYER_KEY"));
  const curator = curatorActor.account.address;
  const operator = privateKeyToAccount(requireKey("ASP_KEY")).address;
  const operator2Key = requireKey("ASP2_KEY");
  const operator2 = actor(ens, operator2Key);
  const pool2Cfg = loadConfig("local-asp2");
  const k = ens.recordKeys;
  const r1: Address = await pub.readContract({ address: ens.contracts.ethRegistry, abi: REGISTRY_ABI, functionName: "getSubregistry", args: [ens.names.parentLabel] } as any) as any;
  const r2: Address = await pub.readContract({ address: r1, abi: REGISTRY_ABI, functionName: "getSubregistry", args: [ens.names.directoryLabel] } as any) as any;

  // ---- Feature A ----
  section("The directory");
  const listed = await reader.listAsps();
  const labels = listed.map((a) => a.label);
  check("ASPs are listed from registry events, with no list in the code", [worldLabel, secondLabel, forgedLabel].every((l) => labels.includes(l)), labels.join(", "));
  const world = listed.find((a) => a.label === worldLabel)!;
  check("the World ID ASP's records resolve", Boolean(world.policy && world.pool && world.operator && world.chainId === 1337), world.policy ?? "");
  check("its record names the operator the pool accepts", world.operator?.toLowerCase() === operator.toLowerCase());
  const worldCheck = await crossCheckRoot(world, { rpc: local.rpc, saltPreimage: (ens as any).aspSaltPreimage });
  check("its ENS root is what the pool's chain holds", worldCheck.status === "verified", worldCheck.status);

  section("An approved set publishes to ENS by itself");
  const second = listed.find((a) => a.label === secondLabel)!;
  const state2 = emptyState();
  const directory = directoryQueue(liveDirectory(ens, secondLabel, operator2Key), (e) => check("publishing didn't fail", false, String(e)));
  const asp2 = createAsp({
    pool: pool2Cfg.pool,
    action: "e2e",
    environment: "staging",
    appId: "app_e2e",
    // Only World's verdict is faked here, as in scripts/e2e-world.ts. Everything after it is real.
    world: { rpContext: () => ({ rp_id: "rp", nonce: "n", created_at: 1, expires_at: 2, signature: "s" }), verify: async () => true },
    chain: liveChain(pool2Cfg, operator2Key),
    state: state2,
    save: () => {},
    directory,
  });
  const provider: AssociationSet = {
    async load() {
      const s = await asp2.set();
      return { labels: s.labels.map(BigInt), ref: { sourceId: s.ref!.sourceId, slot: BigInt(s.ref!.slot), root: s.ref!.root } };
    },
  };
  const memberKey = await fundedKey(pool2Cfg, deployerKey, "ens-member", parseEther("1"));
  const member = privateKeyToAccount(memberKey);
  const memberClient = await Relayless.connect({ rpc: pool2Cfg.rpc, mempool: pool2Cfg.mempool, pool: pool2Cfg.pool, signer: localSigner(pool2Cfg, memberKey), prover: fileProver(CIRCUITS), chainId: pool2Cfg.chainId, asp: provider });
  await mined(pool2Cfg, (await memberClient.deposit({ amount: parseEther("0.2") })).hash);
  const before = second.root;
  await asp2.join({ depositor: member.address, signature: await member.signMessage({ message: joinMessage(pool2Cfg.pool, member.address) }), result: { environment: "staging", responses: [{ signal_hash: hashSignal(member.address), nullifier: `0x${Date.now().toString(16)}` }] } });
  await directory.settled();
  const after = (await reader.listAsps()).find((a) => a.label === secondLabel)!;
  check("approving a depositor changed the ENS root, with no other step", after.root === state2.ref?.root && after.root !== before, after.root ?? "");
  const afterCheck = await crossCheckRoot(after, { rpc: pool2Cfg.rpc, saltPreimage: (ens as any).aspSaltPreimage, serverRoot: state2.ref?.root });
  check("the new root checks out against the pool's chain", afterCheck.status === "verified", afterCheck.status);
  const privatePay = await memberClient.withdraw({ to: memberClient.freshAddress(0), amount: parseEther("0.05") });
  await privatePay.wait();
  check("a private payment works from the pool that ASP serves", (await balanceOf(pool2Cfg, memberClient.freshAddress(0))) > 0n);

  section("The warning");
  const forgedName = `${forgedLabel}.${ens.names.directory}`;
  const forgedRoot = `0x${"de".repeat(32)}` as Hex;
  const forgedResolver: Address = await pub.readContract({ address: r2, abi: REGISTRY_ABI, functionName: "getResolver", args: [forgedLabel] } as any) as any;
  await operator2.wallet.sendTransaction({ to: forgedResolver, data: publishRootCall(ens, forgedName, forgedRoot, BigInt(state2.ref!.slot)) }).then((hash) => pub.waitForTransactionReceipt({ hash }));
  const forged = (await reader.listAsps()).find((a) => a.label === forgedLabel)!;
  check("a root the chain doesn't hold is flagged", (await crossCheckRoot(forged, { rpc: pool2Cfg.rpc, saltPreimage: (ens as any).aspSaltPreimage })).status === "mismatch");
  check("a name claiming a pool that takes roots from someone else is flagged", (await crossCheckRoot({ ...world, pool: pool2Cfg.pool }, { rpc: local.rpc, saltPreimage: (ens as any).aspSaltPreimage })).status === "wrong-operator");
  check("source derivation matches the pool's constructor argument", aspSourceOf(operator2.account.address, (ens as any).aspSaltPreimage) === pool2Cfg.aspSourceId);

  // ---- Permissions, on the real contracts. These are simulations, so they cost no gas. ----
  section("What each key can't do");
  const UNAUTHORIZED = "4b27a133";
  const RESOLVER = parseAbi(["function setText(bytes name, string key, string value)", "function setAddress(bytes name, uint256 coinType, bytes value)", "function grantRootRoles(uint256 roleBitmap, address account)", "function grantSetterRoles(bytes setter, address account)"]);
  const REG = parseAbi(["function setResolver(uint256 anyId, address resolver)", "function setSubregistry(uint256 anyId, address registry)", "function unregister(uint256 anyId)"]);
  const attempt = async (account: Address, to: Address, data: Hex) => {
    try {
      await pub.call({ account, to, data });
      return "allowed";
    } catch (e: any) {
      return String(e?.message ?? e) + String(e?.cause?.data ?? "") + String(e?.cause?.cause?.data ?? "");
    }
  };
  const worldDns = dnsName(world.name);
  const denied = async (what: string, account: Address, to: Address, data: Hex) => {
    const r = await attempt(account, to, data);
    check(what, r.includes(UNAUTHORIZED), r === "allowed" ? "IT WAS ALLOWED" : "");
  };
  const setText = (dns: Hex, key: string, value: string) => encodeFunctionData({ abi: RESOLVER, functionName: "setText", args: [dns, key, value] });
  const id = (l: string) => BigInt(labelhash(l));
  await denied("the curator can't edit an ASP's root", curator, world.resolver, setText(worldDns, k.aspRoot, "0xforged"));
  await denied("the curator can't repoint an ASP's resolver", curator, r2, encodeFunctionData({ abi: REG, functionName: "setResolver", args: [id(worldLabel), curator] }));
  await denied("the curator can't remove an ASP", curator, r2, encodeFunctionData({ abi: REG, functionName: "unregister", args: [id(worldLabel)] }));
  await denied("the operator can't edit the ASP's pool record", operator, world.resolver, setText(worldDns, k.aspPool, ZERO));
  await denied("the operator can't set an address", operator, world.resolver, encodeFunctionData({ abi: RESOLVER, functionName: "setAddress", args: [worldDns, 60n, operator] }));
  await denied("the operator can't repoint the name", operator, r2, encodeFunctionData({ abi: REG, functionName: "setResolver", args: [id(worldLabel), operator] }));
  check("the operator can edit the root", (await attempt(operator, world.resolver, setText(worldDns, k.aspRoot, "0x01"))) === "allowed");
  check("the operator can edit the policy", (await attempt(operator, world.resolver, setText(worldDns, k.aspPolicy, "x"))) === "allowed");
  for (const [name, reg] of [[ens.names.parent, r1], [ens.names.directory, r2]] as const) {
    check(`${name}'s registry is emancipated`, await pub.readContract({ address: reg, abi: REGISTRY_ABI, functionName: "isEmancipated" } as any) as any);
  }

  // ---- Feature B: the name ----
  section("Claiming a receive name");
  const label = "alice";
  const name = `${label}.${ens.names.parent}`;
  const appKey = aliceKeys.appKey;
  const app = privateKeyToAccount(appKey).address;
  if (await reader.isClaimable(label)) {
    for (const address of [aliceWallet.address, app]) {
      if ((await pub.getBalance({ address })) < MIN_BALANCE) await curatorActor.sendEth(`gas for ${address}`, address, TOP_UP);
    }
    const alice = actor(ens, requireKey("E2E_ALICE_KEY"));
    const sender: EnsSender = {
      address: aliceWallet.address,
      async send(to, data) {
        const hash = await alice.wallet.sendTransaction({ to, data });
        const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
        if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
        return receipt;
      },
    };
    await claimReceiveName(ens, sender, { label, metaAddress, appAddress: app });
  }
  const resolved = await reader.stealthMetaAddress(name);
  check("the name resolves to the recipient's meta-address", resolved === metaAddress, resolved ?? "none");
  metaAddress = resolved!;
  check("the name has no `addr` to leak", (await pub.getEnsAddress({ name, universalResolverAddress: ens.contracts.universalResolver }).catch(() => null)) === null);
  const access = await reader.nameAccess(name);
  check("the recipient owns it", access?.owner?.toLowerCase() === aliceWallet.address.toLowerCase());
  check("it never expires", access?.expiry === 2n ** 64n - 1n);
  const aliceResolver = access!.resolver;
  const aliceDns = dnsName(name);
  const appRow = access!.resolverRoles.filter((r) => r.account.toLowerCase() === app.toLowerCase());
  check("the app key holds exactly one role", appRow.length === 1 && appRow[0].scope === k.stealthMetaAddress && appRow[0].roles.join() === "SET_TEXT", JSON.stringify(appRow));

  check("the app key can edit the stealth record", (await attempt(app, aliceResolver, setStealthRecordCall(ens, name, metaAddress))) === "allowed");
  await denied("the app key can't edit other text records", app, aliceResolver, setText(aliceDns, "avatar", "evil"));
  await denied("the app key can't set an address", app, aliceResolver, encodeFunctionData({ abi: RESOLVER, functionName: "setAddress", args: [aliceDns, 60n, app] }));
  await denied("the app key can't repoint the name", app, r1, encodeFunctionData({ abi: REG, functionName: "setResolver", args: [id(label), app] }));
  await denied("the curator can't edit the stealth record", curator, aliceResolver, setStealthRecordCall(ens, name, "st:eth:0xforged"));
  await denied("the curator can't repoint the name", curator, r1, encodeFunctionData({ abi: REG, functionName: "setResolver", args: [id(label), curator] }));
  await denied("the curator can't take the name back", curator, r1, encodeFunctionData({ abi: REG, functionName: "unregister", args: [id(label)] }));
  const grantOn = await attempt(app, aliceResolver, encodeFunctionData({ abi: RESOLVER, functionName: "grantSetterRoles", args: [encodeFunctionData({ abi: RESOLVER, functionName: "setText", args: ["0x", k.stealthMetaAddress, ""] }), curator] }));
  check("the app key can't pass its role on", grantOn !== "allowed");
}

// ---- Feature B: the payments ----
section(localOnly ? "Paying a meta-address (no ENS)" : "Paying alice's name twice");
const payerKey = await fundedKey(local, deployerKey, "ens-payer", parseEther("1"));
const payerAddress = privateKeyToAccount(payerKey).address;
const payer = await connect(local, payerKey);
await mined(local, (await payer.deposit({ amount: parseEther("0.4") })).hash);

const amount = parseEther("0.03");
const first = await payer.payStealth({ metaAddress, amount, announcer });
for (const h of first.handles) await h.wait();
const second_ = await payer.payStealth({ metaAddress, amount, announcer });
for (const h of second_.handles) await h.wait();
const a = first.payment.stealthAddress;
const b = second_.payment.stealthAddress;

check("two payments went to two different addresses", getAddress(a) !== getAddress(b), `${a}, ${b}`);
for (const [label, addr] of [["first", a], ["second", b]] as const) {
  const bal = await balanceOf(local, addr);
  check(`${label} address received the money`, bal > 0n && bal <= amount, `${bal} wei`);
}

const receiptOf = (hash: Hex) => rpc<any>(local.rpc, "eth_getTransactionReceipt", [hash]);
const [ann1, ann2, pay1, pay2] = await Promise.all([receiptOf(first.announceHash), receiptOf(second_.announceHash), receiptOf(first.handles[0].hash), receiptOf(second_.handles[0].hash)]);
check("each announcement came from its own wallet", ann1.from.toLowerCase() !== ann2.from.toLowerCase());
check("the payer's wallet sent neither announcement", ![ann1.from, ann2.from].some((f) => f.toLowerCase() === payerAddress.toLowerCase()));
check("each payment was sent by the pool, not the payer", [pay1, pay2].every((r) => r.from.toLowerCase() === local.pool.toLowerCase()), pay1.from);
const mentions = (r: any, addr: Address) => JSON.stringify(r).toLowerCase().includes(addr.slice(2).toLowerCase());
check("the payer's address appears in no payment or announcement receipt", ![ann1, ann2, pay1, pay2].some((r) => mentions(r, payerAddress)));
check("neither payment's receipt mentions the other address", !mentions(pay1, b) && !mentions(pay2, a));
check("neither address has any history of its own", Number(await rpc(local.rpc, "eth_getTransactionCount", [a, "latest"])) === 0 && Number(await rpc(local.rpc, "eth_getTransactionCount", [b, "latest"])) === 0);

section("Finding them");
const scan = await scanAnnouncements(local.rpc, announcer, aliceKeys, deployBlock);
const found = scan.received.map((r) => getAddress(r.stealthAddress));
check("the recipient finds both payments by scanning", found.includes(getAddress(a)) && found.includes(getAddress(b)), `${scan.received.length} of ${scan.scanned} announcements`);
check("the scan read every block", scan.unreadableBlocks.length === 0, scan.unreadableBlocks.join(","));
const viewOnly = await scanAnnouncements(local.rpc, announcer, { viewingPrivateKey: aliceKeys.viewingPrivateKey, spendingPublicKey: aliceKeys.spendingPublicKey }, deployBlock);
check("the viewing key alone finds them", viewOnly.received.length === scan.received.length);
const strangers = await scanAnnouncements(local.rpc, announcer, stranger, deployBlock);
check("someone else's keys find neither", !strangers.received.some((r) => [getAddress(a), getAddress(b)].includes(getAddress(r.stealthAddress))));

check("the recipient's derived key controls the address", stealthAccount(first.payment.ephemeralPublicKey, aliceKeys).address === getAddress(a));
const spendable = await balanceOf(local, a);
const signer = localSigner(local, stealthPrivateKey(first.payment.ephemeralPublicKey, aliceKeys));
await mined(local, await signer.sendTransaction({ to: "0x000000000000000000000000000000000000dEaD", value: spendable / 2n, data: "0x" }));
check("the recipient can spend from it, paying gas with the money received", (await balanceOf(local, a)) < spendable / 2n + 1n);

console.log(failures ? `\n${failures} FAILED` : `\nall passed${localOnly ? " (local path only: ENS not tested)" : ""}`);
stopWorkers();
process.exit(failures ? 1 : 0);
