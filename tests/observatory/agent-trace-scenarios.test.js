import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ToolCallingAgentScenarioContext } from "../../observatory/labs/agent/ToolCallingAgentScenarioContext.js";
import { agentTraceScenarios } from "../../observatory/labs/agent/scenarios/traceIndex.js";

const createContext = async () => new ToolCallingAgentScenarioContext({ scene: new THREE.Scene() }).init();

describe("Observatory ToolCallingAgent trace scenarios", () => {
  for (const scenario of agentTraceScenarios) {
    it(`${scenario.id} executes deterministic production orchestration`, async () => {
      const ctx = await createContext();
      await scenario.setup(ctx);
      const debug = ctx.debugSnapshot();
      const assertions = scenario.assertions(ctx);

      expect(debug).toMatchObject({ schemaVersion: 1, source: "tool-calling-agent" });
      expect(debug.agent).toBeTruthy();
      expect(debug.gateway.requests.length).toBeGreaterThanOrEqual(2);
      expect(debug.gateway.responses.length).toBe(debug.gateway.requests.length);
      expect(assertions.filter((item) => item.status !== "pending" && item.pass === false)).toEqual([]);
      ctx.dispose();
    });
  }

  it("keeps a read-only getBounds trace mutation-free", async () => {
    const scenario = agentTraceScenarios.find((item) => item.id === "agent.trace.read-tool");
    const ctx = await createContext();
    await scenario.setup(ctx);

    expect(ctx.agentResult).toMatchObject({
      taskStatus: "no-mutation",
      steps: 2,
      message: "table bounds checked"
    });
    expect(ctx.agentResult.execution.some((entry) => entry.tool === "getBounds" && entry.executed === true)).toBe(true);
    expect(ctx.agentResult.lastMutation).toBeNull();
    expect(ctx.sequenceEvents.some((event) => event.mutates === true)).toBe(false);
    ctx.dispose();
  });

  it("forces a fresh planning round after verified dropHeld mutation", async () => {
    const scenario = agentTraceScenarios.find((item) => item.id === "agent.trace.verified-mutation");
    const ctx = await createContext();
    await scenario.setup(ctx);

    expect(ctx.agentResult).toMatchObject({
      taskStatus: "completed",
      steps: 2,
      message: "cup dropped and settled",
      lastMutation: {
        tool: "dropHeld",
        outcome: { state: "verified", verified: true, status: "dropped" }
      }
    });
    expect(ctx.agentResult.unresolvedMutations).toEqual([]);
    expect(ctx.gatewayRequests).toHaveLength(2);
    expect(ctx.sequenceEvents.some((event) => (
      event.tool === "dropHeld"
      && event.executed === true
      && event.mutates === true
      && event.barrier === true
      && event.replanRequired === true
    ))).toBe(true);
    expect(ctx.transition.carry).toMatchObject({ status: "empty", actorId: "agent" });
    ctx.dispose();
  });
});
