import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat/rapier.es.js';

const vec = (a = [0, 0, 0]) => ({ x: a[0], y: a[1], z: a[2] });

export class PhysicsSystem {
  constructor() {
    this.world = null;
    this.entries = new Map();
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  addFloor() {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.1, 4), body);
  }

  bodyDesc(type, position) {
    const desc = type === 'dynamic'
      ? RAPIER.RigidBodyDesc.dynamic()
      : type === 'kinematic'
        ? RAPIER.RigidBodyDesc.kinematicPositionBased()
        : RAPIER.RigidBodyDesc.fixed();
    return desc.setTranslation(position.x, position.y, position.z);
  }

  addColliders(body, colliders = [], mass, friction) {
    for (const spec of colliders) {
      let desc;
      if (spec.shape === 'box') desc = RAPIER.ColliderDesc.cuboid(...spec.halfExtents);
      else if (spec.shape === 'cylinder') desc = RAPIER.ColliderDesc.cylinder(spec.halfHeight, spec.radius);
      else if (spec.shape === 'convexHull') {
        desc = RAPIER.ColliderDesc.convexHull(new Float32Array(spec.vertices));
        if (!desc) throw new Error('Rapier rejected a degenerate convex hull collider');
      }
      else continue;
      if (spec.translation) desc.setTranslation(...spec.translation);
      if (mass != null) desc.setMass(mass);
      if (friction != null) desc.setFriction(friction);
      this.world.createCollider(desc, body);
    }
  }

  attach(id, manifest, object) {
    const worldPos = new THREE.Vector3();
    object.getWorldPosition(worldPos);
    const body = this.world.createRigidBody(this.bodyDesc(manifest.physics?.body || 'fixed', worldPos));
    this.addColliders(body, manifest.physics?.colliders, manifest.physics?.mass, manifest.physics?.friction);

    const entry = { body, root: object, parts: new Map(), lastPosition: worldPos.clone() };

    for (const [partName, part] of Object.entries(manifest.parts || {})) {
      if (!part.physics || !part.joint) continue;
      const node = object.getObjectByName(part.node);
      if (!node) continue;

      const partWorld = new THREE.Vector3();
      node.getWorldPosition(partWorld);
      const child = this.world.createRigidBody(this.bodyDesc(part.physics.body || 'dynamic', partWorld));
      this.addColliders(child, part.physics.colliders, part.physics.mass, part.physics.friction);

      let data;
      if (part.joint.type === 'revolute') {
        data = RAPIER.JointData.revolute(vec(part.joint.parentAnchor), vec(part.joint.childAnchor), vec(part.joint.axis));
      } else {
        data = RAPIER.JointData.prismatic(vec(part.joint.parentAnchor), vec(part.joint.childAnchor), vec(part.joint.axis));
      }
      const joint = this.world.createImpulseJoint(data, body, child, true);
      if (part.joint.limits) joint.setLimits(part.joint.limits[0], part.joint.limits[1]);
      entry.parts.set(partName, { body: child, joint, node, spec: part });
    }

    this.entries.set(id, entry);
  }

  setPosition(id, position) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const next = new THREE.Vector3(...position);
    const delta = next.clone().sub(entry.lastPosition);
    entry.body.setTranslation(vec(position), true);
    entry.body.setLinvel?.({ x: 0, y: 0, z: 0 }, true);
    for (const { body } of entry.parts.values()) {
      const p = body.translation();
      body.setTranslation({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z }, true);
      body.setLinvel?.({ x: 0, y: 0, z: 0 }, true);
      body.wakeUp();
    }
    entry.lastPosition.copy(next);
  }

  beginTransform(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.originalType = entry.body.bodyType();
    entry.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    for (const part of entry.parts.values()) {
      part.originalType = part.body.bodyType();
      part.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
  }

  syncTransform(id, object) {
    const entry = this.entries.get(id);
    if (!entry) return;
    object.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    object.getWorldPosition(p);
    object.getWorldQuaternion(q);
    entry.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    entry.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    entry.lastPosition.copy(p);
    for (const part of entry.parts.values()) {
      const pp = new THREE.Vector3();
      const pq = new THREE.Quaternion();
      part.node.getWorldPosition(pp);
      part.node.getWorldQuaternion(pq);
      part.body.setTranslation({ x: pp.x, y: pp.y, z: pp.z }, true);
      part.body.setRotation({ x: pq.x, y: pq.y, z: pq.z, w: pq.w }, true);
    }
  }

  endTransform(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.originalType != null) entry.body.setBodyType(entry.originalType, true);
    delete entry.originalType;
    for (const part of entry.parts.values()) {
      if (part.originalType != null) part.body.setBodyType(part.originalType, true);
      delete part.originalType;
      part.body.wakeUp();
    }
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    for (const part of entry.parts.values()) this.world.removeRigidBody(part.body);
    this.world.removeRigidBody(entry.body);
    this.entries.delete(id);
    return true;
  }

  setHeld(id, held) {
    const body = this.entries.get(id)?.body;
    if (!body) return;
    body.setBodyType(held ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
  }

  setHeldTarget(id, target) {
    this.entries.get(id)?.body?.setNextKinematicTranslation(target);
  }

  setArticulationTarget(id, partName, target) {
    const part = this.entries.get(id)?.parts.get(partName);
    if (!part) return false;
    const motor = part.spec.joint.motor || {};
    part.joint.configureMotorPosition(target, motor.stiffness ?? 40, motor.damping ?? 8);
    part.body.wakeUp();
    return true;
  }

  step(dt, store) {
    this.world.timestep = dt;
    this.world.step();

    for (const [id, entry] of this.entries) {
      const record = store.has(id) ? store.get(id) : null;
      if (!record) continue;

      if (!entry.body.isFixed()) {
        const p = entry.body.translation();
        const q = entry.body.rotation();
        record.object.position.set(p.x, p.y, p.z);
        record.object.quaternion.set(q.x, q.y, q.z, q.w);
        entry.lastPosition.set(p.x, p.y, p.z);
      }

      const rootWorldQ = new THREE.Quaternion();
      record.object.getWorldQuaternion(rootWorldQ);
      const inverseRoot = rootWorldQ.clone().invert();
      for (const { body, node } of entry.parts.values()) {
        const q = body.rotation();
        const localQ = inverseRoot.multiply(new THREE.Quaternion(q.x, q.y, q.z, q.w));
        node.quaternion.copy(localQ);
      }
    }
  }
}
