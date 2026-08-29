export const assetCupScenario = {
  id: "physics.asset.cup-drop",
  title: "资产杯子",
  subtitle: "生产 AssetManager · 杯子",
  description: "使用真实 AgentScape AssetManager 与杯子清单/工厂，验证渲染 / 清单 / 物理三层真值。",
  kind: "asset",
  inspect: "asset_cup_01",
  async setup(ctx) {
    ctx.addBox({ id: "floor", type: "fixed", position: [0, -0.1, 0], halfExtents: [5, 0.1, 4] });
    const { createAssetModule } = await import("../../../../generation/orchestration/createAssetModule.js");
    const assets = createAssetModule().manager;
    const { object, manifest } = await assets.instantiate("cup");
    ctx.addAssetInstance({ id: "asset_cup_01", assetId: "cup", object, manifest, position: [0, 4, 0] });
  },
  assertions(ctx, clock) {
    const p = ctx.position("asset_cup_01");
    const truth = ctx.truthComparison().summary;
    return [
      { label: "真实杯子资产已进入 PhysicsSystem", pass: p?.every(Number.isFinite) },
      clock.frame < 120 ? { label: "杯子最终落到地面", status: "pending" } : { label: "杯子最终落到地面", pass: p[1] > -0.05 && p[1] < 0.05, detail: `y=${p[1].toFixed(3)}` },
      { label: "清单碰撞体全部映射到物理系统", pass: truth.missingCount === 0 },
      { label: "碰撞体形状类型一致", pass: truth.shapeMismatchCount === 0 }
    ];
  }
};
