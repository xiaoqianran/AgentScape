export const spatialSupportScenario = {
  id: "spatial.support.free-space",
  title: "Support / FreeSpace",
  subtitle: "表面关系与放置候选",
  description: "使用生产 findFreeSpace() 找可放置点，再用 supportStatus() 验证 ON 关系。",
  inspect: "cup",
  setup(ctx) {
    ctx.addBox({
      id: "table",
      size: [3, 0.2, 1.8],
      position: [0, 1, 0],
      color: 0x718192,
      manifest: { actions: [], surfaces: [{ id: "top", localPosition: [0, 0.1, 0], size: [2.8, 1.6] }] }
    });
    const cup = ctx.addBox({ id: "cup", size: [0.3, 0.3, 0.3], position: [0, 2, 0], color: 0xd4a85e, manifest: { actions: ["place"] } });
    ctx.addBox({ id: "blocker", size: [0.65, 0.5, 0.65], position: [0, 1.38, 0] });
    const point = ctx.queryFreeSpace("cup", "table", { surfaceId: "top", clearance: 0.03, grid: 5 });
    if (point) {
      cup.position.copy(point);
      cup.updateWorldMatrix(true, true);
      ctx.querySupport("cup", "table", { surfaceId: "top" });
    }
  },
  assertions(ctx) {
    const debug = ctx.debugSnapshot();
    return [
      { label: "找到 collision-free 放置候选", pass: Array.isArray(debug.freeSpace?.point) },
      { label: "候选通过 supportStatus", pass: debug.support?.on === true, detail: debug.support ? `gap=${debug.support.gap}` : "no support result" },
      { label: "候选未与 blocker 重叠", pass: !debug.collisionPairs.some(([a, b]) => [a, b].includes("cup") && [a, b].includes("blocker")) }
    ];
  }
};
