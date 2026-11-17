// Generates and compiles the validator: the VERIFY-frame code of the pool, with both verifying keys hardcoded.
// One validator per spec profile (see PROFILES below and packages/sdk/src/profiles.ts): the profiles differ in where
// the recent roots come from and so in every frame index after them. Everything else is shared.
//
// It is hand-written Yul rather than the snarkjs Solidity template because:
//   - vanilla Solidity cannot emit the frame opcodes (Yul can, through `verbatim`);
//   - the template's `staticcall(sub(gas(), 2000), ...)` is rejected by the mempool rules (GAS must directly precede a
//     *CALL, measured in the Phase 0 spike), while `staticcall(gas(), ...)` is admitted.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak_256 } from "./keccak.mjs";

const require = createRequire(import.meta.url);
const solc = require("solc");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vk = (name) => JSON.parse(readFileSync(join(root, `../circuits/build/${name}.vk.json`), "utf8"));
const sel = (sig) => `0x${keccak_256(sig).slice(0, 8)}`;

const R = "21888242871839275222246405745257275088548364400416034343698204186575808495617";
const Q = "21888242871839275222246405745257275088696311157297823662689037894645226208583";
export const WITHDRAW_SIG = "withdraw(address,uint256,uint256,uint256,uint256,uint256)";
export const RAGEQUIT_SIG = "ragequit(uint256,uint256,uint256,uint256)";
export const REFUND_SIG = "refund()";

// Memory: 0x80 public inputs (for a withdrawal, first the 7 statement values, then the 3 compressed signals),
// 0x180 vk_x, 0x200 ec scratch, 0x300 proof (and a withdrawal's beta at 0x400), 0x400 pairing input.
function g2(p) {
  return [p[0][1], p[0][0], p[1][1], p[1][0]];
}

function verifierBody(key) {
  const ics = key.IC.slice(1).map((pt, i) => `acc(${pt[0]}, ${pt[1]}, mload(${0x80 + i * 32}))`).join("\n          ");
  const put = (start, vals) => vals.map((v, i) => `mstore(${0x400 + start + i * 32}, ${v})`).join("\n          ");
  return `
          mstore(0x180, ${key.IC[0][0]})
          mstore(0x1a0, ${key.IC[0][1]})
          ${ics}
          mstore(0x400, mload(0x300))
          mstore(0x420, mod(sub(${Q}, mod(mload(0x320), ${Q})), ${Q}))
          mcopy(0x440, 0x340, 128)
          ${put(192, [key.vk_alpha_1[0], key.vk_alpha_1[1], ...g2(key.vk_beta_2)])}
          mstore(${0x400 + 384}, mload(0x180))
          mstore(${0x400 + 416}, mload(0x1a0))
          ${put(448, g2(key.vk_gamma_2))}
          mcopy(${0x400 + 576}, 0x3c0, 64)
          ${put(640, g2(key.vk_delta_2))}
          mstore(0, 0)
          need(staticcall(gas(), 8, 0x400, 768, 0, 32))
          need(eq(mload(0), 1))`;
}

// The two profiles this generator emits. `rootFrame`: the EIP-8272 roots arrive in a VERIFY frame to the recent-root
// contract at index 0 (current text), instead of an envelope field read with RECENTROOTREFLOAD (devnet-8421).
export const PROFILES = {
  "devnet-8421": { rootFrame: false, recentRoot: "0x0000000000000000000000000000000000008272", refundOverhead: 150000 },
  "hegota-8141": { rootFrame: true, recentRoot: "0x0000000000000000000000000000000000008272", refundOverhead: 150000 },
};

// How each profile reads the i-th root reference's source and root, and checks how many there are.
function rootReads(profile) {
  if (!profile.rootFrame) {
    return {
      source: (i) => `rootref(${i}, 0)`,
      root: (i) => `rootref(${i}, 2)`,
      count: (n) => `need(eq(txparam(0x11), ${n}))`,
      frameChecks: "",
    };
  }
  // Frame 0 is EIP-8272's verifier frame: identified as the spec does (resolved target, VERIFY, zero flags, zero value,
  // zero state limit), and it succeeded, so every tuple in it is stored and recent. Tuples are 72 bytes:
  // source_id (32) || uint64_be(slot) (8) || root (32).
  return {
    source: (i) => `framedata(${i * 72}, 0)`,
    root: (i) => `framedata(${i * 72 + 40}, 0)`,
    count: (n) => `need(eq(frameparam(0, 4), ${n * 72}))`,
    frameChecks: `
        need(eq(frameparam(0, 0), ${profile.recentRoot}))
        need(eq(frameparam(0, 2), 1))
        need(iszero(frameparam(0, 3)))
        need(iszero(frameparam(0, 8)))
        need(iszero(frameparam(0, 9)))
        need(eq(frameparam(0, 5), 1))`,
  };
}

function validatorYul({ profile, rootSalt, minExec, minState, feeRange }) {
  const r = rootReads(profile);
  // Frame indices: the pool's VERIFY frame, the SENDER frame and the optional refund, after the root frame if any.
  const V = profile.rootFrame ? 1 : 0;
  const S = V + 1;
  const D = V + 2;
  const usedBy = (f) => `add(frameparam(${f}, 10), frameparam(${f}, 11))`;
  const usedSum = Array.from({ length: S + 1 }, (_, f) => usedBy(f)).reduce((a, b) => `add(${a}, ${b})`);
  // Optional. A fixed range for the max fee bounds how many fee-bump replacements one note can make, because a
  // replacement must raise it by 10% each time. See docs/reputation-analysis.md for the trade-off.
  const feeRangeChecks = feeRange
    ? `need(iszero(lt(txparam(0x04), ${feeRange.min})))
        need(iszero(gt(txparam(0x04), ${feeRange.max})))`
    : "";
  const w = vk("withdraw");
  const q = vk("ragequit");
  // The withdrawal statement is compressed (eprint 2025/1500): [beta, gamma, alpha]. The ragequit's 5 are not.
  if (w.nPublic !== 3 || q.nPublic !== 5) throw new Error("public inputs changed: update the validator");
  // gamma = x0 + x1*s + ... + x6*s^6 mod r by Horner, over the statement at 0x80..0x140.
  const horner = Array.from({ length: 7 }, (_, j) => 6 - j)
    .map((i) => `g := addmod(mulmod(g, s, ${R}), mload(${0x80 + i * 32}), ${R})`)
    .join("\n          ");
  return `
object "RelaylessValidator" {
  code {
    datacopy(0, dataoffset("runtime"), datasize("runtime"))
    return(0, datasize("runtime"))
  }
  object "runtime" {
    code {
      // Runs by DELEGATECALL from the pool, so address() is the pool. Reads no storage on any path.
      switch calldataload(0)
      case 0 { validate(calldataload(32)) }
      case 1 { refund() }
      default { revert(0, 0) }

      function txparam(i) -> v { v := verbatim_1i_1o(hex"b0", i) }
      function framedata(offset, frame) -> v { v := verbatim_2i_1o(hex"b1", offset, frame) }
      function frameparam(frame, p) -> v { v := verbatim_2i_1o(hex"b3", frame, p) }
      function sigparam(s, p) -> v { v := verbatim_2i_1o(hex"b4", s, p) }
      function rootref(i, f) -> v { v := verbatim_2i_1o(hex"b6", f, i) }
      function need(ok) { if iszero(ok) { revert(0, 0) } }
      function field(v) { if iszero(lt(v, ${R})) { revert(0, 0) } }
      function acc(x, y, s) {
        mstore(0x200, x)
        mstore(0x220, y)
        mstore(0x240, s)
        need(staticcall(gas(), 7, 0x200, 96, 0x200, 64))
        mstore(0x240, mload(0x180))
        mstore(0x260, mload(0x1a0))
        need(staticcall(gas(), 6, 0x200, 128, 0x180, 64))
      }

      function validate(aspSource) {
        // This frame must belong to a transaction the pool itself sends. Without this check a stranger's transaction
        // could name the pool as its payer.
        need(eq(txparam(0x02), address()))
        need(eq(txparam(0x0A), ${V}))
        need(eq(frameparam(${V}, 2), 1))
${r.frameChecks}

        ${feeRangeChecks}

        // Exactly one ARBITRARY signature: the proof, 256 bytes, plus beta for a withdrawal. Extra entries would cost the
        // payer calldata gas.
        need(eq(txparam(0x07), 0))
        need(eq(txparam(0x0B), 1))
        need(eq(sigparam(0, 0x01), 0))

        // One nonce key, first use: consumed by APPROVE, so this is what stops a double spend.
        need(eq(txparam(0x0E), 1))
        need(eq(txparam(0x01), 0))
        let nullifierHash := txparam(0x10)
        need(nullifierHash)
        field(nullifierHash)

        // The root comes from a reference the protocol has already checked; here we check whose it is.
        mstore(0, shl(96, address()))
        mstore(20, ${rootSalt})
        need(eq(${r.source(0)}, keccak256(0, 52)))
        let rootCommit := ${r.root(0)}
        field(rootCommit)

        // Frame ${S} is a SENDER call to the pool itself, moving no value at top level, with enough gas that the note
        // cannot be burned by a too-small limit.
        need(eq(frameparam(${S}, 2), 2))
        need(eq(frameparam(${S}, 0), address()))
        need(iszero(frameparam(${S}, 3)))
        need(iszero(frameparam(${S}, 8)))
        need(iszero(lt(frameparam(${S}, 1), ${minExec})))
        need(iszero(lt(frameparam(${S}, 9), ${minState})))

        let selector := shr(224, framedata(0, ${S}))
        let amount
        let fee
        switch selector
        case ${sel(WITHDRAW_SIG)} {
          need(eq(frameparam(${S}, 4), 196))
          need(eq(sigparam(0, 0x03), 288))
          let frames := txparam(0x09)
          switch frames
          case ${S + 1} {}
          case ${D + 1} {
            // Optional refund: a DEFAULT frame calling refund() on the pool. The approval scope bits must be clear.
            need(iszero(frameparam(${D}, 2)))
            need(eq(frameparam(${D}, 0), address()))
            need(iszero(frameparam(${D}, 3)))
            need(iszero(frameparam(${D}, 8)))
            need(eq(frameparam(${D}, 4), 4))
            need(eq(shr(224, framedata(0, ${D})), ${sel(REFUND_SIG)}))
          }
          default { revert(0, 0) }

          need(iszero(shr(160, framedata(4, ${S}))))
          amount := framedata(36, ${S})
          fee := framedata(68, ${S})
          let change := framedata(100, ${S})
          let k := framedata(164, ${S})
          need(eq(framedata(132, ${S}), nullifierHash))
          // Each must be a canonical field element. The verifier never sees these values, only their compression, and an
          // aliased value (x + r) gives a new alpha for the same field element, so a proof for it verifies: amount + r
          // would pay out a fortune, and nullifierHash + r would be a fresh nonce key for a spent note.
          field(amount)
          need(change)
          field(change)
          field(k)

          let aspRoot := 0
          switch aspSource
          case 0 { ${r.count(1)} }
          default {
            ${r.count(2)}
            need(eq(${r.source(1)}, aspSource))
            aspRoot := ${r.root(1)}
            need(aspRoot)
            field(aspRoot)
          }

          mstore(0x80, rootCommit)
          mstore(0xa0, nullifierHash)
          mstore(0xc0, change)
          mstore(0xe0, amount)
          mstore(0x100, mod(txparam(0x08), ${R}))
          mstore(0x120, k)
          mstore(0x140, aspRoot)
          checkFees(amount, fee)
          verbatim_4i_0o(hex"b5", 0x300, 0, 288, 0)

          // Compression: alpha from what this transaction carries, beta from after the proof, then gamma.
          let alpha := mod(keccak256(0x80, 224), ${R})
          let beta := mload(0x400)
          field(beta)
          let s := addmod(alpha, beta, ${R})
          let g := 0
          ${horner}
          mstore(0x80, beta)
          mstore(0xa0, g)
          mstore(0xc0, alpha)
          verifyWithdraw()
        }
        case ${sel(RAGEQUIT_SIG)} {
          need(eq(frameparam(${S}, 4), 132))
          need(eq(sigparam(0, 0x03), 256))
          need(eq(txparam(0x09), ${S + 1}))
          ${r.count(1)}
          let label := framedata(4, ${S})
          amount := framedata(36, ${S})
          fee := framedata(68, ${S})
          need(eq(framedata(100, ${S}), nullifierHash))
          field(label)
          field(amount)

          mstore(0x80, rootCommit)
          mstore(0xa0, nullifierHash)
          mstore(0xc0, label)
          mstore(0xe0, amount)
          mstore(0x100, mod(txparam(0x08), ${R}))
          checkFees(amount, fee)
          verbatim_4i_0o(hex"b5", 0x300, 0, 256, 0)
          verifyRagequit()
        }
        default { revert(0, 0) }

        // Approve execution and payment. Consumes the nonce key atomically with the payment.
        verbatim_3i_0o(hex"aa", 0, 0, 3)
      }

      // The pool's balance belongs to everyone, so the most this transaction can cost must come out of this note.
      function checkFees(amount, fee) {
        need(iszero(gt(fee, amount)))
        need(iszero(gt(txparam(0x06), fee)))
      }

      function verifyWithdraw() {${verifierBody(w)}
      }

      function verifyRagequit() {${verifierBody(q)}
      }

      // Frame ${D} of a withdrawal: hand back the fee that gas did not use. The refund overhead covers what FRAMEPARAM
      // cannot see (intrinsic gas and this frame), rounded up: an underestimate would be paid by the other depositors.
      function refund() {
        need(eq(caller(), 0xaa))
        need(eq(txparam(0x02), address()))
        need(eq(txparam(0x0A), ${D}))
        need(eq(frameparam(${S}, 5), 1))
        let used := add(${usedSum}, ${profile.refundOverhead})
        let cost := mul(used, gasprice())
        let fee := framedata(68, ${S})
        // A recipient that refuses simply forgoes the refund, which stays in the reserve. Bounded gas, nothing copied.
        if gt(fee, cost) { pop(call(100000, framedata(4, ${S}), sub(fee, cost), 0, 0, 0, 0)) }
      }
    }
  }
}`;
}

// Off by default. To turn it on: RELAYLESS_FEE_RANGE=<min wei>:<max wei>, for example 1000000000:8000000000, which
// allows at most log1.1(8) = about 22 replacements per note.
function parseFeeRange(value) {
  if (!value) return null;
  const m = /^(\d+):(\d+)$/.exec(value);
  if (!m || BigInt(m[1]) === 0n || BigInt(m[1]) >= BigInt(m[2])) throw new Error("RELAYLESS_FEE_RANGE must be <min wei>:<max wei>, with 0 < min < max");
  return { min: m[1], max: m[2] };
}

// The SENDER frame's minimum limits. Running out of either after APPROVE would burn the note, so they cover the worst
// case with room to spare. Measured in docs/gas-report.md, per profile.
const MIN_SENDER_EXEC = 1_500_000;
const MIN_SENDER_STATE = 1_000_000;
const rootSalt = `0x${keccak_256("relayless.root")}`;

function build(name, feeRange) {
  const profile = PROFILES[name];
  const source = validatorYul({ profile, rootSalt, minExec: MIN_SENDER_EXEC, minState: MIN_SENDER_STATE, feeRange });
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Yul",
        sources: { "RelaylessValidator.yul": { content: source } },
        settings: { optimizer: { enabled: true, runs: 200, details: { yul: true } }, evmVersion: "cancun", outputSelection: { "*": { "*": ["evm.bytecode.object", "evm.deployedBytecode.object"] } } },
      }),
    ),
  );
  for (const e of out.errors ?? []) if (e.severity === "error") throw new Error(e.formattedMessage);
  const compiled = Object.values(out.contracts["RelaylessValidator.yul"])[0];
  return {
    source,
    json: {
      profile: name,
      bytecode: `0x${compiled.evm.bytecode.object}`,
      rootSalt,
      recentRoot: profile.recentRoot,
      minSenderExec: MIN_SENDER_EXEC,
      minSenderState: MIN_SENDER_STATE,
      refundOverhead: profile.refundOverhead,
      feeRange,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const feeRange = parseFeeRange(process.env.RELAYLESS_FEE_RANGE);
  const names = process.argv[2] ? [process.argv[2]] : Object.keys(PROFILES);
  const dir = join(root, "generated");
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    if (!PROFILES[name]) throw new Error(`unknown profile ${name}: one of ${Object.keys(PROFILES).join(", ")}`);
    const { source, json } = build(name, feeRange);
    writeFileSync(join(dir, `RelaylessValidator.${name}.yul`), source);
    writeFileSync(join(dir, `validator.${name}.json`), JSON.stringify(json, null, 2));
    console.log(`validator ${name}: ${(json.bytecode.length - 2) / 2} bytes, fee range ${feeRange ? `${feeRange.min}:${feeRange.max}` : "off"}`);
  }
}
