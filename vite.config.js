import { defineConfig } from "vite";
import { capabilityDevPlugin } from "./tooling/dev/capabilityDevPlugin.js";

function observatoryRoutePlugin() {
  const redirect = (req, res, next) => {
    const path = req.url?.split("?", 1)[0];
    if (path !== "/observatory") return next();
    const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.statusCode = 308;
    res.setHeader("Location", `/observatory/${query}`);
    res.end();
  };
  return {
    name: "observatory-route",
    configureServer(server) { server.middlewares.use(redirect); },
    configurePreviewServer(server) { server.middlewares.use(redirect); }
  };
}

export default defineConfig({
  base: "/",
  plugins: [observatoryRoutePlugin(), capabilityDevPlugin()],
  test: {
    include: ["tests/**/*.test.js"]
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    watch: {
      ignored: ["**/.venv/**", "**/__pycache__/**", "**/.git/**", "**/dist/**"]
    }
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true
  },
  build: {
    rollupOptions: {
      input: {
        studio: new URL("./index.html", import.meta.url).pathname,
        observatory: new URL("./observatory/index.html", import.meta.url).pathname
      },
      output: {
        manualChunks(id) {
          if (id.includes("@dimforge/rapier3d-compat")) return "physics";
          if (id.includes("/three/")) return "three";
        }
      }
    }
  }
});
