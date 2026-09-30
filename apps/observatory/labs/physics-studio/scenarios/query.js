const PROBE_MANIFEST = {
  id: "query-fixture",
  source: { kind: "builtin" },
  physics: { body: "fixed", colliders: [{ shape: "box", halfExtents: [0.45, 0.45, 0.45] }] }
};

export const queryScenario = {
  id: "physics.query.raycast-checks",
  title: "查询与预检",
  subtitle: "raycast / checkBodyPose / checkManifestPose",
  description: "射线命中、携行位姿预检与 Manifest 位姿预检都返回结构化结果（checked/clear/blockedBy），而不是裸布尔值。",
  inspect: "mover",
  setup(ctx) {
    ctx.addBox({ id: "floor", type: "fixed", position: [0, -0.1, 0], halfExtents: [2, 0.1, 2] });
    ctx.addBox({ id: "pillar", type: "fixed", position: [0, 1, 0], halfExtents: [0.4, 0.9, 0.4] });
    ctx.addCapsule({
      id: "mover",
      type: "dynamic",
      position: [1.4, 0, 0],
      halfHeight: 0.2,
      radius: 0.25,
      translation: [0, 1, 0],
      gravityScale:0,
      accent:true
    });
    ctx.step(1 / 60);

    ctx.queryProbe = {
      hit:ctx.physics.raycast([-4, 1, 0], [4, 1, 0]),
      miss:ctx.physics.raycast([-4, 3, 0], [4, 3, 0]),
      blockedPose:ctx.physics.checkBodyPose("mover", [0, 0, 0]),
      clearPose:ctx.physics.checkBodyPose("mover", [-3.5, 2, 0]),
      blockedMotion:ctx.physics.checkBodyMotion("mover", [0, 0, 0]),
      blockedManifest:ctx.physics.checkManifestPose(PROBE_MANIFEST, [0, 1, 0]),
      clearManifest:ctx.physics.checkManifestPose(PROBE_MANIFEST, [-3.5, 2, 0])
    };
  },
  assertions(ctx) {
    const probe = ctx?.queryProbe;
    return [
      { label: "射线命中柱子并给出对象 ID", pass:probe?.hit?.id === "pillar", detail:probe?.hit?.id || "miss" },
      { label: "射线未命中时返回 null", pass:probe?.miss === null },
      { label: "携行位姿预检发现阻挡", pass:probe?.blockedPose?.clear === false, detail:probe?.blockedPose?.code || "blocked" },
      { label: "空地携行位姿预检通过", pass:probe?.clearPose?.clear === true },
      { label: "携行运动预检发现扫掠阻挡", pass:probe?.blockedMotion?.clear === false, detail:probe?.blockedMotion?.code || "blocked" },
      { label: "Manifest 预检在占用位置不通过", pass:probe?.blockedManifest?.clear === false, detail:(probe?.blockedManifest?.blockedBy || []).join(",") },
      { label: "Manifest 预检在空地通过", pass:probe?.clearManifest?.clear === true }
    ];
  }
};
