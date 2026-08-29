export const agentTraceDropScenario = {
  id: "agent.trace.verified-mutation",
  title: "Trace · Verified Mutation",
  subtitle: "dropHeld → settle → replan → final",
  description: "Scripted gateway 请求 dropHeld；ToolCallingAgent 等真实 Rapier settle 后把 mutation 标为 verified，并进入新规划轮次再输出最终答案。",
  trace: true,
  async setup(ctx) {
    await ctx.createHeldAgentCup();
    const result = await ctx.runAgent("放下手里的杯子，确认完成后结束", [
      { message: "", toolCalls: [{ id: "drop-1", name: "dropHeld", args: { actorId: "agent" } }] },
      { message: "cup dropped and settled", toolCalls: [] }
    ]);
    ctx.transition = { result, carry: await ctx.call("getCarryStatus", { actorId: "agent" }) };
  },
  assertions(ctx) {
    const { result, carry } = ctx.transition;
    return [
      { label: "dropHeld 是 verified mutation", pass: result?.lastMutation?.tool === "dropHeld" && result?.lastMutation?.outcome?.state === "verified" },
      { label: "verified mutation 后进入 fresh planning round", pass: result?.steps === 2 && ctx.gatewayRequests.length === 2 },
      { label: "最终 taskStatus=completed", pass: result?.taskStatus === "completed" && result?.unresolvedMutations?.length === 0 },
      { label: "真实 carry 状态最终 empty", pass: carry?.status === "empty" },
      { label: "sequence event 记录 mutation barrier", pass: ctx.sequenceEvents.some((event) => event.tool === "dropHeld" && event.executed === true) }
    ];
  }
};
