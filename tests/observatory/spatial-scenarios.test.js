import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SimulationClock } from "../../observatory/core/SimulationClock.js";
import { ScenarioRunner } from "../../observatory/core/ScenarioRunner.js";
import { SpatialScenarioContext } from "../../observatory/labs/spatial/SpatialScenarioContext.js";
import { spatialScenarios } from "../../observatory/labs/spatial/scenarios/index.js";

const createContext = async () => new SpatialScenarioContext({ scene: new THREE.Scene() }).init();

describe("Observatory Spatial scenarios", () => {
  for (const scenario of spatialScenarios) {
    it(`${scenario.id} uses production spatial truth`, async () => {
      const ctx = await createContext();
      await scenario.setup(ctx);
      const debug = ctx.debugSnapshot();
      const assertions = scenario.assertions?.(ctx, { frame: 0, time: 0, fixedDt: 1 / 60 }) || [];
      expect(debug).toMatchObject({ schemaVersion: 1, source: "spatial" });
      expect(debug.bvh).toMatchObject({ installed: true, raycast: "three-mesh-bvh" });
      expect(debug.bounds.length).toBeGreaterThan(0);
      expect(assertions.filter((item) => item.status !== "pending" && item.pass === false)).toEqual([]);
      ctx.dispose();
    });
  }

  it("returns each raycast instance only once at its nearest hit", async () => {
    const scenario = spatialScenarios.find((item) => item.id === "spatial.raycast.bvh");
    const ctx = await createContext();
    await scenario.setup(ctx);
    const ids = ctx.debugSnapshot().ray.hits.map((hit) => hit.id);
    expect(ids).toEqual(["near-box", "mid-box", "far-box"]);
    expect(new Set(ids).size).toBe(ids.length);
    ctx.dispose();
  });

  it("replays a dynamic BVH ray query deterministically", async () => {
    const scenario = spatialScenarios.find((item) => item.id === "spatial.raycast.bvh");
    const clock = new SimulationClock({ fixedDt: 1 / 60 });
    const runner = new ScenarioRunner({ clock, createContext });
    await runner.load(scenario);
    runner.step(90);
    const before = runner.context.debugSnapshot().ray;
    await runner.replayTo(90);
    const after = runner.context.debugSnapshot().ray;
    expect(clock.frame).toBe(90);
    expect(after).toEqual(before);
    await runner.dispose();
  });
});
