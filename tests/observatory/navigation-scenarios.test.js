import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { NavigationScenarioContext } from "../../observatory/labs/navigation/NavigationScenarioContext.js";
import { navigationScenarios } from "../../observatory/labs/navigation/scenarios/index.js";

const createContext = async () => new NavigationScenarioContext({ scene: new THREE.Scene() }).init();

describe("Observatory Navigation scenarios", () => {
  for (const scenario of navigationScenarios) {
    it(`${scenario.id} uses production Recast navigation truth`, async () => {
      const ctx = await createContext();
      await scenario.setup(ctx);
      const debug = ctx.debugSnapshot();
      const assertions = scenario.assertions(ctx);

      expect(debug).toMatchObject({ schemaVersion: 1, source: "navigation" });
      expect(debug.status.backend.identity).toBe("recast-detour");
      expect(debug.build.success).toBe(true);
      expect(debug.navMesh.vertexCount).toBeGreaterThan(0);
      expect(debug.navMesh.triangleCount).toBeGreaterThan(0);
      expect(debug.navMesh.indices.length).toBeGreaterThan(0);
      expect(assertions.filter((item) => item.status !== "pending" && item.pass === false)).toEqual([]);
      ctx.dispose();
    });
  }

  it("keeps the legacy debugGeometry positions contract while exposing indexed debug mesh", async () => {
    const scenario = navigationScenarios.find((item) => item.id === "navigation.path.simple");
    const ctx = await createContext();
    await scenario.setup(ctx);
    const legacy = ctx.navigation.debugGeometry();
    const debug = ctx.navigation.debugSnapshot();
    expect(legacy).toEqual(debug.navMesh.positions);
    expect(debug.navMesh.indices.length % 3).toBe(0);
    expect(debug.navMesh.triangleCount).toBe(debug.navMesh.indices.length / 3);
    ctx.dispose();
  });

  it("distinguishes reachable, partial, and doorway routes", async () => {
    const results = new Map();
    for (const scenario of navigationScenarios) {
      const ctx = await createContext();
      await scenario.setup(ctx);
      results.set(scenario.id, structuredClone(ctx.lastRoute));
      ctx.dispose();
    }
    expect(results.get("navigation.path.simple")).toMatchObject({ reachable: true, reason: null });
    expect(results.get("navigation.path.disconnected")).toMatchObject({ reachable: false, reason: "PARTIAL_PATH" });
    expect(results.get("navigation.path.gap")).toMatchObject({ reachable: true, reason: null });
  });


  it("connects real Rapier obstacles to action-aware Recast diagnosis", async () => {
    const scenario = navigationScenarios.find((item) => item.id === "navigation.action.door-counterfactual");
    const ctx = await createContext();
    await scenario.setup(ctx);
    const debug = ctx.debugSnapshot();
    expect(debug.physicsObstacles.items).toHaveLength(1);
    expect(debug.physicsObstacles.items[0]).toMatchObject({
      id: "door-blocker:door:0",
      objectId: "door-blocker",
      part: "door",
      shape: "box"
    });
    expect(debug.status.capabilities.obstacleSource).toBe("physics:rapier:colliders");
    expect(debug.diagnosis).toMatchObject({
      status: "action-candidate",
      current: { reachable: false, reason: "PARTIAL_PATH" },
      recommendation: { call: { name: "open", args: { id: "door-blocker", partName: "door" } } }
    });
    expect(debug.diagnosis.candidates[0].counterfactual).toMatchObject({ reachable: true, provisional: true });
    expect(ctx.currentAfterDiagnosis).toMatchObject({ reachable: false, reason: "PARTIAL_PATH" });
    ctx.dispose();
  });

  it("propagates an actual Rapier door motion into current Recast reachability", async () => {
    const scenario = navigationScenarios.find((item) => item.id === "navigation.action.door-open-transition");
    const ctx = await createContext();
    await scenario.setup(ctx);
    const debug = ctx.debugSnapshot();
    expect(debug.transition.closed).toMatchObject({ reachable: false, reason: "PARTIAL_PATH" });
    expect(debug.transition.targetAccepted).toBe(true);
    expect(Math.abs(debug.transition.articulation.error)).toBeLessThan(0.08);
    expect(debug.transition.opened).toMatchObject({ reachable: true, reason: null });
    expect(debug.transition.opened.dynamicObstacles.syncVersion).toBeGreaterThan(debug.transition.closed.dynamicObstacles.syncVersion);
    expect(Math.abs(debug.obstacles[0].angle)).toBeGreaterThan(1);
    ctx.dispose();
  });
});
