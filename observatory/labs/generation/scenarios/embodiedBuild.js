import {
  FIXTURE_ASSET_ID,
  FIXTURE_INSTANCE_ID,
  FIXTURE_OPERATION,
  FIXTURE_PROVIDER_ID
} from "../FixtureGenerationConnector.js";

export const generationEmbodiedBuildScenario = {
  id: "generation.agent-build.embodied-red-apple",
  title: "生成苹果并由智能体搬到桌上",
  subtitle: "Generate → Pickup → Carry → ApproachAndPlace → Verify",
  description: "Level 2：先经真实 Artifact/Compiler 生成新苹果，再让生产 Navigation + Locomotion + Interaction Runtime 把这个生成资产拿起、携带并具身放置到 table.top。",
  async setup(ctx) {
    await ctx.world.addAsset({ id: "agent_01", assetId: "agent", position: [0, 0, 3] });
    await ctx.world.addAsset({ id: "table_01", assetId: "table", position: [0, 0, -1.6] });
    ctx.navigation.invalidate("generation-embodied-setup");
    ctx.sceneGraph.changed();

    const result = await ctx.runAgent("生成一个红苹果，亲自拿起来，带着它移动一段距离，再把它可靠地放到桌面。", [
      {
        message: "先确认可用的 3D 生成能力。",
        toolCalls: [{ id: "cap-e1", name: "listGenerationCapabilities", args: { provider: FIXTURE_PROVIDER_ID, availableOnly: true } }]
      },
      {
        message: "生成并编译红苹果。",
        toolCalls: [{
          id: "gen-e1",
          name: "generateAndCompileAsset",
          args: {
            assetId: FIXTURE_ASSET_ID,
            label: "Generated Red Apple",
            provider: FIXTURE_PROVIDER_ID,
            operation: FIXTURE_OPERATION,
            inputs: { prompt: "a small red apple" },
            profile: "deterministic",
            outputRoles: ["primary-glb"]
          }
        }]
      },
      {
        message: "把生成资产实例化到智能体前方。",
        toolCalls: [{
          id: "spawn-e1",
          name: "spawnAsset",
          args: { assetId: FIXTURE_ASSET_ID, instanceId: FIXTURE_INSTANCE_ID, position: [0, 0.45, 1.25] }
        }]
      },
      {
        message: "走近并真实拿起新生成的苹果。",
        toolCalls: [{
          id: "pickup-e1",
          name: "approachAndPickup",
          args: { actorId: "agent_01", targetId: FIXTURE_INSTANCE_ID, speed: 2.5 }
        }]
      },
      {
        message: "带着苹果移动到侧面的中间点，验证 carry 不是瞬移。",
        toolCalls: [{
          id: "carry-e1",
          name: "navigateTo",
          args: { id: "agent_01", end: [1.6, 0, 0.4], speed: 2.5 }
        }]
      },
      {
        message: "走近桌子并把持有的苹果放到 table.top。",
        toolCalls: [{
          id: "place-e1",
          name: "approachAndPlace",
          args: { actorId: "agent_01", supportId: "table_01", surfaceId: "top", speed: 2.5 }
        }]
      },
      {
        message: "确认 Runtime 派生出苹果 ON 桌子的关系。",
        toolCalls: [{
          id: "verify-e1",
          name: "listRelations",
          args: { subject: FIXTURE_INSTANCE_ID, predicate: "ON", object: "table_01" }
        }]
      },
      { message: "生成资产已经被真实拿起、携带并具身放到桌面，最终关系已验证。", toolCalls: [] }
    ], { maxSteps: 10 });

    ctx.sceneGraph.update();
    const pickup = result.execution.find((entry) => entry.tool === "approachAndPickup") || null;
    const carry = result.execution.find((entry) => entry.tool === "navigateTo") || null;
    const place = result.execution.find((entry) => entry.tool === "approachAndPlace") || null;
    const relations = ctx.sceneGraph.list({ subject: FIXTURE_INSTANCE_ID, predicate: "ON", object: "table_01" });
    const support = ctx.runtime.spatial.supportStatus(FIXTURE_INSTANCE_ID, "table_01", { surfaceId: "top" });
    const carryStatus = ctx.runtime.interactions.carryStatus("agent_01");
    ctx.transition = { result, pickup, carry, place, relations, support, carryStatus };
  },
  assertions(ctx) {
    const { result, pickup, carry, place, relations, support, carryStatus } = ctx.transition || {};
    return [
      { label: "生成资产经过 Compiler / Admission 为 ready", pass: ctx.generatedAssetState()?.admission?.status === "ready" },
      { label: "approachAndPickup 对生成资产返回 verified held", pass: pickup?.outcome?.state === "verified" && pickup?.outcome?.status === "held" },
      { label: "携带期间使用真实 navigateTo 并到达", pass: carry?.outcome?.state === "verified" && carry?.outcome?.status === "arrived" },
      { label: "approachAndPlace 返回 verified placed", pass: place?.outcome?.state === "verified" && place?.outcome?.status === "placed" },
      { label: "放置后不再持有生成资产", pass: carryStatus?.status === "empty" && !ctx.runtime.store.get(FIXTURE_INSTANCE_ID).state?.heldBy },
      { label: "Physics / Spatial 最终验证 table.top 支撑", pass: support?.on === true, detail: `gap=${support?.gap ?? "—"}` },
      { label: "SceneGraph 最终存在 generated apple ON table", pass: relations?.length === 1 },
      { label: "Agent 每次世界变更后都重新规划", pass: ctx.gatewayRequests.length === 8 && result?.steps === 8 },
      { label: "Level 2 最终任务 completed，无 unresolved mutation", pass: result?.taskStatus === "completed" && result?.unresolvedMutations?.length === 0 }
    ];
  }
};
