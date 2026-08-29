import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { AgentToolsScenarioContext } from "../../observatory/labs/agent/AgentToolsScenarioContext.js";
import { agentToolsScenarios } from "../../observatory/labs/agent/scenarios/index.js";

const createContext = async () => new AgentToolsScenarioContext({ scene: new THREE.Scene() }).init();

describe("Observatory AgentTools scenarios", () => {
  for (const scenario of agentToolsScenarios) {
    it(`${scenario.id} executes through production AgentTools and domain skills`, async () => {
      const ctx = await createContext();
      await scenario.setup(ctx);
      const debug = ctx.debugSnapshot();
      const assertions = scenario.assertions(ctx);
      expect(debug).toMatchObject({ schemaVersion: 1, source: "agent-tools" });
      expect(debug.lastTool?.name).toBeTruthy();
      expect(debug.toolCalls.length).toBeGreaterThan(0);
      expect(assertions.filter((item) => item.status !== "pending" && item.pass === false)).toEqual([]);
      ctx.dispose();
    });
  }

  it("keeps read-only spatial tools non-mutating", async () => {
    const ctx = await createContext();
    await ctx.world.addAsset({ id: "table", assetId: "table", position: [0, 0, 0] });
    const result = await ctx.call("getBounds", { id: "table" });
    const policy = ctx.registry.executionPolicy("getBounds", result);
    expect(policy).toMatchObject({ mutates: false, barrier: false, batchAcceptable: true });
    expect(policy.outcome.state).toBe("accepted");
    ctx.dispose();
  });

  it("classifies verified dropHeld as a mutating barrier", async () => {
    const scenario = agentToolsScenarios.find((item) => item.id === "agent.tool.drop-held");
    const ctx = await createContext();
    await scenario.setup(ctx);
    expect(ctx.transition.dropPolicy).toMatchObject({
      mutates: true,
      barrier: true,
      batchable: false,
      batchAcceptable: true,
      outcome: { state: "verified", verified: true, status: "dropped" }
    });
    expect(ctx.transition.after).toMatchObject({ status: "empty", actorId: "agent" });
    ctx.dispose();
  });
});
