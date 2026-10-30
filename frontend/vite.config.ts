import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds straight into the Python package so `uv run mlcompare` serves it.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../src/mlcompare/static",
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8765" },
  },
});
