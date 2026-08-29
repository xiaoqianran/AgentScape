export const agentGetBoundsScenario = {
  id: "agent.tool.get-bounds",
  title: "getBounds",
  subtitle: "AgentTools → spatialSkills",
  description: "AgentTools.call(getBounds) 穿过 SkillRegistry 与 spatial domain pack，读取真实 table world bounds。",
  async setup(ctx) {
    await ctx.world.addAsset({ id: "table", assetId: "table", position: [0, 0, 0] });
    const result = await ctx.call("getBounds", { id: "table" });
    ctx.transition = { result };
  },
  assertions(ctx) {
    const { result } = ctx.transition;
    return [
      { label: "AgentTools 暴露 getBounds definition", pass: ctx.tools.definitions().some((item) => item.name === "getBounds") },
      { label: "工具返回真实 table bounds", pass: result?.id === "table" && result?.size?.every(Number.isFinite) },
      { label: "tool.called 事件被记录", pass: ctx.toolCalls.at(-1)?.name === "getBounds" }
    ];
  }
};
