export const agentRaycastScenario = {
  id: "agent.tool.raycast",
  title: "射线检测（raycast）",
  subtitle: "AgentTools → BVH 空间查询",
  description: "AgentTools 调用 spatialSkills.raycast，底层使用生产 SpatialSystem 与 three-mesh-bvh。",
  async setup(ctx) {
    ctx.world.addBlocker({ id: "near", size: [1, 1, 1], position: [-1, 0.5, 0] });
    ctx.world.addBlocker({ id: "far", size: [1, 1, 1], position: [2, 0.5, 0] });
    const result = await ctx.call("raycast", { origin: [-4, 0.5, 0], direction: [1, 0, 0], maxDistance: 10 });
    ctx.transition = { result };
  },
  assertions(ctx) {
    const { result } = ctx.transition;
    return [
      { label: "射线检测返回对象序列", pass: Array.isArray(result) && result.length === 2 },
      { label: "最近命中 near", pass: result?.[0]?.id === "near" },
      { label: "每个实例只返回一次", pass: new Set(result.map((hit) => hit.id)).size === result.length }
    ];
  }
};
