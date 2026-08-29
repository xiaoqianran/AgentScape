export const interactionPlaceScenario = {
  id: "interaction.place.surface",
  title: "Place on Surface",
  subtitle: "Spatial FreeSpace → Interaction.place",
  description: "真实 cup 放到真实 table.top：候选来自 SpatialSystem.findFreeSpace，随后 InteractionSystem.place 完成 pickup/move/drop。",
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
      { label: "place 返回目标 table", pass: result?.targetId === "table" && result?.id === "cup" },
      { label: "cup 最终不再 held", pass: ctx.interaction.heldId === null && !ctx.store.get("cup").state?.heldBy },
      { label: "Physics position 与 place 结果一致", pass: position?.every((value, index) => Math.abs(value - result.position[index]) < 0.002) },
      { label: "Spatial support 验证 ON", pass: support?.on === true, detail: `gap=${support?.gap}` },
      { label: "EventBus 记录 pickup/drop/place", pass: ctx.eventLog.map((event) => event.action).join(",") === "pickup,drop,place" }
    ];
  }
};
