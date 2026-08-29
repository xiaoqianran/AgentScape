export const agentDropHeldScenario = {
  id: "agent.tool.drop-held",
  title: "持有状态 / 放下（getCarryStatus / dropHeld）",
  subtitle: "真实技能变更 + Rapier 稳定",
  description: "以场景恢复语义重建智能体持有的杯子，再由 AgentTools 调用 getCarryStatus 与 dropHeld；dropHeld 必须等待真实动态刚体稳定后才返回已验证的放下结果。",
  async setup(ctx) {
    await ctx.createHeldAgentCup();
    const before = await ctx.call("getCarryStatus", { actorId: "agent" });
    const dropped = await ctx.callAndDriveSettle("dropHeld", { actorId: "agent" }, { maxFrames: 360 });
    const after = await ctx.call("getCarryStatus", { actorId: "agent" });
    const body = ctx.world.physics.debugSnapshot({ nativeGeometry: false }).bodies.find((item) => item.objectId === "cup");
    ctx.transition = { before, dropped, after, body, dropPolicy: ctx.registry.executionPolicy("dropHeld", dropped) };
  },
  assertions(ctx) {
    const { before, dropped, after, body, dropPolicy } = ctx.transition;
    return [
      { label: "重建后智能体持有杯子", pass: before?.status === "held" && before?.targetId === "cup" },
      { label: "dropHeld 等待到已验证放下", pass: dropped?.status === "dropped" && dropped?.released === true && dropped?.settled === true && dropped?.stillHeld === false },
      { label: "SkillRegistry 结果为已验证", pass: dropPolicy?.outcome?.state === "verified" && dropPolicy?.outcome?.verified === true },
      { label: "放下后持有状态为空", pass: after?.status === "empty" },
      { label: "杯子最终恢复为动态刚体", pass: body?.bodyType === "dynamic" }
    ];
  }
};
