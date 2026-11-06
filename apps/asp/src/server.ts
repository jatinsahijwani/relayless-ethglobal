// usage: RELAYLESS_NETWORK=local-asp pnpm --filter @relayless/asp start
// Reads ../../.env. World ID stays off until WORLD_APP_ID, WORLD_RP_ID and WORLD_SIGNING_KEY are set; the set and the
// public exit still work, and joining answers 503.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AspError, createAsp, emptyState, type AspState } from "./asp.js";
import { liveChain } from "./chain.js";
import { directoryQueue, liveDirectory } from "./directory.js";
import { realWorld } from "./world.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
if (existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export const REPUBLISH_MS = 6 * 60 * 60 * 1000; // Recent roots last about 13.6 hours on a 6 s slot.
const MAX_BODY = 64 * 1024;

async function readBody(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new AspError(413, "too_large", "That request is too large.");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw new AspError(400, "bad_request", "That request isn't valid JSON.");
  }
}

export function handler(asp: ReturnType<typeof createAsp>, allowedOrigin: string | undefined) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (allowedOrigin) {
      res.setHeader("access-control-allow-origin", allowedOrigin);
      res.setHeader("access-control-allow-headers", "content-type");
    }
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const route = `${req.method} ${(req.url ?? "").split("?")[0]}`;
      if (req.method === "OPTIONS") return send(204, {});
      if (route === "GET /config") return send(200, asp.config());
      if (route === "GET /set") return send(200, await asp.set());
      if (route === "POST /rp-context") return send(200, asp.rpContext());
      if (route === "POST /join") return send(200, await asp.join(await readBody(req)));
      if (route === "POST /allow") return send(200, await asp.allow(await readBody(req)));
      return send(404, { error: "not_found", message: "No such route." });
    } catch (e) {
      if (e instanceof AspError) return send(e.status, { error: e.code, message: e.message });
      console.error(e);
      return send(500, { error: "internal", message: "Something went wrong on the server. Nothing was approved." });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const network = process.env.RELAYLESS_NETWORK ?? "local-asp";
  const cfg = JSON.parse(readFileSync(join(root, `config/${network}.deployed.json`), "utf8"));
  if (!process.env.ASP_KEY) throw new Error("set ASP_KEY");
  const statePath = join(root, `.relayless/asp-${network}.json`);
  const state: AspState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : emptyState();
  const { WORLD_APP_ID, WORLD_RP_ID, WORLD_SIGNING_KEY } = process.env;
  const action = process.env.WORLD_ACTION ?? "join-approved-set";
  const environment = process.env.WORLD_ENVIRONMENT ?? "production";
  const world = WORLD_APP_ID && WORLD_RP_ID && WORLD_SIGNING_KEY ? realWorld({ rpId: WORLD_RP_ID, signingKey: WORLD_SIGNING_KEY, action, environment }) : null;
  // Off unless this ASP has a name in the directory. The approved set works the same either way.
  const ensLabel = process.env.ASP_ENS_LABEL;
  const directory = ensLabel ? directoryQueue(liveDirectory(JSON.parse(readFileSync(join(root, "config/ens.sepolia.json"), "utf8")), ensLabel, process.env.ASP_KEY as Hex), (e) => console.error("publishing to ENS failed; the approved set isn't affected", e)) : undefined;
  // Catches up after a restart, or a publish that failed. Costs nothing if ENS already has this root.
  if (directory && state.ref) directory.publish({ root: state.ref.root, slot: BigInt(state.ref.slot) });
  const asp = createAsp({
    directory,
    pool: cfg.pool,
    action,
    environment,
    appId: WORLD_APP_ID ?? null,
    world,
    allowlistOperator: process.env.ASP_ALLOWLIST === "1" ? privateKeyToAccount(process.env.ASP_KEY as Hex).address : undefined,
    chain: liveChain(cfg, process.env.ASP_KEY as Hex),
    state,
    save(s) {
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, JSON.stringify(s, null, 2));
    },
  });
  // A restart must not leave an old root to expire: the timer below only fires 6 hours from now.
  if (state.ref) asp.republish().catch((e) => console.error("republish failed", e));
  setInterval(() => asp.republish().catch((e) => console.error("republish failed", e)), REPUBLISH_MS);
  const port = Number(process.env.ASP_PORT ?? 8790);
  createServer(handler(asp, process.env.ASP_ALLOWED_ORIGIN)).listen(port, "127.0.0.1", () => console.log(`ASP on http://127.0.0.1:${port}, World ID ${world ? `on (${environment})` : "off: WORLD_* not set"}`));
}
