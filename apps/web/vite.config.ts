import { readFileSync, existsSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies to the local stack, so the browser needs no CORS from either node.
const network = process.env.RELAYLESS_NETWORK ?? "local";
const path = `../../config/${network}.deployed.json`;
const cfg = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
const isLocal = /127\.0\.0\.1|localhost/.test(cfg.rpc ?? "");
// ENS screens stay hidden until the directory is deployed, so nothing changes for a stack without one.
const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const ensCfg = readJson(process.env.ENS_CONFIG_PATH ?? "../../config/ens.sepolia.json");
const announcer = readJson("../../config/local.announcer.deployed.json");

export default defineConfig({
  plugins: [react()],
  define: {
    __ENS__: JSON.stringify(ensCfg?.deployBlock ? { cfg: ensCfg, announcer: announcer ? { address: announcer.announcer, deployBlock: announcer.deployBlock } : null } : null),
    __RELAYLESS__: JSON.stringify({
      name: cfg.name ?? network,
      chainId: cfg.chainId,
      pool: cfg.pool,
      walletRpc: cfg.rpc,
      rpc: isLocal ? "/chain" : cfg.rpc,
      mempool: isLocal ? "/mempool" : cfg.mempool,
      explorer: cfg.explorer ?? null,
      feeRange: cfg.feeRange ?? null,
      aspUrl: cfg.aspUrl ? (isLocal ? "/asp" : cfg.aspUrl) : null,
    }),
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.RELAYLESS_WEB_PORT ?? 5199),
    strictPort: true,
    proxy: isLocal
      ? {
          "/chain": { target: cfg.rpc, changeOrigin: true, rewrite: () => "/" },
          "/mempool": { target: cfg.mempool, changeOrigin: true, rewrite: () => "" },
          ...(cfg.aspUrl ? { "/asp": { target: cfg.aspUrl, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/asp/, "") } } : {}),
        }
      : undefined,
  },
  worker: { format: "es" },
  build: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
