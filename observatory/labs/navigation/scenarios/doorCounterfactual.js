export const navigationDoorCounterfactualScenario = {
  id: "navigation.action.door-counterfactual",
  title: "Door Counterfactual",
  subtitle: "Rapier obstacle → Recast action diagnosis",
  description: "真实 Rapier 动态门 collider 阻断路径；NavigationSystem.suggestActions() 临时 suppress obstacle，验证 open 是 provisional unlock，同时恢复 current-world truth。",
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
      { label: "Rapier 产生真实门 obstacle", pass: debug.physicsObstacles?.items?.length === 1, detail: debug.physicsObstacles?.items?.[0]?.id || "no obstacle" },
      { label: "Recast 当前世界被门阻断", pass: debug.route?.reachable === false && debug.route?.reason === "PARTIAL_PATH", detail: debug.route?.reason || "reachable" },
      { label: "Action-aware diagnosis 推荐 open", pass: debug.diagnosis?.status === "action-candidate" && debug.diagnosis?.recommendation?.call?.name === "open" },
      { label: "Suppress 门 obstacle 后 counterfactual 可达", pass: candidate?.counterfactual?.reachable === true && candidate?.counterfactual?.provisional === true },
      { label: "Counterfactual 后 current-world truth 已恢复", pass: ctx.currentAfterDiagnosis?.reachable === false && ctx.navigation.status().dynamicObstacles.tracked === 1 }
    ];
  }
};
