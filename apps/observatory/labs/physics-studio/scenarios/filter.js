const DRIVE_STEPS = 60;

export const filterScenario = {
  id: "physics.collision.filter-groups",
  title: "碰撞过滤",
  subtitle: "groups + collidesWith 双向许可",
  description: "同一刚体在双向许可成立时被墙体挡住；运行时移除许可后可直接穿过，验证 setCollisionFilter 的即时生效。",
  inspect: "actor",
  setup(ctx) {
    ctx.addBox({ id: "floor", type: "fixed", position: [0, -0.1, 0], halfExtents: [5, 0.1, 4] });
    ctx.addBox({
      id: "actor",
      position: [0, 0.5, 0],
      halfExtents: [0.25, 0.25, 0.25],
      gravityScale:0,
      collision:{ groups:["agent"], collidesWith:["environment"] },
      accent:true
    });
    ctx.addBox({
      id: "wall",
      type: "fixed",
      position: [1, 0.5, 0],
      halfExtents: [0.25, 0.5, 0.5],
      collision:{ groups:["environment"], collidesWith:["agent"] }
    });

    const drive = () => {
      for (let i = 0; i < DRIVE_STEPS; i += 1) ctx.step(1 / 60);
    };
    const launch = () => {
      ctx.physics.setMotion("actor", { linearVelocity:[2, 0, 0], angularVelocity:[0, 0, 0] });
    };

    launch();
    drive();
    const blockedX = ctx.position("actor")[0];

    const filterRemoved = ctx.physics.setCollisionFilter("wall", { groups:["environment"], collidesWith:[] });
    ctx.physics.setPosition("actor", [0, 0.5, 0]);
    launch();
    drive();

    ctx.filterProbe = { blockedX, filterRemoved, openX:ctx.position("actor")[0] };
  },
  assertions(ctx) {
    const probe = ctx?.filterProbe;
    return [
      { label: "双向许可成立时被墙体挡住", pass:(probe?.blockedX ?? 99) < 0.8, detail:`x=${probe?.blockedX?.toFixed(3)}` },
      { label: "运行时移除许可返回成功", pass:probe?.filterRemoved === true },
      { label: "移除许可后穿过墙体", pass:(probe?.openX ?? 0) > 1.2, detail:`x=${probe?.openX?.toFixed(3)}` }
    ];
  }
};
