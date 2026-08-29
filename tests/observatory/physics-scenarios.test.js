import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ScenarioRunner } from "../../observatory/core/ScenarioRunner.js";
import { SimulationClock } from "../../observatory/core/SimulationClock.js";
import { PhysicsScenarioContext } from "../../observatory/labs/physics/PhysicsScenarioContext.js";
import { createPhysicsBackend } from "../../observatory/labs/physics/backends.js";
import { physicsScenarios } from "../../observatory/labs/physics/scenarios/index.js";
import { comparePhysicsSnapshots } from "../../observatory/labs/physics/PhysicsStateComparator.js";
import { compareManifestToPhysics } from "../../observatory/labs/physics/ManifestColliderSnapshot.js";
import { assetManifests } from "../../asset/manifests/index.js";

const runScenario = async (backendId, scenario, frames) => {
  const backend = await createPhysicsBackend(backendId);
  const ctx = await new PhysicsScenarioContext({ scene: new THREE.Scene(), backend }).init();
  await scenario.setup(ctx);
  for (let frame = 0; frame < frames; frame += 1) ctx.step(1 / 60);
  const assertions = scenario.assertions?.(ctx, { frame: frames, time: frames / 60, fixedDt: 1 / 60 }) || [];
  const debug = ctx.debugSnapshot();
  ctx.dispose();
  return { assertions, debug };
};

describe("Observatory Physics scenarios", () => {
  for (const backendId of ["rapier", "jolt"]) {
    for (const scenario of physicsScenarios.filter((item) => !item.browserOnly)) {
      it(`${backendId}: ${scenario.id} reaches its post-settle assertions`, async () => {
        const frames = scenario.id.includes("stack") ? 300 : 220;
        const { assertions, debug } = await runScenario(backendId, scenario, frames);
        expect(assertions.length).toBeGreaterThan(0);
        expect(assertions.filter((item) => item.status !== "pending" && item.pass === false)).toEqual([]);
        expect(debug).toMatchObject({ schemaVersion: 1, source: "physics", backend: backendId });
        expect(debug.bodies.length).toBeGreaterThan(0);
        expect(debug.colliders.length).toBeGreaterThan(0);
        expect(Array.isArray(debug.contacts)).toBe(true);
        if (!scenario.id.includes("hinge")) expect(debug.metrics.contactPairCount).toBeGreaterThan(0);
        if (scenario.id.includes("hinge")) {
          expect(debug.joints).toHaveLength(1);
          expect(debug.joints[0].worldAxis?.every(Number.isFinite)).toBe(true);
          expect(debug.joints[0].worldAnchor?.every(Number.isFinite)).toBe(true);
        }
        if (backendId === "rapier") expect(debug.nativeGeometry?.vertices?.length).toBeGreaterThan(0);
        else expect(debug.nativeGeometry).toBeNull();
      });
    }
  }
});


describe("Observatory Physics backend comparison", () => {
  it("normalizes Rapier and Jolt state for the same deterministic scenario", async () => {
    const scenario = physicsScenarios.find((item) => item.id === "physics.gravity.basic");
    const [rapier, jolt] = await Promise.all([
      runScenario("rapier", scenario, 220),
      runScenario("jolt", scenario, 220)
    ]);
    const comparison = comparePhysicsSnapshots(rapier.debug, jolt.debug);
    expect(comparison.comparable).toBe(true);
    expect(comparison.backends).toEqual(["rapier", "jolt"]);
    expect(comparison.summary.missingBodies).toBe(0);
    expect(comparison.summary.bodyCountLeft).toBe(comparison.summary.bodyCountRight);
    expect(Number.isFinite(comparison.summary.maxPositionDelta)).toBe(true);
    expect(Number.isFinite(comparison.summary.contactCountDelta)).toBe(true);
  });
});


describe("Observatory deterministic checkpoint replay", () => {
  for (const backendId of ["rapier", "jolt"]) {
    it(`${backendId}: replays the same fixed-step state at frame 120`, async () => {
      const scenario = physicsScenarios.find((item) => item.id === "physics.gravity.basic");
      const clock = new SimulationClock({ fixedDt: 1 / 60 });
      const runner = new ScenarioRunner({
        clock,
        createContext: async () => new PhysicsScenarioContext({
          scene: new THREE.Scene(),
          backend: await createPhysicsBackend(backendId)
        }).init()
      });
      await runner.load(scenario);
      runner.step(120);
      const before = runner.context.debugSnapshot({ nativeGeometry: false });
      expect(clock.frame).toBe(120);

      await runner.replayTo(120);
      const after = runner.context.debugSnapshot({ nativeGeometry: false });
      const comparison = comparePhysicsSnapshots(before, after);

      expect(clock.frame).toBe(120);
      expect(comparison.summary.missingBodies).toBe(0);
      expect(comparison.summary.missingJoints).toBe(0);
      expect(comparison.summary.maxPositionDelta ?? 0).toBeLessThan(1e-7);
      expect(comparison.summary.maxLinearVelocityDelta ?? 0).toBeLessThan(1e-7);
      expect(comparison.summary.maxAngularVelocityDelta ?? 0).toBeLessThan(1e-7);
      expect(comparison.summary.contactCountDelta).toBe(0);
      await runner.dispose();
    });
  }
});


describe("Observatory production-contract reuse", () => {
  it("synthetic hinge geometry reuses the production cabinet semantic/physics manifest", async () => {
    const scenario = physicsScenarios.find((item) => item.id === "physics.joint.hinge");
    const ctx = await new PhysicsScenarioContext({ scene:new THREE.Scene(), backend:await createPhysicsBackend("rapier") }).init();
    await scenario.setup(ctx);
    const manifest = ctx.store.get("cabinet_01").manifest;
    expect(manifest.physics).toEqual(assetManifests.cabinet.physics);
    expect(manifest.parts).toEqual(assetManifests.cabinet.parts);
    expect(manifest.receptacles).toEqual(assetManifests.cabinet.receptacles);
    ctx.dispose();
  });
});

describe("Observatory real asset truth comparison", () => {
  for (const backendId of ["rapier", "jolt"]) {
    it(`${backendId}: production cup manifest matches runtime collider truth`, async () => {
      const scenario = physicsScenarios.find((item) => item.id === "physics.asset.cup-drop");
      const backend = await createPhysicsBackend(backendId);
      const ctx = await new PhysicsScenarioContext({ scene: new THREE.Scene(), backend }).init();
      await scenario.setup(ctx);
      for (let frame = 0; frame < 180; frame += 1) ctx.step(1 / 60);
      const truth = ctx.truthComparison();
      expect(truth.summary.missingCount).toBe(0);
      expect(truth.summary.shapeMismatchCount).toBe(0);
      expect(truth.summary.maxPositionDelta ?? 0).toBeLessThan(1e-6);
      expect(truth.summary.maxRotationDelta ?? 0).toBeLessThan(1e-6);
      expect(truth.summary.maxShapeDelta ?? 0).toBeLessThan(1e-8);
      ctx.dispose();
    });
  }
});


describe("Jolt compound articulation disposal regression", () => {
  it("disposes a compound parent plus revolute child without double releasing the constraint", async () => {
    const root = new THREE.Group();
    const hinge = new THREE.Group();
    hinge.name = "doorHinge";
    hinge.position.set(-0.82, 1, 0.39);
    root.add(hinge);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.62, 1.9, 0.08));
    door.position.set(0.81, 0, 0);
    hinge.add(door);
    const manifest = {
      id: "compound-hinge-fixture",
      source: { kind: "builtin" },
      actions: ["open", "close"],
      physics: {
        body: "fixed",
        colliders: [
          { shape: "box", halfExtents: [0.85, 1, 0.08], translation: [0, 1, -0.28] },
          { shape: "box", halfExtents: [0.08, 1, 0.32], translation: [-0.77, 1, 0] },
          { shape: "box", halfExtents: [0.08, 1, 0.32], translation: [0.77, 1, 0] },
          { shape: "box", halfExtents: [0.85, 0.08, 0.32], translation: [0, 0.08, 0] },
          { shape: "box", halfExtents: [0.85, 0.08, 0.32], translation: [0, 1.92, 0] }
        ]
      },
      parts: {
        door: {
          node: "doorHinge",
          actions: ["open", "close"],
          physics: {
            body: "dynamic",
            mass: 8,
            colliders: [{ shape: "box", halfExtents: [0.81, 0.95, 0.04], translation: [0.81, 0, 0] }]
          },
          joint: {
            type: "revolute",
            axis: [0, 1, 0],
            limits: [-1.35, 0],
            parentAnchor: [-0.82, 1, 0.39],
            childAnchor: [0, 0, 0],
            motor: { stiffness: 45, damping: 9 }
          }
        }
      }
    };

    const ctx = await new PhysicsScenarioContext({
      scene: new THREE.Scene(),
      backend: await createPhysicsBackend("jolt")
    }).init();
    ctx.addAssetInstance({
      id: "fixture",
      assetId: "fixture",
      object: root,
      manifest,
      initialState: { parts: { door: "close" } },
      inspectPart: "door",
      target: -1
    });
    for (let frame = 0; frame < 220; frame += 1) ctx.step(1 / 60);
    const state = ctx.articulation("fixture", "door", -1);
    expect(state.jointType).toBe("revolute");
    expect(Math.abs(state.error)).toBeLessThan(0.08);
    expect(ctx.truthComparison().summary.missingCount).toBe(0);
    expect(() => ctx.dispose()).not.toThrow();
  });
});


describe("Observatory collider truth difference", () => {
  it("detects a deliberately displaced physics collider", () => {
    const manifest = {
      colliders: [{
        objectId: "cup",
        partName: "$root",
        colliderIndex: 0,
        position: [0, 0.16, 0],
        rotation: [0, 0, 0, 1],
        shape: { kind: "cylinder", halfHeight: 0.16, radius: 0.15 }
      }]
    };
    const physics = {
      colliders: [{
        objectId: "cup",
        partName: "$root",
        colliderIndex: 0,
        position: [0.2, 0.16, 0],
        rotation: [0, 0, 0, 1],
        shape: { kind: "cylinder", halfHeight: 0.16, radius: 0.15 }
      }]
    };
    const comparison = compareManifestToPhysics(manifest, physics);
    expect(comparison.summary.missingCount).toBe(0);
    expect(comparison.summary.shapeMismatchCount).toBe(0);
    expect(comparison.summary.maxPositionDelta).toBeCloseTo(0.2, 10);
    expect(comparison.rows[0]).toMatchObject({
      manifestPosition: [0, 0.16, 0],
      physicsPosition: [0.2, 0.16, 0]
    });
  });
});
