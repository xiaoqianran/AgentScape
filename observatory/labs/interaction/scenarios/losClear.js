export const interactionLosClearScenario = {
  id: "interaction.reach.los-clear",
  title: "LOS Clear",
  subtitle: "距离 + Physics LOS 都通过",
  description: "同样的 agent/cup 距离，不放 blocker；Rapier raycast 直接命中 cup，interactionStatus=true。",
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
      { label: "Rapier LOS 直接命中 cup", pass: status?.visible === true && status?.lineOfSight?.hit?.id === "cup" },
      { label: "InteractionSystem 判定可交互", pass: status?.interactable === true }
    ];
  }
};
