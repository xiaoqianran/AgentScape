export const agentGetBoundsScenario = {
  id: "agent.tool.get-bounds",
  title: "获取边界（getBounds）",
  subtitle: "AgentTools → 空间技能",
  description: "AgentTools.call(getBounds) 经过 SkillRegistry 与空间领域技能包，读取真实 table 世界边界。",
  async setup(ctx) {
    await ctx.world.addAsset({ id: "table", assetId: "table", position: [0, 0, 0] });
    const result = await ctx.call("getBounds", { id: "table" });
    ctx.transition = { result };
  },
  assertions(ctx) {
    const { result } = ctx.transition;
    return [
      { label: "AgentTools 暴露 getBounds 定义", pass: ctx.tools.definitions().some((item) => item.name === "getBounds") },
      { label: "工具返回真实 table 边界", pass: result?.id === "table" && result?.size?.every(Number.isFinite) },
      { label: "工具调用事件已记录", pass: ctx.toolCalls.at(-1)?.name === "getBounds" }
    ];
  }
};
