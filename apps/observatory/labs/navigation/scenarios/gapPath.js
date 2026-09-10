export const navigationGapScenario = {
  id: "navigation.path.gap",
  title: "间隙 / 门洞",
  subtitle: "墙体留通行门洞",
  description: "在连续地面中央放两段墙，中间留 1.4m 通道，验证智能体半径侵蚀后仍能穿过门洞。",
  async setup(ctx) {
    ctx.addStaticBox({ id: "floor", size: [12, 0.2, 8], position: [0, -0.1, 0], color: 0x667585 });
    ctx.addStaticBox({ id: "wall-north", size: [0.5, 2.4, 3.3], position: [0, 1.2, -2.35], color: 0x8c6f62 });
    ctx.addStaticBox({ id: "wall-south", size: [0.5, 2.4, 3.3], position: [0, 1.2, 2.35], color: 0x8c6f62 });
    const build = await ctx.rebuild();
    if (build.success) await ctx.findPath([-4, 0, 0], [4, 0, 0]);
  },
  assertions(ctx) {
    const debug = ctx.debugSnapshot();
    const path = debug.route?.path || [];
    const start = path[0];
    const end = path.at(-1);
    const crossesCenterGap = Array.isArray(start) && Array.isArray(end)
      && start[0] < 0 && end[0] > 0
      && Math.abs(start[2]) < 0.7 && Math.abs(end[2]) < 0.7;
    return [
      { label: "门洞场景 NavMesh 构建成功", pass: debug.build?.success === true },
      { label: "门洞允许导航通过", pass: debug.route?.reachable === true, detail: debug.route?.reason || `代价=${debug.route?.cost}` },
      { label: "路径穿过中央门洞区域", pass: crossesCenterGap, detail: `${path.length} 个路径点` }
    ];
  }
};
