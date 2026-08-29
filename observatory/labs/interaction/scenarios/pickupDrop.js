export const interactionPickupDropScenario = {
  id: "interaction.carry.pickup-drop",
  title: "拿起 / 放下",
  subtitle: "动态 → 持有 → 动态",
  description: "真实杯子通过 InteractionSystem.pickup/drop 在动态与持有状态之间切换，并记录 EventBus 事件。",
  inspect: "cup",
  async setup(ctx) {
    await ctx.addAsset({ id: "cup", assetId: "cup", position: [0, 1.4, 0] });
    const before = ctx.physics.debugSnapshot({ nativeGeometry: false }).bodies.find((body) => body.objectId === "cup");
    const pickup = ctx.pickup("cup");
    const held = ctx.physics.debugSnapshot({ nativeGeometry: false }).bodies.find((body) => body.objectId === "cup");
    const drop = ctx.drop("cup");
    const released = ctx.physics.debugSnapshot({ nativeGeometry: false }).bodies.find((body) => body.objectId === "cup");
    ctx.transition = { before, pickup, held, drop, released };
  },
  assertions(ctx) {
    const { before, pickup, held, drop, released } = ctx.transition;
    return [
      { label: "初始杯子为动态刚体", pass: before?.bodyType === "dynamic" },
      { label: "拿起操作返回持有状态", pass: pickup?.status === "held" && pickup?.heldBy?.kind === "human" },
      { label: "持有时物理刚体变为运动学刚体", pass: held?.bodyType === "kinematic" },
      { label: "放下操作成功释放", pass: drop === true && ctx.interaction.heldId === null },
      { label: "释放后恢复为动态刚体", pass: released?.bodyType === "dynamic" },
      { label: "EventBus 记录拿起/放下", pass: ctx.eventLog.map((event) => event.action).join(",") === "pickup,drop" }
    ];
  }
};
