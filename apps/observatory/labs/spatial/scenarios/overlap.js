export const spatialOverlapScenario = {
  id: "spatial.bounds.overlap",
  title: "边界 / 重叠",
  subtitle: "AABB 碰撞对",
  description: "观察 SpatialSystem.snapshot() 产生的世界边界，以及 collisionPairs() 的成对结果。",
  inspect: "box-a",
  setup(ctx) {
    ctx.addBox({ id: "box-a", position: [0, 0.5, 0], color: 0xd4a85e });
    ctx.addBox({ id: "box-b", position: [0.6, 0.5, 0] });
    ctx.addBox({ id: "box-c", position: [3, 0.5, 0] });
  },
  assertions(ctx) {
    const pairs = ctx.debugSnapshot().collisionPairs;
    return [
      { label: "box-a 与 box-b 重叠", pass: pairs.some(([a, b]) => a === "box-a" && b === "box-b") },
      { label: "box-c 不参与重叠", pass: pairs.every(([a, b]) => a !== "box-c" && b !== "box-c") }
    ];
  }
};
