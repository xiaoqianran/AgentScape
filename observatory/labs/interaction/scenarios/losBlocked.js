export const interactionLosBlockedScenario = {
  id: "interaction.reach.los-blocked",
  title: "LOS Blocked",
  subtitle: "距离合格但视线被 blocker 截断",
  description: "真实 agent 与 cup 距离在 interaction range 内，但 Rapier raycast 首先命中 blocker，因此 interactable=false。",
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
      { label: "目标处于交互距离内", pass: status?.inRange === true, detail: `distance=${status?.distance}` },
      { label: "Rapier LOS 被 blocker 截断", pass: status?.visible === false && status?.lineOfSight?.hit?.id === "blocker", detail: status?.lineOfSight?.hit?.id || "clear" },
      { label: "距离合格但不可交互", pass: status?.interactable === false }
    ];
  }
};
