import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { capabilityDevPlugin } from "./dev/capabilityDevPlugin.js";
import { nativeScenePlugin } from "./dev/nativeScenePlugin.js";
import { startServer as startAgentGateway, loadEnvFile, DEFAULT_BASE_URL, DEFAULT_MODEL } from "./apps/server/openai-compatible-agent-gateway.mjs";

// URL.pathname stays percent-encoded; fileURLToPath gives Rollup a real path on every OS.
const fromRoot = (relative) => fileURLToPath(new URL(relative, import.meta.url));

function localAgentGatewayPlugin(env) {
  return {
    name: "agentscape-local-agent-gateway",
    apply: "serve",
    configureServer(server) {
      if (process.env.VITEST) return;
      const local = {};
      loadEnvFile(".env.local", local);
      const settings = { ...env, ...local };
      const apiKey = settings.AGENTSCAPE_LLM_API_KEY || settings.AGENTSCAPE_TEST_LLM_API_KEY;
      if (!apiKey) {
        console.warn("[AgentScape] LLM Gateway not started: API key is missing");
        return;
      }
      // Route the same-origin capability API to the local gateway by default.
      if (!process.env.AGENT_ADAPTER_URL) {
        const host = settings.AGENTSCAPE_LLM_HOST || settings.AGENTSCAPE_TEST_LLM_HOST || "127.0.0.1";
        const port = settings.AGENTSCAPE_LLM_PORT || settings.AGENTSCAPE_TEST_LLM_PORT || 8788;
        if (["127.0.0.1", "localhost", "::1"].includes(host) && /^\d+$/.test(String(port)) && Number(port) > 0 && Number(port) <= 65535) {
          process.env.AGENT_ADAPTER_URL = `http://${host === "::1" ? "[::1]" : host}:${port}/agent`;
        }
      }
      const gateway = startAgentGateway({
        baseUrl: settings.AGENTSCAPE_LLM_BASE_URL || settings.AGENTSCAPE_TEST_LLM_BASE_URL || DEFAULT_BASE_URL,
        apiKey,
        model: settings.AGENTSCAPE_LLM_MODEL || settings.AGENTSCAPE_TEST_LLM_MODEL || DEFAULT_MODEL,
        models: settings.AGENTSCAPE_LLM_MODELS || settings.AGENTSCAPE_TEST_LLM_MODELS || undefined,
        host: settings.AGENTSCAPE_LLM_HOST || settings.AGENTSCAPE_TEST_LLM_HOST || "127.0.0.1",
        port: settings.AGENTSCAPE_LLM_PORT || settings.AGENTSCAPE_TEST_LLM_PORT || 8788
      });
      gateway.on("error", (error) => console.error("[AgentScape] LLM Gateway failed:", error.message));
      server.httpServer?.once("close", () => gateway.close());
    }
  };
}

function observatoryRoutePlugin() {
  const redirect = (req, res, next) => {
    const path = req.url?.split("?", 1)[0];
    if (path !== "/observatory" && path !== "/home" && path !== "/starter" && path !== "/studio") return next();
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
        if (pathname === "/studio/" || pathname === "/studio/index.html") {
          req.url = req.url.replace(pathname, "/index.html");
        }
        if (pathname === "/" || pathname === "/index.html") {
          req.url = req.url.replace(pathname, "/apps/spline-home/index.html");
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
        const studio = bundle["index.html"];
        if (studio) {
          delete bundle["index.html"];
          this.emitFile({ type: "asset", fileName: "studio/index.html", source: studio.source });
        }
        const home = bundle["apps/spline-home/index.html"];
        if (home) {
          delete bundle["apps/spline-home/index.html"];
          this.emitFile({ type: "asset", fileName: "home/index.html", source: home.source });
          this.emitFile({ type: "asset", fileName: "index.html", source: home.source });
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
  // .env files take precedence, but inline CI variables must still be visible.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
  Object.assign(process.env, env);
  const devHost = String(env.AGENTSCAPE_DEV_HOST || "127.0.0.1").trim() || "127.0.0.1";
  return {
    base: "/",
    plugins: [nativeScenePlugin({ projectRoots: ['examples/native-scene/project'] }), react(), observatoryRoutePlugin(), capabilityDevPlugin(), localAgentGatewayPlugin(env)],
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
          codeProject: fromRoot('./examples/code-project/index.html'),
          nativeScene: fromRoot('./examples/native-scene/index.html'),
          codeExample: fromRoot('./examples/three-code/index.html'),
          standardThree: fromRoot('./examples/code-project/standard-three/index.html'),
          starter: fromRoot('./apps/starter/index.html'),
          studio: fromRoot('./index.html'),
          observatory: fromRoot('./apps/observatory/index.html'),
          home: fromRoot('./apps/spline-home/index.html')
        }
        // No manualChunks: Rollup splits shared modules per entry automatically,
        // so light pages no longer download the Studio's physics/post-processing stack.
      }
    }
  };
});
