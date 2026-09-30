const WALK_STEPS = 180;

export const characterScenario = {
  id: "physics.character.kinematic",
  title: "角色控制器",
  subtitle: "胶囊体 KCC 行走与朝向",
  description: "用生产 Kinematic Character Controller 驱动胶囊体走向固定墙体，验证 moveCharacter / cancelCharacterMovement / faceCharacter / setCharacterYaw 与 navigationObstacle 契约。",
  inspect: "actor",
  setup(ctx) {
    ctx.addBox({ id: "floor", type: "fixed", position: [0, -0.1, 0], halfExtents: [4, 0.1, 3], friction: 0.8 });
    ctx.addBox({ id: "wall", type: "fixed", position: [0, 1.5, 0], halfExtents: [0.1, 1.5, 2.5] });
    ctx.addCapsule({
      id: "actor",
      type: "kinematic",
      position: [-2, 0, 0],
      halfHeight: 0.53,
      radius: 0.32,
      translation: [0, 0.85, 0],
      navigationObstacle: false,
      accent: true
    });

    let firstMove = null;
    for (let i = 0; i < WALK_STEPS; i += 1) {
      const result = ctx.physics.moveCharacter("actor", [0.035, -0.01, 0]);
      if (!firstMove) firstMove = result;
      ctx.step(1 / 60);
    }

    ctx.characterProbe = {
      move:firstMove,
      face:ctx.physics.faceCharacter("actor", [1, 0, 0]),
      cancel:ctx.physics.cancelCharacterMovement("actor"),
      yaw:ctx.physics.setCharacterYaw("actor", Math.PI / 2),
      position:ctx.position("actor"),
      obstacles:ctx.physics.getNavigationObstacles()
    };
  },
  assertions(ctx) {
    const probe = ctx?.characterProbe;
    const position = probe?.position || [NaN, NaN, NaN];
    return [
      { label: "moveCharacter 由生产 KCC 执行成功", pass:probe?.move?.success === true, detail:probe?.move?.code || "success" },
      { label: "角色被固定墙体挡住而不是穿透", pass:position[0] > -0.8 && position[0] < -0.38, detail:`x=${position[0]?.toFixed(3)}` },
      { label: "角色没有陷入地面", pass:position[1] > -0.02, detail:`y=${position[1]?.toFixed(3)}` },
      { label: "faceCharacter 接受 kinematic 角色转向", pass:probe?.face === true },
      { label: "setCharacterYaw 写入朝向", pass:probe?.yaw === true },
      { label: "navigationObstacle=false 的角色不进入导航障碍", pass:(probe?.obstacles?.items || []).every((item) => item.objectId !== "actor") }
    ];
  }
};
