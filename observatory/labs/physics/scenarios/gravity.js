export const gravityScenario = {
  id: "physics.gravity.basic",
  title: "Gravity",
  subtitle: "自由落体",
  description: "验证固定 60 Hz 下的重力、碰撞与 settle 基础行为。",
  inspect: "drop-box",
  setup(ctx) {
    ctx.addBox({ id: "floor", type: "fixed", position: [0, -0.1, 0], halfExtents: [5, 0.1, 4], friction: 0.8 });
    ctx.addBox({ id: "drop-box", position: [0, 5, 0], halfExtents: [0.5, 0.5, 0.5], mass: 1, accent: true });
  },
  assertions(ctx, clock) {
    const p = ctx?.position("drop-box") || [NaN, NaN, NaN];
    return [
      { label: "坐标保持有限", pass: p.every(Number.isFinite) },
      clock.frame < 20 ? { label: "重力使物体向下运动", status: "pending", detail: "等待 20 帧" } : { label: "重力使物体向下运动", pass: p[1] < 4.9, detail: `y=${p[1].toFixed(3)}` },
      { label: "没有穿过地板", pass: p[1] > 0.42, detail: `y=${p[1].toFixed(3)}` }
    ];
  }
};
