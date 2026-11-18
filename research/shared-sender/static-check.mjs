// Static check: which state-reading opcodes the pool's validator can execute. Validation that reads no state another
// transaction can change can't be mass-invalidated by one state change.
//
// Compiles the generated validator for each profile, takes its deployed runtime, and walks it from pc 0: fall-through,
// plus every JUMPDEST that some PUSH in the code names (the only way solc's Yul output jumps). Bytes the walk never
// reaches, such as data after the code, are not reported. Then it lists every reachable opcode that reads storage,
// balances, code or block fields, or calls out.
// usage: node research/shared-sender/static-check.mjs   (after pnpm build:contracts)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const solc = createRequire(new URL("../../packages/contracts/package.json", import.meta.url))("solc");
const STATE = {
  0x31: "BALANCE", 0x3a: "GASPRICE", 0x3b: "EXTCODESIZE", 0x3c: "EXTCODECOPY", 0x3f: "EXTCODEHASH", 0x40: "BLOCKHASH",
  0x41: "COINBASE", 0x42: "TIMESTAMP", 0x43: "NUMBER", 0x44: "PREVRANDAO", 0x45: "GASLIMIT", 0x47: "SELFBALANCE",
  0x48: "BASEFEE", 0x49: "BLOBHASH", 0x4a: "BLOBBASEFEE", 0x54: "SLOAD", 0x55: "SSTORE", 0x5c: "TLOAD", 0x5d: "TSTORE",
  0xf0: "CREATE", 0xf5: "CREATE2", 0xff: "SELFDESTRUCT",
  0xf1: "CALL", 0xf2: "CALLCODE", 0xf4: "DELEGATECALL", 0xfa: "STATICCALL",
};
const HALT = new Set([0x00, 0x56, 0xf3, 0xfd, 0xfe, 0xff]); // STOP, JUMP, RETURN, REVERT, INVALID, SELFDESTRUCT

function runtimeOf(profile) {
  const source = readFileSync(`packages/contracts/generated/RelaylessValidator.${profile}.yul`, "utf8");
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Yul",
    sources: { "v.yul": { content: source } },
    settings: { optimizer: { enabled: true, runs: 200, details: { yul: true } }, evmVersion: "cancun", outputSelection: { "*": { "*": ["evm.bytecode.object", "evm.deployedBytecode.object"] } } },
  })));
  const c = Object.values(out.contracts["v.yul"])[0];
  const built = JSON.parse(readFileSync(`packages/contracts/generated/validator.${profile}.json`, "utf8")).bytecode;
  if (`0x${c.evm.bytecode.object}` !== built) throw new Error(`${profile}: recompiled bytecode differs from generated/validator.${profile}.json`);
  return Buffer.from(c.evm.deployedBytecode.object, "hex");
}

function analyse(code) {
  const ops = new Map(); // pc -> [op, pushValue]
  for (let pc = 0; pc < code.length; pc++) {
    const op = code[pc];
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      ops.set(pc, [op, BigInt(`0x${code.subarray(pc + 1, pc + 1 + n).toString("hex") || "0"}`)]);
      pc += n;
    } else ops.set(pc, [op, null]);
  }
  const jumpdests = new Set([...ops].filter(([, [op]]) => op === 0x5b).map(([pc]) => pc));
  const targets = new Set([...ops.values()].filter(([, v]) => v !== null && v < BigInt(code.length) && jumpdests.has(Number(v))).map(([, v]) => Number(v)));
  const reached = new Set();
  const queue = [0, ...targets];
  while (queue.length) {
    let pc = queue.pop();
    while (pc < code.length && !reached.has(pc) && ops.has(pc)) {
      reached.add(pc);
      const [op] = ops.get(pc);
      if (HALT.has(op)) break;
      pc += op >= 0x60 && op <= 0x7f ? op - 0x5e : 1;
    }
  }
  const found = {};
  for (const pc of [...reached].sort((a, b) => a - b)) {
    const name = STATE[ops.get(pc)[0]];
    if (name) found[name] = (found[name] ?? 0) + 1;
  }
  const unreachable = code.length - [...reached].reduce((n, pc) => n + (ops.get(pc)[0] >= 0x60 && ops.get(pc)[0] <= 0x7f ? ops.get(pc)[0] - 0x5e : 1), 0);
  return { runtimeBytes: code.length, unreachableBytes: unreachable, reachableStateOrCallOpcodes: found };
}

const out = {};
for (const profile of ["devnet-8421", "hegota-8141"]) out[profile] = analyse(runtimeOf(profile));
console.log(JSON.stringify(out, null, 2));
// What each reachable opcode is for, from the source (packages/contracts/script/gen-validator.mjs):
//  - STATICCALL: the BN254 precompiles 0x06, 0x07 and 0x08 (pure), in the verifier.
//  - GASPRICE and CALL: only in refund(), which runs in the DEFAULT frame after the SENDER frame, never in validation.
