export const navigationDisconnectedScenario = {
  id: "navigation.path.disconnected",
  title: "断开区域",
  subtitle: "两个断开的 NavMesh 岛",
  description: "两块平台之间保留宽间隙，验证 Recast/Detour 对断开导航区域返回 NO_PATH/PARTIAL_PATH。",
  async setup(ctx) {
    ctx.addStaticBox({ id: "left-island", size: [3, 0.2, 5], position: [-3.2, -0.1, 0], color: 0x667585 });
    ctx.addStaticBox({ id: "right-island", size: [3, 0.2, 5], position: [3.2, -0.1, 0], color: 0x667585 });
    const build = await ctx.rebuild();
    if (build.success) await ctx.findPath([-3.2, 0, 0], [3.2, 0, 0]);
  },
  assertions(ctx) {
    const debug = ctx.debugSnapshot();
    return [
      { label: "断岛 NavMesh 仍可构建", pass: debug.build?.success === true },
      { label: "两岛之间不可达", pass: debug.route?.reachable === false, detail: debug.route?.reason || "意外可达" },
      { label: "失败原因来自导航查询", pass: ["NO_PATH", "PARTIAL_PATH"].includes(debug.route?.reason) }
    ];
  }
};
