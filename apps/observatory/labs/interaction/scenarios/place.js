export const interactionPlaceScenario = {
  id: "interaction.place.surface",
  title: "放置到表面",
  subtitle: "空间自由点 → Interaction.place",
  description: "把真实杯子放到真实 table.top：候选来自 SpatialSystem.findFreeSpace，随后 InteractionSystem.place 完成拿起、移动与放下。",
  inspect: "cup",
  async setup(ctx) {
    await ctx.addAsset({ id: "table", assetId: "table", position: [0, 0, 0] });
    await ctx.addAsset({ id: "cup", assetId: "cup", position: [3, 0, 0] });
    const result = ctx.place("cup", "table", { surfaceId: "top", clearance: 0.03, grid: 5 });
    const position = ctx.physics.getPosition("cup");
    const support = ctx.spatial.supportStatus("cup", "table", { surfaceId: "top" });
    ctx.lastSupport = support;
    ctx.transition = { result, position, support };
  },
  assertions(ctx) {
    const { result, position, support } = ctx.transition;
    return [
      { label: "放置操作返回目标 table", pass: result?.targetId === "table" && result?.id === "cup" },
      { label: "杯子最终不再处于持有状态", pass: ctx.interaction.heldId === null && !ctx.store.get("cup").state?.heldBy },
      { label: "物理位置与放置结果一致", pass: position?.every((value, index) => Math.abs(value - result.position[index]) < 0.002) },
      { label: "空间支撑验证位于其上", pass: support?.on === true, detail: `间隙=${support?.gap}` },
      { label: "EventBus 记录拿起/放下/放置", pass: ctx.eventLog.map((event) => event.action).join(",") === "pickup,drop,place" }
    ];
  }
};
