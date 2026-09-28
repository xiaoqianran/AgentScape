import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "/",
  plugins: [react()],
  resolve: {
    dedupe: ["three", "react", "react-dom"],
  },
  server: {
    port: 5175,
    strictPort: true,
    host: "127.0.0.1",
  },
  preview: {
    port: 5175,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
