export const assetCabinetScenario = {
  id: "physics.asset.cabinet-hinge",
  title: "资产柜体",
  subtitle: "真实 cabinet.glb",
  description: "通过生产 AssetManager 加载真实 cabinet.glb，验证 GLB 节点、清单碰撞体、物理碰撞体与旋转关节。",
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
      { label: "真实 GLB 旋转关节已建立", pass: state?.jointType === "revolute" },
      clock.frame < 180 ? { label: "真实柜门电机收敛", status: "pending" } : { label: "真实柜门电机收敛", pass: Math.abs(state?.error ?? 99) < 0.25, detail: `误差=${(state?.error ?? NaN).toFixed(3)}` },
      { label: "清单碰撞体全部映射到物理系统", pass: truth.missingCount === 0 },
      { label: "碰撞体形状类型一致", pass: truth.shapeMismatchCount === 0 }
    ];
  }
};
