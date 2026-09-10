import {
  FIXTURE_ASSET_ID,
  FIXTURE_INSTANCE_ID,
  FIXTURE_OPERATION,
  FIXTURE_PROVIDER_ID
} from "../FixtureGenerationConnector.js";

export const generationAgentBuildScenario = {
  id: "generation.agent-build.red-apple",
  title: "生成红苹果并放到桌上",
  subtitle: "Agent → Job → Artifact → Compiler → Spawn → Place → Verify",
  description: "使用零费用 deterministic Connector fixture 产出真实 GLB bytes，并完整经过生产 GenerationRuntime、Artifact integrity、AssetCompiler、Admission、Rapier 放置和 SceneGraph ON 验证。",
  async setup(ctx) {
    await ctx.world.addAsset({ id: "table_01", assetId: "table", position: [0, 0, 0] });
    ctx.sceneGraph.changed();
    const result = await ctx.runAgent("生成一个红色苹果，把它放到桌面，并确认最终确实在桌子上。", [
      {
        message: "先检查可用生成能力。",
        toolCalls: [{ id: "cap-1", name: "listGenerationCapabilities", args: { provider: FIXTURE_PROVIDER_ID, availableOnly: true } }]
      },
      {
        message: "生成并编译一个可交互苹果资产。",
        toolCalls: [{
          id: "gen-1",
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
        message: "资产已通过准入，加入当前世界。",
        toolCalls: [{
          id: "spawn-1",
          name: "spawnAsset",
          args: { assetId: FIXTURE_ASSET_ID, instanceId: FIXTURE_INSTANCE_ID, position: [2.4, 0.4, 0] }
        }]
      },
      {
        message: "把新生成的苹果放到桌面。",
        toolCalls: [{
          id: "place-1",
          name: "place",
          args: { id: FIXTURE_INSTANCE_ID, targetId: "table_01", surfaceId: "top", clearance: 0.02 }
        }]
      },
      {
        message: "用 Runtime 派生关系确认放置结果。",
        toolCalls: [{
          id: "verify-1",
          name: "listRelations",
          args: { subject: FIXTURE_INSTANCE_ID, predicate: "ON", object: "table_01" }
        }]
      },
      { message: "红苹果已经生成、编译、加入世界，并由 Runtime 验证位于桌面。", toolCalls: [] }
    ]);
    ctx.sceneGraph.update();
    const artifact = ctx.generation.artifactRegistry.list().find((item) => item.id === "artifact_obs_red_apple") || null;
    const manifest = ctx.runtime.assets.has(FIXTURE_ASSET_ID) ? ctx.runtime.assets.getManifest(FIXTURE_ASSET_ID) : null;
    const relations = ctx.sceneGraph.list({ subject: FIXTURE_INSTANCE_ID, predicate: "ON", object: "table_01" });
    const support = ctx.runtime.store.has(FIXTURE_INSTANCE_ID)
      ? ctx.runtime.spatial.supportStatus(FIXTURE_INSTANCE_ID, "table_01", { surfaceId: "top" })
      : null;
    ctx.transition = { result, artifact, manifest, relations, support };
  },
  assertions(ctx) {
    const { result, artifact, manifest, relations, support } = ctx.transition || {};
    const executed = result?.execution || [];
    return [
      { label: "Agent 调用了生成能力发现", pass: executed.some((entry) => entry.tool === "listGenerationCapabilities" && entry.executed === true) },
      { label: "Provider Job 成功并进入真实 Artifact 导入链", pass: executed.some((entry) => entry.tool === "generateAndCompileAsset" && entry.outcome?.state === "verified") },
      { label: "Artifact SHA-256 / MIME / bytes 完整性已验证", pass: artifact?.integrity?.state === "verified" && artifact?.mime === "model/gltf-binary" },
      { label: "AssetCompiler 与 Admission 都达到 ready", pass: manifest?.compiler?.quality?.status === "ready" && ctx.generatedAssetState()?.admission?.status === "ready" },
      { label: "生成资产已真实实例化进 Rapier 世界", pass: ctx.runtime.store.has(FIXTURE_INSTANCE_ID) && Boolean(ctx.runtime.physics.getPosition(FIXTURE_INSTANCE_ID)) },
      { label: "Agent 执行了 spawn → fresh replan → place", pass: executed.some((entry) => entry.tool === "spawnAsset" && entry.executed) && executed.some((entry) => entry.tool === "place" && entry.executed) && ctx.gatewayRequests.length >= 5 },
      { label: "Spatial support truth 确认苹果位于 table.top", pass: support?.on === true, detail: `gap=${support?.gap ?? "—"}` },
      { label: "SceneGraph 派生 ON 关系已验证", pass: relations?.some((edge) => edge.subject === FIXTURE_INSTANCE_ID && edge.predicate === "ON" && edge.object === "table_01") },
      { label: "最终 Agent 任务状态 completed 且无 unresolved mutation", pass: result?.taskStatus === "completed" && result?.unresolvedMutations?.length === 0 }
    ];
  }
};
