import RAPIER from '@dimforge/rapier3d-compat';

export class PhysicsSystem {
  constructor() { this.world = null; this.entries = new Map(); }
  async init() { await RAPIER.init(); this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); }
  addFloor() {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.1, 4), body);
  }
  attach(id, assetId, object) {
    const p = object.position;
    let body; let yOffset = 0;
    if (assetId === 'cup') {
      body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y + 0.16, p.z));
      this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.16, 0.15).setMass(0.3), body); yOffset = -0.16;
    } else if (assetId === 'table') {
      body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(1.2, 0.08, 0.625).setTranslation(0, 1, 0), body);
      for (const x of [-1.02, 1.02]) for (const z of [-0.46, 0.46]) this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.07, 0.47, 0.07).setTranslation(x, 0.47, z), body);
    } else if (assetId === 'cabinet') {
      body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y + 1, p.z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.85, 1, 0.36), body); yOffset = -1;
    }
    if (body) this.entries.set(id, { body, yOffset });
  }
  setPosition(id, position) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.body.setTranslation({ x: position[0], y: position[1] - entry.yOffset, z: position[2] }, true);
    entry.body.setLinvel?.({ x: 0, y: 0, z: 0 }, true);
  }
  setHeld(id, held) {
    const body = this.entries.get(id)?.body; if (!body) return;
    body.setBodyType(held ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
  }
  setHeldTarget(id, target) { this.entries.get(id)?.body?.setNextKinematicTranslation(target); }
  step(dt, store) {
    this.world.timestep = dt; this.world.step();
    for (const [id, entry] of this.entries) {
      const record = store.has(id) ? store.get(id) : null;
      if (!record || entry.body.isFixed()) continue;
      const p = entry.body.translation(); const q = entry.body.rotation();
      record.object.position.set(p.x, p.y + entry.yOffset, p.z); record.object.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }
}
