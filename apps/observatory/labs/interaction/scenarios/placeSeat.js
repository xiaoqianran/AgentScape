export const interactionPlaceSeatScenario = {
  id: "interaction.place.seat",
  title: "放置到椅面",
  subtitle: "家具实体 → Interaction.place",
  description: "把杯子放到椅子的 seat 支撑面，验证放置能力不依赖桌子语义。",
  inspect: "cup",
  async setup(ctx) {
    await ctx.addAsset({ id: "chair", assetId: "chair", position: [0, 0, 0] });
    await ctx.addAsset({ id: "cup", assetId: "cup", position: [2, 0, 0] });
    const result = ctx.place("cup", "chair", { surfaceId: "seat", clearance: 0.03, grid: 5 });
    const position = ctx.physics.getPosition("cup");
    const support = ctx.spatial.supportGeometry("cup", "chair", { surfaceId: "seat" });
    ctx.lastSupport = support;
    ctx.transition = { result, position, support };
  },
  assertions(ctx) {
    const { result, position, support } = ctx.transition;
    return [
      { label: "放置操作返回目标 chair", pass: result?.targetId === "chair" && result?.id === "cup" },
      { label: "杯子最终不再处于持有状态", pass: ctx.interaction.heldId === null && !ctx.store.get("cup").state?.heldBy },
      { label: "物理位置与放置结果一致", pass: position?.every((value, index) => Math.abs(value - result.position[index]) < 0.002) },
      { label: "空间支撑验证位于椅面上", pass: support?.supported === true, detail: `间隙=${support?.gap}` },
      { label: "EventBus 记录拿起/放下/放置", pass: ctx.eventLog.map((event) => event.action).join(",") === "pickup,drop,place" }
    ];
  }
};
