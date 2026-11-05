import { readFileSync, existsSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies to the local stack, so the browser needs no CORS from either node.
const network = process.env.RELAYLESS_NETWORK ?? "local";
const path = `../../config/${network}.deployed.json`;
const cfg = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
const isLocal = /127\.0\.0\.1|localhost/.test(cfg.rpc ?? "");

export default defineConfig({
  plugins: [react()],
  define: {
    __RELAYLESS__: JSON.stringify({
      name: cfg.name ?? network,
      chainId: cfg.chainId,
      pool: cfg.pool,
      walletRpc: cfg.rpc,
      rpc: isLocal ? "/chain" : cfg.rpc,
      mempool: isLocal ? "/mempool" : cfg.mempool,
      explorer: cfg.explorer ?? null,
      feeRange: cfg.feeRange ?? null,
    }),
  },
  server: {
    host: "127.0.0.1",
    port: 5199,
    strictPort: true,
    proxy: isLocal
      ? {
          "/chain": { target: cfg.rpc, changeOrigin: true, rewrite: () => "/" },
          "/mempool": { target: cfg.mempool, changeOrigin: true, rewrite: () => "" },
        }
      : undefined,
  },
  worker: { format: "es" },
  build: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
