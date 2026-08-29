export const interactionPickupDropScenario = {
  id: "interaction.carry.pickup-drop",
  title: "Pickup / Drop",
  subtitle: "dynamic → held → dynamic",
  description: "真实 cup 通过 InteractionSystem.pickup/drop 在 dynamic 与 held 状态之间切换，并记录 EventBus 事件。",
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
      { label: "初始 cup 是 dynamic", pass: before?.bodyType === "dynamic" },
      { label: "pickup 返回 held", pass: pickup?.status === "held" && pickup?.heldBy?.kind === "human" },
      { label: "held 时 Physics body 变 kinematic", pass: held?.bodyType === "kinematic" },
      { label: "drop 成功释放", pass: drop === true && ctx.interaction.heldId === null },
      { label: "释放后恢复 dynamic", pass: released?.bodyType === "dynamic" },
      { label: "EventBus 记录 pickup/drop", pass: ctx.eventLog.map((event) => event.action).join(",") === "pickup,drop" }
    ];
  }
};
