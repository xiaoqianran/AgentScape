export const spatialRaycastScenario = {
  id: "spatial.raycast.bvh",
  title: "Raycast",
  subtitle: "three-mesh-bvh 命中顺序",
  description: "从左向右发射 Ray，直接观察生产 SpatialSystem.raycast() 的 BVH 命中结果。",
  inspect: "near-box",
  setup(ctx) {
    ctx.addBox({ id: "near-box", position: [-1, 0.5, 0], color: 0xd4a85e });
    ctx.addBox({ id: "mid-box", position: [1, 0.5, 0.25] });
    ctx.addBox({ id: "far-box", position: [3, 0.5, -0.2] });
    ctx.raycast([-4, 0.5, 0], [1, 0, 0], 9);
  },
  afterStep(ctx, clock) {
    const z = Math.sin(clock.time * 1.5) * 0.07;
    ctx.raycast([-4, 0.5, 0], [1, 0, z], 9);
  },
  assertions(ctx) {
    const debug = ctx.debugSnapshot();
    return [
      { label: "BVH acceleratedRaycast 已启用", pass: debug.bvh.installed && debug.bvh.raycast === "three-mesh-bvh" },
      { label: "Ray 至少命中一个对象", pass: (debug.ray?.hits?.length || 0) > 0 },
      { label: "最近命中 near-box", pass: debug.ray?.hits?.[0]?.id === "near-box", detail: debug.ray?.hits?.[0]?.id || "no hit" }
    ];
  }
};
