import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Normal build goes straight into the Python package so `uv run mlcompare` serves it.
// `--mode demo` builds a single static bundle with an in-browser fake API.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    outDir: "../src/mlcompare/static",
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
    rollupOptions: mode === "demo" ? { output: { inlineDynamicImports: true } } : {},
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8765" },
  },
}));
