export const interactionLosClearScenario = {
  id: "interaction.reach.los-clear",
  title: "视线畅通",
  subtitle: "距离 + 物理视线都通过",
  description: "保持相同的智能体/杯子距离，不放阻挡物；Rapier 射线检测直接命中杯子，interactionStatus 判定为可交互。",
  inspect: "agent",
  async setup(ctx) {
    await ctx.addAsset({ id: "agent", assetId: "agent", position: [0, 0, 1.0] });
    await ctx.addAsset({ id: "cup", assetId: "cup", position: [0, 0, -0.2] });
    const clear = ctx.interactionStatus("agent", "cup", { maxDistance: 1.5 });
    ctx.transition = { clear };
  },
  assertions(ctx) {
    const status = ctx.transition.clear;
    return [
      { label: "目标处于交互距离内", pass: status?.inRange === true },
      { label: "Rapier 视线检测直接命中杯子", pass: status?.visible === true && status?.lineOfSight?.hit?.id === "cup" },
      { label: "InteractionSystem 判定可交互", pass: status?.interactable === true }
    ];
  }
};
