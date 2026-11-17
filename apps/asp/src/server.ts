// usage: RELAYLESS_NETWORK=local-asp pnpm --filter @relayless/asp start
// Reads ../../.env. ASP_KEY both signs approvals and writes the set's root, so the pool must name its source.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AspError, createAsp, emptyState, type AspState } from "./asp.js";
import { aspSourceOf, liveChain } from "./chain.js";

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
  // Approvals belong to one pool, so a redeployed pool starts clean instead of inheriting another pool's state.
  const statePath = join(root, `.relayless/asp-${network}-${String(cfg.pool).toLowerCase()}.json`);
  const state: AspState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : emptyState();
  if (!Array.isArray(state.approved)) throw new Error(`${statePath} is from an older ASP version: move it aside and approve again`);
  const operator = privateKeyToAccount(process.env.ASP_KEY as Hex).address;
  const sourceId = aspSourceOf(operator);
  if (cfg.aspSourceId && cfg.aspSourceId.toLowerCase() !== sourceId.toLowerCase()) throw new Error(`the pool accepts roots from ${cfg.aspSourceId}, and ASP_KEY writes them as ${sourceId}`);
  const asp = createAsp({
    pool: cfg.pool,
    operator,
    sourceId,
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
  createServer(handler(asp, process.env.ASP_ALLOWED_ORIGIN)).listen(port, "127.0.0.1", () => console.log(`allowlist ASP on http://127.0.0.1:${port}, operator ${operator}, source ${sourceId}`));
}
