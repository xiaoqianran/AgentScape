import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PhysicsSystem } from "../../modules/world/runtime/systems/PhysicsSystem.js";
import {
  PHYSICS_API_CATALOG,
  PHYSICS_API_EXCLUDED,
  PHYSICS_API_TOOLS,
  invokePhysicsApi,
  physicsApiCoverage,
  physicsApiToolDefinitions,
  toPlainValue
} from "../../modules/physics/PhysicsApiSurface.js";
import { studioScenarios } from "../../apps/observatory/labs/physics-studio/scenarios/index.js";
import { labDefinition } from "../../apps/observatory/labs/physics-studio/index.js";
import { PhysicsScenarioContext } from "../../apps/observatory/labs/physics/PhysicsScenarioContext.js";
import { createPhysicsBackend } from "../../apps/observatory/labs/physics/backends.js";

describe("Physics Studio API catalog", () => {
  it("covers the complete public PhysicsSystem surface", () => {
    const coverage = physicsApiCoverage(PhysicsSystem);
    expect(coverage.missing).toEqual([]);
    expect(coverage.unexpected).toEqual([]);
    expect(coverage.complete).toBe(true);
    // Buckets are mutually exclusive and must account for every public method exactly once.
    expect(coverage.direct.length + coverage.hostCovered.length + coverage.excluded.length).toBe(coverage.publicMethods.length);
    expect(new Set([...coverage.direct, ...coverage.hostCovered.map((entry) => entry.method), ...coverage.excluded]).size).toBe(coverage.publicMethods.length);
  });

  it("only excludes host-owned or handle-only methods, and documents why", () => {
    const coverage = physicsApiCoverage(PhysicsSystem);
    for (const [method, reason] of Object.entries(PHYSICS_API_EXCLUDED)) {
      expect(typeof reason, `${method} needs a documented reason`).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    }
    for (const method of coverage.excluded) {
      expect(PHYSICS_API_EXCLUDED, `${method} must be documented`).toHaveProperty(method);
    }
    // Every documented exclusion must be a real prototype method (or the constructor).
    const documented = Object.keys(PHYSICS_API_EXCLUDED).filter((name) => !coverage.publicMethods.includes(name) && name !== "constructor");
    expect(documented).toEqual([]);
    // Host tools must genuinely exist for the methods they claim to cover.
    const names = new Set(PHYSICS_API_TOOLS.map((tool) => tool.name));
    for (const entry of coverage.hostCovered) {
      for (const tool of entry.tools) expect(names.has(tool), `${entry.method} -> ${tool}`).toBe(true);
    }
  });

  it("publishes unique, well-formed tool definitions", () => {
    const names = PHYSICS_API_CATALOG.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of physicsApiToolDefinitions()) {
      expect(tool.name).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters.type).toBe("object");
      expect(Array.isArray(tool.parameters.required)).toBe(true);
      for (const required of tool.parameters.required) {
        expect(Object.keys(tool.parameters.properties)).toContain(required);
      }
    }
  });

  it("registers a first-class lab with the studio scenarios", () => {
    expect(labDefinition.id).toBe("physics-studio");
    expect(labDefinition.title).toBe("物理工作台");
    expect(labDefinition.backends.map((backend) => backend.id)).toEqual(["rapier", "jolt", "compare"]);
    expect(labDefinition.normalizeBackend("nonsense")).toBe("rapier");
    const ids = studioScenarios.map((scenario) => scenario.id);
    expect(ids).toContain("physics.character.kinematic");
    expect(ids).toContain("physics.collision.sensor-events");
    expect(ids).toContain("physics.collision.filter-groups");
    expect(ids).toContain("physics.query.raycast-checks");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Physics Studio workbench invocation", () => {
  const invoke = async (ctx, name, args) => invokePhysicsApi(ctx, name, args);

  it("forwards calls to the production PhysicsSystem and returns plain results", async () => {
    const backend = await createPhysicsBackend("rapier");
    const ctx = await new PhysicsScenarioContext({ scene:new THREE.Scene(), backend }).init();
    try {
      ctx.addBox({ id:"probe", position:[0, 3, 0], halfExtents:[0.5, 0.5, 0.5] });

      const profile = await invoke(ctx, "physics.profile", {});
      expect(profile.error).toBeUndefined();
      expect(profile.result.identity).toBe("rapier");

      const motion = await invoke(ctx, "physics.getMotion", { id:"probe" });
      expect(motion.result).toMatchObject({ linearSpeed:expect.any(Number), sleeping:expect.any(Boolean) });

      const impulse = await invoke(ctx, "physics.applyImpulse", { id:"probe", impulse:[1, 0, 0] });
      expect(impulse.result).toBe(true);
      expect((await invoke(ctx, "physics.getMotion", { id:"probe" })).result.linearVelocity[0]).toBeGreaterThan(0);

      const snapshot = await invoke(ctx, "physics.debugSnapshot", {});
      expect(snapshot.result.metrics.bodyCount).toBeGreaterThan(0);
      expect(snapshot.result.nativeGeometry).toBeNull();

      const stepped = await invoke(ctx, "workbench.step", { frames:5 });
      expect(stepped.result).toEqual({ frames:5 });
    } finally { ctx.dispose(); }
  });

  it("turns tool failures into structured errors instead of throwing through the UI", async () => {
    const backend = await createPhysicsBackend("jolt");
    const ctx = await new PhysicsScenarioContext({ scene:new THREE.Scene(), backend }).init();
    try {
      const missing = await invoke(ctx, "workbench.remove", { id:"does-not-exist" });
      expect(missing.error.message).toMatch(/未知对象实例/);

      const unsupported = await invoke(ctx, "physics.getPosition", {});
      expect(unsupported.result).toBeNull();
    } finally { ctx.dispose(); }
  });

  it("keeps unsupported capability calls observable instead of fabricating success", async () => {
    const backend = await createPhysicsBackend("rapier");
    const ctx = await new PhysicsScenarioContext({ scene:new THREE.Scene(), backend }).init();
    try {
      ctx.addBox({ id:"box", position:[0, 2, 0], halfExtents:[0.5, 0.5, 0.5] });
      const pose = await invoke(ctx, "physics.checkBodyPose", { id:"box", targetPosition:[0, 2, 0] });
      expect(pose.result.clear).toBe(false);
      expect(String(pose.result.code || "")).toContain("CARRY_");
    } finally { ctx.dispose(); }
  });
});

describe("Physics Studio result sanitizer", () => {
  it("breaks cycles, summarizes typed arrays and drops opaque handles", () => {
    const cyclic = { name:"cyclic" };
    cyclic.self = cyclic;
    expect(toPlainValue(cyclic).self).toBe("[circular]");
    expect(toPlainValue(new Float32Array(4))).toEqual({ kind:"Float32Array", length:4 });
    expect(toPlainValue({ shapeRef:{ hidden:true }, keep:2 })).toEqual({ keep:2 });
    expect(toPlainValue({ deep:{ a:{ b:{} } } }).deep.a.b).toEqual({});
  });
});

describe("Physics Studio scenarios", () => {
  const runScenario = async (backendId, scenario, frames) => {
    const backend = await createPhysicsBackend(backendId);
    const ctx = await new PhysicsScenarioContext({ scene:new THREE.Scene(), backend }).init();
    await scenario.setup(ctx);
    for (let frame = 0; frame < frames; frame += 1) ctx.step(1 / 60);
    const assertions = scenario.assertions?.(ctx, { frame:frames, time:frames / 60, fixedDt:1 / 60 }) || [];
    const debug = ctx.debugSnapshot();
    ctx.dispose();
    return { assertions, debug };
  };

  for (const backendId of ["rapier", "jolt"]) {
    for (const scenario of studioScenarios.filter((item) => !item.browserOnly)) {
      it(`${backendId}: ${scenario.id} reaches its post-settle assertions`, async () => {
        const frames = scenario.id.includes("stack") ? 300 : 220;
        const { assertions, debug } = await runScenario(backendId, scenario, frames);
        expect(assertions.length).toBeGreaterThan(0);
        expect(assertions.filter((item) => item.status !== "pending" && item.pass === false)).toEqual([]);
        expect(debug).toMatchObject({ schemaVersion:1, source:"physics", backend:backendId });
      }, 20_000);
    }
  }
});
