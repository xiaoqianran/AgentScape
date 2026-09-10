export const agentFindFreeSpaceScenario = {
  id: "agent.tool.find-free-space",
  title: "寻找自由空间（findFreeSpace）",
  subtitle: "AgentTools → 空间支撑面",
  description: "AgentTools 通过空间技能在真实 table.top 上为真实杯子寻找无碰撞放置候选。",
  async setup(ctx) {
    await ctx.world.addAsset({ id: "table", assetId: "table", position: [0, 0, 0] });
    await ctx.world.addAsset({ id: "cup", assetId: "cup", position: [3, 0, 0] });
    const result = await ctx.call("findFreeSpace", { id: "cup", targetId: "table", surfaceId: "top", clearance: 0.03 });
    ctx.transition = { result };
  },
  assertions(ctx) {
    const { result } = ctx.transition;
    return [
      { label: "AgentTools 返回放置候选", pass: Array.isArray(result) && result.length === 3 && result.every(Number.isFinite) },
      { label: "候选位于 table 顶面高度", pass: Math.abs(result?.[1] - 1.13) < 0.02 }
    ];
  }
};
