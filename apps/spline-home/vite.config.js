import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// The shared HTML uses absolute /apps/spline-home/... paths for the root build.
// In isolated dev, rewrite that prefix back to this config's root.
function rootPrefixPlugin() {
  const strip = (req, res, next) => {
    if (req.url?.startsWith('/apps/spline-home/')) req.url = req.url.slice('/apps/spline-home'.length);
    next();
  };
  return {
    name: 'spline-home-root-prefix',
    configureServer: (server) => server.middlewares.use(strip),
    configurePreviewServer: (server) => server.middlewares.use(strip)
  };
}

export default defineConfig({
  root,
  base: "/",
  publicDir: path.resolve(root, '../../public'),
  plugins: [react(), rootPrefixPlugin()],
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
