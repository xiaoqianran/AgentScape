export const collisionScenario = {
  id: "physics.collision.pedestal",
  title: "碰撞",
  subtitle: "落体碰撞平台",
  description: "动态刚体落到固定平台，观察原生碰撞体与求解结果。",
  inspect: "impact-box",
  setup(ctx) {
    ctx.addBox({ id: "floor", type: "fixed", position: [0, -0.1, 0], halfExtents: [5, 0.1, 4] });
    ctx.addBox({ id: "pedestal", type: "fixed", position: [0, 0.75, 0], halfExtents: [1.4, 0.75, 1.4] });
    ctx.addBox({ id: "impact-box", position: [0.3, 4.5, 0], halfExtents: [0.5, 0.5, 0.5], mass: 1.5, accent: true });
  },
  assertions(ctx, clock) {
    const p = ctx?.position("impact-box") || [NaN, NaN, NaN];
    const motion = ctx?.motion("impact-box");
    return [
      clock.frame < 50 ? { label: "动态刚体接近平台", status: "pending" } : { label: "动态刚体已下降", pass: p[1] < 4, detail: `y=${p[1].toFixed(3)}` },
      { label: "碰撞后没有穿透平台", pass: p[1] > 1.88, detail: `y=${p[1].toFixed(3)}` },
      clock.frame < 150 ? { label: "最终进入低速/休眠", status: "pending" } : { label: "最终进入低速/休眠", pass: motion?.sleeping || (motion?.linearSpeed ?? 99) < 0.08, detail: `速度=${(motion?.linearSpeed ?? NaN).toFixed(4)}` }
    ];
  }
};
