export const navigationDoorCounterfactualScenario = {
  id: "navigation.action.door-counterfactual",
  title: "门状态反事实",
  subtitle: "Rapier 障碍物 → Recast 动作诊断",
  description: "真实 Rapier 动态门碰撞体阻断路径；NavigationSystem.suggestActions() 临时抑制障碍物，验证打开动作（open）可作为临时解锁动作，同时恢复当前世界真值。",
  async setup(ctx) {
    await ctx.enableRapierPhysics();
    ctx.addStaticBox({ id: "floor", size: [10, 0.2, 8], position: [0, -0.1, 0], color: 0x667585 });
    ctx.addArticulatedDoor({ id: "door-blocker", halfExtents: [0.25, 1, 4], position: [0, 1, 0], openTarget: -1.2 });
    ctx.stepPhysics(20);
    const build = await ctx.rebuild();
    if (!build.success) return;
    await ctx.diagnoseActions([-4, 0, 0], [4, 0, 0]);
    ctx.currentAfterDiagnosis = await ctx.navigation.findPath([-4, 0, 0], [4, 0, 0]);
  },
  assertions(ctx) {
    const debug = ctx.debugSnapshot();
    const candidate = debug.diagnosis?.candidates?.[0];
    return [
      { label: "Rapier 产生真实门障碍物", pass: debug.physicsObstacles?.items?.length === 1, detail: debug.physicsObstacles?.items?.[0]?.id || "无障碍物" },
      { label: "Recast 当前世界被门阻断", pass: debug.route?.reachable === false && debug.route?.reason === "PARTIAL_PATH", detail: debug.route?.reason || "可达" },
      { label: "动作感知诊断推荐打开（open）", pass: debug.diagnosis?.status === "action-candidate" && debug.diagnosis?.recommendation?.call?.name === "open" },
      { label: "抑制门障碍物后反事实路径可达", pass: candidate?.counterfactual?.reachable === true && candidate?.counterfactual?.provisional === true },
      { label: "反事实计算后当前世界真值已恢复", pass: ctx.currentAfterDiagnosis?.reachable === false && ctx.navigation.status().dynamicObstacles.tracked === 1 }
    ];
  }
};
