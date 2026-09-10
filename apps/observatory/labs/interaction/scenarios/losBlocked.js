export const interactionLosBlockedScenario = {
  id: "interaction.reach.los-blocked",
  title: "视线受阻",
  subtitle: "距离合格但视线被阻挡物截断",
  description: "真实智能体与杯子距离处于交互范围内，但 Rapier 射线检测首先命中阻挡物，因此判定为不可交互。",
  inspect: "agent",
  async setup(ctx) {
    await ctx.addAsset({ id: "agent", assetId: "agent", position: [0, 0, 1.0] });
    await ctx.addAsset({ id: "cup", assetId: "cup", position: [0, 0, -0.2] });
    ctx.addBlocker({ id: "blocker", size: [0.5, 2.4, 0.45], position: [0, 1.2, 0.4] });
    const blocked = ctx.interactionStatus("agent", "cup", { maxDistance: 1.5 });
    ctx.transition = { blocked };
  },
  assertions(ctx) {
    const status = ctx.transition.blocked;
    return [
      { label: "目标处于交互距离内", pass: status?.inRange === true, detail: `距离=${status?.distance}` },
      { label: "Rapier 视线检测被阻挡物截断", pass: status?.visible === false && status?.lineOfSight?.hit?.id === "blocker", detail: status?.lineOfSight?.hit?.id || "畅通" },
      { label: "距离合格但不可交互", pass: status?.interactable === false }
    ];
  }
};
