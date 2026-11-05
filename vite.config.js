import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { capabilityDevPlugin } from "./dev/capabilityDevPlugin.js";

function observatoryRoutePlugin() {
  const redirect = (req, res, next) => {
    const path = req.url?.split("?", 1)[0];
    if (path !== "/observatory" && path !== "/home" && path !== "/starter") return next();
    const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.statusCode = 308;
    res.setHeader("Location", `${path}/${query}`);
    res.end();
  };
  return {
    name: "observatory-route",
    enforce: "post",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split("?", 1)[0];
        if (pathname === "/starter/" || pathname === "/starter/index.html") {
          req.url = req.url.replace(pathname, "/apps/starter/index.html");
        }
        if (pathname === "/home/" || pathname === "/home/index.html") {
          req.url = req.url.replace(pathname, "/apps/spline-home/index.html");
        }
        if (pathname === "/observatory/" || pathname === "/observatory/index.html") {
          req.url = req.url.replace(pathname, "/apps/observatory/index.html");
        }
        redirect(req, res, next);
      });
    },
    configurePreviewServer(server) { server.middlewares.use(redirect); },
    generateBundle: {
      order: "post",
      handler(_, bundle) {
        const starter = bundle["apps/starter/index.html"];
        if (starter) {
          delete bundle["apps/starter/index.html"];
          this.emitFile({ type: "asset", fileName: "starter/index.html", source: starter.source });
        }
        const home = bundle["apps/spline-home/index.html"];
        if (home) {
          delete bundle["apps/spline-home/index.html"];
          this.emitFile({ type: "asset", fileName: "home/index.html", source: home.source });
        }
        const entry = bundle["apps/observatory/index.html"];
        if (entry) {
          delete bundle["apps/observatory/index.html"];
          this.emitFile({ type: "asset", fileName: "observatory/index.html", source: entry.source });
        }
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);
  const devHost = String(env.AGENTSCAPE_DEV_HOST || "127.0.0.1").trim() || "127.0.0.1";
  return {
    base: "/",
    plugins: [react(), observatoryRoutePlugin(), capabilityDevPlugin()],
    test: {
      include: ["tests/**/*.test.js"],
      // Physics/WASM world fixtures each own native resources; cap concurrent
      // workers so desktop and CI runs do not compete with dozens of runtimes.
      maxWorkers: 4
    },
    server: {
      host: devHost,
      allowedHosts: true,
      watch: {
        ignored: ["**/.venv/**", "**/__pycache__/**", "**/.git/**", "**/dist/**"]
      }
    },
    preview: {
      host: devHost,
      allowedHosts: true
    },
    build: {
      rollupOptions: {
        input: {
          codeExample: new URL('./examples/three-code/index.html', import.meta.url).pathname,
          starter: new URL("./apps/starter/index.html", import.meta.url).pathname,
          studio: new URL("./index.html", import.meta.url).pathname,
          observatory: new URL("./apps/observatory/index.html", import.meta.url).pathname,
          home: new URL("./apps/spline-home/index.html", import.meta.url).pathname
        },
        output: {
          manualChunks(id) {
            if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/") || id.includes("/node_modules/scheduler/") || id.includes("/node_modules/zustand/")) return "studio-react";
            if (id.includes("@dimforge/rapier3d-compat")) return "physics";
            if (id.includes("/three/")) return "three";
          }
        }
      }
    }
  };
});
