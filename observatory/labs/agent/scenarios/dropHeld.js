export const agentDropHeldScenario = {
  id: "agent.tool.drop-held",
  title: "getCarryStatus / dropHeld",
  subtitle: "真实 Skill mutation + Rapier settle",
  description: "以 scene restore 语义重建 Agent-held cup，再由 AgentTools 调 getCarryStatus 与 dropHeld；dropHeld 必须等真实 dynamic settle 后才返回 verified dropped。",
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
      { label: "重建后 Agent 持有 cup", pass: before?.status === "held" && before?.targetId === "cup" },
      { label: "dropHeld 等待到 verified dropped", pass: dropped?.status === "dropped" && dropped?.released === true && dropped?.settled === true && dropped?.stillHeld === false },
      { label: "SkillRegistry outcome=verified", pass: dropPolicy?.outcome?.state === "verified" && dropPolicy?.outcome?.verified === true },
      { label: "drop 后 carryStatus=empty", pass: after?.status === "empty" },
      { label: "cup 最终恢复 dynamic", pass: body?.bodyType === "dynamic" }
    ];
  }
};
