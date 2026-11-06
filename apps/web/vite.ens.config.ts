// The public static demo. Unlike vite.config.ts it needs no circuits, no local chain and no proxy.
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const cfg = JSON.parse(readFileSync("../../config/ens.sepolia.json", "utf8"));

export default defineConfig({
  plugins: [react()],
  define: { __ENS__: JSON.stringify(cfg.deployBlock ? { cfg, announcer: null } : null) },
  // public/ holds the proving keys, which this page has no use for.
  publicDir: false,
  build: { outDir: "dist-ens", target: "es2022", rollupOptions: { input: "ens.html" } },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
