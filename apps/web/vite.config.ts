import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../..");

export default defineConfig({
  root: dir,
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": dir,
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    fs: { allow: [repoRoot] },
  },
  preview: {
    host: "127.0.0.1",
    port: 3000,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
