import capabilityIndex from "../../api/capabilities/index.js";
import agentCapability from "../../api/capabilities/agent.js";
import assetCompileCapability from "../../api/capabilities/asset-compile.js";

export const DEV_CAPABILITY_ROUTES = new Map([
  ["/api/capabilities", capabilityIndex],
  ["/api/capabilities/agent", agentCapability],
  ["/api/capabilities/asset-compile", assetCompileCapability]
]);

export function createCapabilityDevMiddleware({ routes = DEV_CAPABILITY_ROUTES } = {}) {
  return async function capabilityDevMiddleware(req, res, next) {
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname.replace(/\/$/, "") || "/";
    const handler = routes.get(pathname);
    if (!handler) return next();
    try {
      await handler(req, res);
    } catch {
      if (res.headersSent || res.writableEnded) return;
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify({ code: "DEV_CAPABILITY_HANDLER_FAILED" }));
    }
  };
}

export function capabilityDevPlugin() {
  return {
    name: "agentscape-capability-dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(createCapabilityDevMiddleware());
    }
  };
}
