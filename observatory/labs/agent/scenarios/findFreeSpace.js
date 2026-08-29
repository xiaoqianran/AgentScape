export const agentFindFreeSpaceScenario = {
  id: "agent.tool.find-free-space",
  title: "findFreeSpace",
  subtitle: "AgentTools → Spatial support surface",
  description: "AgentTools 通过 spatial skill 在真实 table.top 上为真实 cup 找 collision-free placement 候选。",
  async setup(ctx) {
    await ctx.world.addAsset({ id: "table", assetId: "table", position: [0, 0, 0] });
    await ctx.world.addAsset({ id: "cup", assetId: "cup", position: [3, 0, 0] });
    const result = await ctx.call("findFreeSpace", { id: "cup", targetId: "table", surfaceId: "top", clearance: 0.03 });
    ctx.transition = { result };
  },
  assertions(ctx) {
    const { result } = ctx.transition;
    return [
      { label: "AgentTools 返回 placement candidate", pass: Array.isArray(result) && result.length === 3 && result.every(Number.isFinite) },
      { label: "候选落在 table top 高度", pass: Math.abs(result?.[1] - 1.13) < 0.02 }
    ];
  }
};
