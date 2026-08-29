import { describe, expect, it, vi } from "vitest";
import { createCapabilityDevMiddleware } from "../../tooling/dev/capabilityDevPlugin.js";

function responseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    body: Buffer.alloc(0),
    headersSent: false,
    writableEnded: false,
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = String(value); },
    end(value = "") {
      this.body = Buffer.isBuffer(value) ? value : Buffer.from(value);
      this.headersSent = true;
      this.writableEnded = true;
    }
  };
}

describe("Vite capability dev control plane", () => {
  it("executes the same capability status handler used by deployment", async () => {
    const middleware = createCapabilityDevMiddleware();
    const res = responseRecorder();
    const next = vi.fn();
    await middleware({ method: "GET", url: "/api/capabilities", headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(res.body.toString())).toHaveProperty("capabilities.agent.available");
  });

  it("passes unrelated routes through to Vite", async () => {
    const middleware = createCapabilityDevMiddleware();
    const res = responseRecorder();
    const next = vi.fn();
    await middleware({ method: "GET", url: "/studio/main.js", headers: {} }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.writableEnded).toBe(false);
  });
});
