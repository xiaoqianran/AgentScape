import { describe, expect, it } from "vitest";
import { SimulationClock } from "../../observatory/core/SimulationClock.js";
import { ScenarioRegistry } from "../../observatory/core/ScenarioRegistry.js";
import { LabRegistry } from "../../observatory/core/LabRegistry.js";

describe("Observatory core", () => {
  it("advances a deterministic fixed-step clock", () => {
    const clock = new SimulationClock({ fixedDt: 1 / 60 });
    clock.advance();
    clock.advance();
    expect(clock.frame).toBe(2);
    expect(clock.time).toBeCloseTo(2 / 60, 10);
    clock.reset();
    expect(clock.frame).toBe(0);
    expect(clock.running).toBe(false);
  });

  it("registers stable scenario identities and rejects duplicates", () => {
    const scenario = { id: "physics.gravity.basic", title: "Gravity", setup() {} };
    const registry = new ScenarioRegistry([scenario]);
    expect(registry.get(scenario.id).title).toBe("Gravity");
    expect(registry.list({ lab: "physics" })).toHaveLength(1);
    expect(() => registry.register(scenario)).toThrow(/Duplicate scenario id/);
  });

  it("loads labs through stable plugin definitions", async () => {
    const registry = new LabRegistry([{ id: "physics", title: "Physics", load: async () => ({ labDefinition: { id: "physics" } }) }]);
    expect(registry.list().map((lab) => lab.id)).toEqual(["physics"]);
    await expect(registry.load("physics")).resolves.toMatchObject({ labDefinition: { id: "physics" } });
  });
});
