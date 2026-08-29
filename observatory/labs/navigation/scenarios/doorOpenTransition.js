export const navigationDoorOpenTransitionScenario = {
  id: "navigation.action.door-open-transition",
  title: "Door Open Transition",
  subtitle: "真实 Physics 更新解锁当前路径",
  description: "关闭门先阻断 Recast 路径；随后驱动 Rapier revolute motor 到 open target，TileCache 同步旋转 obstacle，当前世界重新可达。",
  async setup(ctx) {
    await ctx.enableRapierPhysics();
    ctx.addStaticBox({ id: "floor", size: [10, 0.2, 8], position: [0, -0.1, 0], color: 0x667585 });
    ctx.addArticulatedDoor({ id: "door-blocker", halfExtents: [0.25, 1, 4], position: [0, 1, 0], openTarget: -1.2 });
    ctx.stepPhysics(20);
    const build = await ctx.rebuild();
    if (!build.success) return;

    const closed = await ctx.findPath([-4, 0, 0], [4, 0, 0]);
    const targetAccepted = ctx.physics.setArticulationTarget("door-blocker", "door", -1.2);
    ctx.stepPhysics(320);
    const articulation = ctx.physics.articulationState("door-blocker", "door", { target: -1.2 });
    const opened = await ctx.findPath([-4, 0, 0], [4, 0, 0]);
    ctx.transition = { closed, targetAccepted, articulation, opened };
  },
  assertions(ctx) {
    const debug = ctx.debugSnapshot();
    const transition = debug.transition;
    const angle = debug.obstacles?.[0]?.angle;
    return [
      { label: "关闭门时当前路径被阻断", pass: transition?.closed?.reachable === false && transition?.closed?.reason === "PARTIAL_PATH" },
      { label: "Rapier 接受 open motor target", pass: transition?.targetAccepted === true },
      { label: "真实门体收敛到 open target", pass: Math.abs(transition?.articulation?.error ?? 99) < 0.08, detail: `error=${transition?.articulation?.error}` },
      { label: "Physics obstacle 旋转已同步到 Recast", pass: Number.isFinite(angle) && Math.abs(angle) > 1.0, detail: `angle=${angle}` },
      { label: "打开门后当前世界路径可达", pass: transition?.opened?.reachable === true && transition?.opened?.reason === null, detail: `cost=${transition?.opened?.cost}` },
      { label: "TileCache obstacle sync version 前进", pass: (transition?.opened?.dynamicObstacles?.syncVersion || 0) > (transition?.closed?.dynamicObstacles?.syncVersion || 0) }
    ];
  }
};
