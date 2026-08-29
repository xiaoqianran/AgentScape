export const agentTraceDropScenario = {
  id: "agent.trace.verified-mutation",
  title: "轨迹 · 已验证变更",
  subtitle: "dropHeld → 稳定 → 重新规划 → 最终结果",
  description: "脚本网关请求 dropHeld；ToolCallingAgent 等真实 Rapier 稳定后把变更标为已验证，并进入新规划轮次再输出最终答案。",
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
      { label: "dropHeld 是已验证变更", pass: result?.lastMutation?.tool === "dropHeld" && result?.lastMutation?.outcome?.state === "verified" },
      { label: "已验证变更后进入新的规划轮次", pass: result?.steps === 2 && ctx.gatewayRequests.length === 2 },
      { label: "最终任务状态为已完成", pass: result?.taskStatus === "completed" && result?.unresolvedMutations?.length === 0 },
      { label: "真实持有状态最终为空", pass: carry?.status === "empty" },
      { label: "序列事件记录变更屏障", pass: ctx.sequenceEvents.some((event) => event.tool === "dropHeld" && event.executed === true) }
    ];
  }
};
