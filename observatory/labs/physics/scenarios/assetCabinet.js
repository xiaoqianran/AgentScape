export const assetCabinetScenario = {
  id: "physics.asset.cabinet-hinge",
  title: "Asset Cabinet",
  subtitle: "真实 cabinet.glb",
  description: "通过生产 AssetManager 加载真实 cabinet.glb，验证 GLB node、Manifest collider、Physics collider 与 revolute joint。",
  kind: "asset",
  browserOnly: true,
  inspect: "asset_cabinet_01",
  async setup(ctx) {
    ctx.addBox({ id: "floor", type: "fixed", position: [0, -0.1, 0], halfExtents: [5, 0.1, 4] });
    const { createAssetModule } = await import("../../../../generation/orchestration/createAssetModule.js");
    const assets = createAssetModule().manager;
    const { object, manifest } = await assets.instantiate("cabinet");
    ctx.addAssetInstance({
      id: "asset_cabinet_01",
      assetId: "cabinet",
      object,
      manifest,
      initialState: { parts: { door: "close" } },
      inspectPart: "door",
      target: -1
    });
  },
  assertions(ctx, clock) {
    const state = ctx.articulation("asset_cabinet_01", "door", -1);
    const truth = ctx.truthComparison().summary;
    return [
      { label: "真实 GLB revolute joint 已建立", pass: state?.jointType === "revolute" },
      clock.frame < 180 ? { label: "真实柜门 motor 收敛", status: "pending" } : { label: "真实柜门 motor 收敛", pass: Math.abs(state?.error ?? 99) < 0.25, detail: `error=${(state?.error ?? NaN).toFixed(3)}` },
      { label: "Manifest collider 全部映射到 Physics", pass: truth.missingCount === 0 },
      { label: "Collider shape 类型一致", pass: truth.shapeMismatchCount === 0 }
    ];
  }
};
