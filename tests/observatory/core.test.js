import { describe, expect, it } from "vitest";
import { SimulationClock } from "../../apps/observatory/core/SimulationClock.js";
import { ScenarioRegistry } from "../../apps/observatory/core/ScenarioRegistry.js";
import { LabRegistry } from "../../apps/observatory/core/LabRegistry.js";
import { ScenarioRunner } from "../../apps/observatory/core/ScenarioRunner.js";
import { ObservatoryShell } from "../../apps/observatory/ui/ObservatoryShell.js";

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

  it("disposes the created context when scenario setup fails", async () => {
    let created = 0;
    let disposed = 0;
    const runner = new ScenarioRunner({
      clock: { reset() {}, advance() {}, pause() {} },
      createContext: async () => { created += 1; return { dispose() { disposed += 1; } }; }
    });
    await expect(runner.load({ setup: async () => { throw new Error("setup failed"); } }))
      .rejects.toThrow("setup failed");
    expect(created).toBe(1);
    expect(disposed).toBe(1);
    expect(runner.context).toBeNull();
    expect(runner.scenario).toBeNull();
  });

  it("keeps the recovery action after scenario loading clears busy", () => {
    const spinner = { hidden: false };
    const statusLayer = { hidden: false, querySelector: () => spinner };
    const refs = {
      "status-layer": statusLayer,
      "status-text": { textContent: "" },
      "status-action": { hidden: true, onclick: null },
      run: { disabled: false }, step: { disabled: false },
      step10: { disabled: false }, reset: { disabled: false }
    };
    const shell = Object.create(ObservatoryShell.prototype);
    shell.root = { setAttribute() {} };
    shell.refs = refs;
    shell.failure = null;
    const recover = () => {};

    shell.setRendererFailure("渲染设备丢失", recover);
    expect(refs["status-action"].onclick).toBe(recover);
    shell.setBusy(false);
    expect(refs["status-action"].hidden).toBe(false);
    expect(refs["status-action"].onclick).toBe(recover);
    expect(refs["status-text"].textContent).toBe("渲染设备丢失");

    shell.setBusy(true, "加载中");
    expect(shell.failure).toBeNull();
    expect(refs["status-action"].hidden).toBe(true);
  });
});
