export const navigationSimplePathScenario = {
  id: "navigation.path.simple",
  title: "简单路径",
  subtitle: "单连通地面",
  description: "在单块可行走地面上构建 Recast NavMesh，并查询一条左右直达路径。",
  async setup(ctx) {
    ctx.addStaticBox({ id: "floor", size: [12, 0.2, 8], position: [0, -0.1, 0], color: 0x667585 });
    const build = await ctx.rebuild();
    if (build.success) await ctx.findPath([-4, 0, 0], [4, 0, 0]);
  },
  assertions(ctx) {
    const debug = ctx.debugSnapshot();
    return [
      { label: "Recast NavMesh 构建成功", pass: debug.build?.success === true },
      { label: "NavMesh 产生三角形", pass: (debug.navMesh?.triangleCount || 0) > 0 },
      { label: "左右端点可达", pass: debug.route?.reachable === true, detail: debug.route?.reason || `代价=${debug.route?.cost}` },
      { label: "路径包含有效路径点", pass: (debug.route?.path?.length || 0) >= 2 }
    ];
  }
};
