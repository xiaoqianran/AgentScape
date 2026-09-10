export const stackScenario = {
  id: "physics.stack.five",
  title: "堆叠",
  subtitle: "五层箱体稳定性",
  description: "观察接触求解、堆叠稳定性、休眠状态与原生碰撞体。",
  inspect: "box-5",
  setup(ctx) {
    ctx.addBox({ id: "floor", type: "fixed", position: [0, -0.1, 0], halfExtents: [5, 0.1, 4], friction: 0.9 });
    for (let i = 0; i < 5; i += 1) {
      ctx.addBox({ id: `box-${i + 1}`, position: [i % 2 ? 0.025 : -0.025, 0.52 + i * 1.02, 0], halfExtents: [0.5, 0.5, 0.5], mass: 1, friction: 0.8, accent: i === 4 });
    }
  },
  assertions(ctx, clock) {
    const positions = Array.from({ length: 5 }, (_, i) => ctx?.position(`box-${i + 1}`));
    const topMotion = ctx?.motion("box-5");
    return [
      { label: "所有刚体坐标有限", pass: positions.every((p) => p?.every(Number.isFinite)) },
      { label: "堆叠没有穿过地面", pass: positions.every((p) => p?.[1] > 0.42) },
      clock.frame < 240 ? { label: "堆叠最终稳定", status: "pending", detail: "等待 240 帧" } : { label: "堆叠最终稳定", pass: topMotion?.sleeping || (topMotion?.linearSpeed ?? 99) < 0.12, detail: `顶部速度=${(topMotion?.linearSpeed ?? NaN).toFixed(4)}` }
    ];
  }
};
