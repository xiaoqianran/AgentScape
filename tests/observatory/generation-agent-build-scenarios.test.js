import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { assetAdmission } from "../../asset/admission.js";
import { labDefinition } from "../../observatory/labs/generation/index.js";
import { GenerationAgentScenarioContext } from "../../observatory/labs/generation/GenerationAgentScenarioContext.js";
import {
  FIXTURE_ARTIFACT_ID,
  FIXTURE_ASSET_ID,
  FIXTURE_INSTANCE_ID,
  FIXTURE_PROVIDER_ID
} from "../../observatory/labs/generation/FixtureGenerationConnector.js";
import { generationAgentBuildScenario, generationEmbodiedBuildScenario } from "../../observatory/labs/generation/scenarios/index.js";

const createContext = async () => new GenerationAgentScenarioContext({ scene: new THREE.Scene() }).init();

describe("Observatory Generation / Agent Build", () => {
  it("registers as an explicit zero-cost deterministic Observatory lab", () => {
    expect(labDefinition).toMatchObject({
      id: "generation",
      title: "生成与智能体构建",
      backends: [{ id: "fixture" }]
    });
    expect(labDefinition.scenarios.map((scenario) => scenario.id)).toEqual(["generation.agent-build.red-apple", "generation.agent-build.embodied-red-apple"]);
  });

  it("runs Agent → Job → Artifact → Compiler → Spawn → Place → Verify through production boundaries", async () => {
    const ctx = await createContext();
    try {
      await generationAgentBuildScenario.setup(ctx);
      const assertions = generationAgentBuildScenario.assertions(ctx);
      const debug = ctx.debugSnapshot();
      const manifest = ctx.runtime.assets.getManifest(FIXTURE_ASSET_ID);
      const artifact = ctx.generation.artifactRegistry.get(FIXTURE_ARTIFACT_ID);
      const execution = ctx.agentResult.execution.filter((entry) => entry.executed).map((entry) => entry.tool);

      expect(assertions.filter((item) => item.pass === false)).toEqual([]);
      expect(debug).toMatchObject({ schemaVersion: 1, source: "generation-agent-build" });
      expect(debug.connector.provider).toBe(FIXTURE_PROVIDER_ID);
      expect(execution).toEqual([
        "listGenerationCapabilities",
        "generateAndCompileAsset",
        "spawnAsset",
        "place",
        "listRelations"
      ]);

      expect(artifact).toMatchObject({
        id: FIXTURE_ARTIFACT_ID,
        mime: "model/gltf-binary",
        format: "glb",
        integrity: { state: "verified" }
      });
      expect(manifest).toMatchObject({
        id: FIXTURE_ASSET_ID,
        type: "apple",
        actions: expect.arrayContaining(["pickup", "drop", "place"]),
        compiler: { quality: { status: "ready" } }
      });
      expect(assetAdmission(manifest, { generated: true })).toMatchObject({ status: "ready", reasons: [] });
      expect(ctx.runtime.store.has(FIXTURE_INSTANCE_ID)).toBe(true);
      expect(ctx.runtime.physics.getPosition(FIXTURE_INSTANCE_ID)).toBeTruthy();
      expect(ctx.runtime.spatial.supportStatus(FIXTURE_INSTANCE_ID, "table_01", { surfaceId: "top" }).on).toBe(true);
      expect(ctx.sceneGraph.list({ subject: FIXTURE_INSTANCE_ID, predicate: "ON", object: "table_01" })).toHaveLength(1);
      expect(ctx.agentResult).toMatchObject({ taskStatus: "completed", unresolvedMutations: [] });

      expect(ctx.connector.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "/connector/v1/jobs", method: "POST", scope: "jobs.submit" }),
        expect.objectContaining({ path: expect.stringContaining(`/connector/v1/artifacts/${FIXTURE_ARTIFACT_ID}`), scope: "artifacts.read" })
      ]));
      expect(ctx.sequenceEvents.some((event) => event.tool === "spawnAsset" && event.mutates === true && event.barrier === true)).toBe(true);
      expect(ctx.sequenceEvents.some((event) => event.tool === "place" && event.mutates === true && event.barrier === true)).toBe(true);
    } finally {
      ctx.dispose();
    }
  });

  it("runs generated Asset through embodied pickup, carry and verified place", async () => {
    const ctx = await createContext();
    try {
      await generationEmbodiedBuildScenario.setup(ctx);
      const assertions = generationEmbodiedBuildScenario.assertions(ctx);
      const execution = ctx.agentResult.execution.filter((entry) => entry.executed);
      const byTool = (name) => execution.find((entry) => entry.tool === name);

      expect(assertions.filter((item) => item.pass === false)).toEqual([]);
      expect(execution.map((entry) => entry.tool)).toEqual([
        "listGenerationCapabilities",
        "generateAndCompileAsset",
        "spawnAsset",
        "approachAndPickup",
        "navigateTo",
        "approachAndPlace",
        "listRelations"
      ]);
      expect(byTool("approachAndPickup")?.outcome).toMatchObject({ state: "verified", status: "held" });
      expect(byTool("navigateTo")?.outcome).toMatchObject({ state: "verified", status: "arrived" });
      expect(byTool("approachAndPlace")?.outcome).toMatchObject({ state: "verified", status: "placed" });
      expect(ctx.runtime.interactions.carryStatus("agent_01")).toMatchObject({ status: "empty" });
      expect(ctx.runtime.store.get(FIXTURE_INSTANCE_ID).state.heldBy).toBeUndefined();
      expect(ctx.runtime.physics.entries.get(FIXTURE_INSTANCE_ID).body.isDynamic()).toBe(true);
      expect(ctx.runtime.spatial.supportStatus(FIXTURE_INSTANCE_ID, "table_01", { surfaceId: "top" }).on).toBe(true);
      expect(ctx.sceneGraph.list({ subject: FIXTURE_INSTANCE_ID, predicate: "ON", object: "table_01" })).toHaveLength(1);
      expect(ctx.agentResult).toMatchObject({ taskStatus: "completed", steps: 8, unresolvedMutations: [] });
      expect(ctx.gatewayRequests).toHaveLength(8);
    } finally {
      ctx.dispose();
    }
  }, 30000);

  it("exposes Generation, Scene and verification-facing spatial tools in the manual workbench", async () => {
    const ctx = await createContext();
    try {
      const names = ctx.tools.definitions().map((definition) => definition.name);
      expect(names).toEqual(expect.arrayContaining([
        "listGenerationCapabilities", "generateAndCompileAsset", "spawnAsset", "place", "listRelations", "findFreeSpace",
        "findPath", "navigateTo", "approachAndPickup", "approachAndPlace", "getCarryStatus"
      ]));
    } finally {
      ctx.dispose();
    }
  });
});
