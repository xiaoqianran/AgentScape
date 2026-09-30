const TRAVEL_STEPS = 150;

export const sensorScenario = {
  id: "physics.collision.sensor-events",
  title: "传感器与事件",
  subtitle: "sensor-entered / sensor-exited",
  description: "无重力刚体穿过传感器体积，验证语义碰撞事件只暴露 AgentScape provenance，不暴露 native handle，且传感器不产生阻挡。",
  inspect: "probe",
  setup(ctx) {
    ctx.addBox({ id: "floor", type: "fixed", position: [0, -0.1, 0], halfExtents: [5, 0.1, 4] });
    ctx.addBox({ id: "trigger", type: "fixed", position: [0, 1, 0], halfExtents: [0.6, 0.6, 0.6], sensor:true, collisionEvents:true });
    ctx.addBox({
      id: "probe",
      position: [-2.4, 1, 0],
      halfExtents: [0.25, 0.25, 0.25],
      gravityScale:0,
      collisionEvents:true,
      accent:true
    });
    ctx.physics.setMotion("probe", { linearVelocity:[2, 0, 0], angularVelocity:[0, 0, 0] });

    const events = [];
    for (let i = 0; i < TRAVEL_STEPS; i += 1) {
      ctx.step(1 / 60);
      events.push(...ctx.physics.getCollisionEvents({ clear:true }));
    }
    ctx.sensorProbe = { events, position:ctx.position("probe") };
  },
  assertions(ctx) {
    const probe = ctx?.sensorProbe;
    const events = probe?.events || [];
    const entered = events.filter((event) => event.type === "sensor-entered");
    const exited = events.filter((event) => event.type === "sensor-exited");
    const semanticOnly = [...entered, ...exited].every((event) => event.a?.kind && event.b?.kind && !("handle" in event.a) && !("handle" in event.b));
    return [
      { label: "刚体进入传感器", pass:entered.length === 1, detail:`${entered.length} 次` },
      { label: "刚体离开传感器", pass:exited.length === 1, detail:`${exited.length} 次` },
      { label: "事件只暴露 AgentScape 语义", pass:semanticOnly },
      { label: "传感器没有阻挡刚体", pass:(probe?.position?.[0] ?? 0) > 0.9, detail:`x=${probe?.position?.[0]?.toFixed(3)}` }
    ];
  }
};
