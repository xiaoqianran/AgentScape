export const agentTraceReadScenario = {
  id: "agent.trace.read-tool",
  title: "轨迹 · 只读工具",
  subtitle: "网关 → getBounds → 最终结果",
  description: "脚本网关第一轮请求 getBounds；ToolCallingAgent 通过真实 AgentTools/场景与空间技能执行，第二轮返回最终答案。",
  trace: true,
  async setup(ctx) {
    await ctx.world.addAsset({ id: "table", assetId: "table", position: [0, 0, 0] });
    const result = await ctx.runAgent("查看 table 的 bounds", [
      { message: "", toolCalls: [{ id: "bounds-1", name: "getBounds", args: { id: "table" } }] },
      { message: "table bounds checked", toolCalls: [] }
    ]);
    ctx.transition = { result };
  },
  assertions(ctx) {
    const result = ctx.transition.result;
    return [
      { label: "ToolCallingAgent 完成两轮规划", pass: result?.steps === 2 && ctx.gatewayRequests.length === 2 },
      { label: "只读任务最终无变更", pass: result?.taskStatus === "no-mutation" },
      { label: "执行记录包含 getBounds", pass: result?.execution?.some((entry) => entry.tool === "getBounds" && entry.executed === true) },
      { label: "真实工具调用同时记录 listObjects/getBounds", pass: ctx.toolCalls.some((event) => event.name === "listObjects") && ctx.toolCalls.some((event) => event.name === "getBounds") },
      { label: "最终答案来自第二轮网关", pass: result?.message === "table bounds checked" }
    ];
  }
};
