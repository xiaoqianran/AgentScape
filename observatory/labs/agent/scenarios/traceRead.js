export const agentTraceReadScenario = {
  id: "agent.trace.read-tool",
  title: "Trace · Read Tool",
  subtitle: "Gateway → getBounds → final",
  description: "Scripted gateway 第一轮请求 getBounds；ToolCallingAgent 通过真实 AgentTools/scene+spatial skills 执行，第二轮返回最终答案。",
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
      { label: "只读任务最终 no-mutation", pass: result?.taskStatus === "no-mutation" },
      { label: "execution 记录 getBounds", pass: result?.execution?.some((entry) => entry.tool === "getBounds" && entry.executed === true) },
      { label: "真实 tool.called 同时记录 listObjects/getBounds", pass: ctx.toolCalls.some((event) => event.name === "listObjects") && ctx.toolCalls.some((event) => event.name === "getBounds") },
      { label: "最终答案来自第二轮 gateway", pass: result?.message === "table bounds checked" }
    ];
  }
};
