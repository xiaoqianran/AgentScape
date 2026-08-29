import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { InteractionScenarioContext } from "../../observatory/labs/interaction/InteractionScenarioContext.js";
import { interactionScenarios } from "../../observatory/labs/interaction/scenarios/index.js";

const createContext = async () => new InteractionScenarioContext({ scene: new THREE.Scene() }).init();

describe("Observatory Interaction scenarios", () => {
  for (const scenario of interactionScenarios) {
    it(`${scenario.id} uses production interaction truth`, async () => {
      const ctx = await createContext();
      await scenario.setup(ctx);
      const debug = ctx.debugSnapshot({
        actorId: scenario.id.includes("reach") ? "agent" : null,
        targetId: scenario.id.includes("reach") ? "cup" : null
      });
      const assertions = scenario.assertions(ctx);
      expect(debug).toMatchObject({ schemaVersion: 1, source: "interaction" });
      expect(debug.physics.backend).toBe("rapier");
      expect(assertions.filter((item) => item.status !== "pending" && item.pass === false)).toEqual([]);
      ctx.dispose();
    });
  }

  it("transitions cup body type through human pickup and drop", async () => {
    const scenario = interactionScenarios.find((item) => item.id === "interaction.carry.pickup-drop");
    const ctx = await createContext();
    await scenario.setup(ctx);
    expect(ctx.transition.before.bodyType).toBe("dynamic");
    expect(ctx.transition.held.bodyType).toBe("kinematic");
    expect(ctx.transition.released.bodyType).toBe("dynamic");
    expect(ctx.eventLog.map((event) => event.action)).toEqual(["pickup", "drop"]);
    ctx.dispose();
  });

  it("places the production cup on the production table surface", async () => {
    const scenario = interactionScenarios.find((item) => item.id === "interaction.place.surface");
    const ctx = await createContext();
    await scenario.setup(ctx);
    expect(ctx.transition.support).toMatchObject({ on: true, targetId: "table", surfaceId: "top" });
    expect(ctx.transition.position[1]).toBeCloseTo(1.13, 2);
    expect(ctx.eventLog.map((event) => event.action)).toEqual(["pickup", "drop", "place"]);
    ctx.dispose();
  });

  it("distinguishes LOS blocked from LOS clear at the same interaction range", async () => {
    const blockedScenario = interactionScenarios.find((item) => item.id === "interaction.reach.los-blocked");
    const clearScenario = interactionScenarios.find((item) => item.id === "interaction.reach.los-clear");

    const blockedCtx = await createContext();
    await blockedScenario.setup(blockedCtx);
    expect(blockedCtx.transition.blocked).toMatchObject({ inRange: true, visible: false, interactable: false });
    expect(blockedCtx.transition.blocked.lineOfSight.hit.id).toBe("blocker");
    blockedCtx.dispose();

    const clearCtx = await createContext();
    await clearScenario.setup(clearCtx);
    expect(clearCtx.transition.clear).toMatchObject({ inRange: true, visible: true, interactable: true });
    expect(clearCtx.transition.clear.lineOfSight.hit.id).toBe("cup");
    clearCtx.dispose();
  });
});
