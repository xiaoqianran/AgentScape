export const hingeScenario = {
  id: "physics.joint.hinge",
  title: "铰链",
  subtitle: "柜门旋转关节",
  description: "复用生产关节结构契约，观察关节电机、限位与门的真实姿态。",
  inspect: "cabinet_01",
  setup(ctx) {
    ctx.addBox({ id: "floor", type: "fixed", position: [0, -0.1, 0], halfExtents: [5, 0.1, 4] });
    ctx.addHingeCabinet({ id: "cabinet_01", target: -1 });
  },
  assertions(ctx, clock) {
    const state = ctx?.articulation("cabinet_01", "door", -1);
    const coordinate = state?.coordinate ?? 0;
    return [
      { label: "关节类型为旋转关节", pass: state?.jointType === "revolute" },
      clock.frame < 60 ? { label: "门朝目标角度运动", status: "pending" } : { label: "门朝目标角度运动", pass: coordinate < -0.2, detail: `角度=${coordinate.toFixed(3)} rad` },
      clock.frame < 180 ? { label: "关节电机收敛到目标附近", status: "pending" } : { label: "关节电机收敛到目标附近", pass: Math.abs(state?.error ?? 99) < 0.25, detail: `误差=${(state?.error ?? NaN).toFixed(3)}` }
    ];
  }
};
