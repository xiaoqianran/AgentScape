import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat/rapier.es.js';
import { orderParts, ROOT_PART } from '../../assets/parts.js';

const vec = (a = [0, 0, 0]) => ({ x: a[0], y: a[1], z: a[2] });

export class PhysicsSystem {
  constructor() {
    this.world = null;
    this.entries = new Map();
    this.rootRotation = new THREE.Quaternion();
    this.inverseRootRotation = new THREE.Quaternion();
    this.partWorldRotation = new THREE.Quaternion();
    this.partLocalRotation = new THREE.Quaternion();
    this.rootWorldPosition = new THREE.Vector3();
    this.partWorldPosition = new THREE.Vector3();
    this.partLocalPosition = new THREE.Vector3();
    this.parentWorldPosition = new THREE.Vector3();
    this.parentWorldRotation = new THREE.Quaternion();
    this.inverseParentWorldRotation = new THREE.Quaternion();
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
    const createdBodies = [];
    try {
      const worldPos = new THREE.Vector3();
      const worldRot = new THREE.Quaternion();
      object.getWorldPosition(worldPos);
      object.getWorldQuaternion(worldRot);
      const body = this.world.createRigidBody(this.bodyDesc(manifest.physics?.body || 'fixed', worldPos));
      body.setRotation({ x:worldRot.x, y:worldRot.y, z:worldRot.z, w:worldRot.w }, true);
      createdBodies.push(body);
      this.addColliders(body, manifest.physics?.colliders, manifest.physics?.mass, manifest.physics?.friction);

      const entry = { body, root: object, parts: new Map(), lastPosition: worldPos.clone(), lastRotation: worldRot.clone() };
      const bodies = new Map([[ROOT_PART, body]]);
      for (const [partName, part] of orderParts(manifest.parts || {})) {
        if (!part.physics || !part.joint) continue;
        const node = object.getObjectByName(part.node);
        if (!node) continue;
        const parentName = part.parent || ROOT_PART;
        const parentBody = bodies.get(parentName);
        if (!parentBody) throw new Error(`Part parent body not available: ${partName} -> ${parentName}`);

        const partWorld = new THREE.Vector3();
        const partRotation = new THREE.Quaternion();
        node.getWorldPosition(partWorld);
        node.getWorldQuaternion(partRotation);
        const child = this.world.createRigidBody(this.bodyDesc(part.physics.body || 'dynamic', partWorld));
        child.setRotation({ x:partRotation.x, y:partRotation.y, z:partRotation.z, w:partRotation.w }, true);
        createdBodies.push(child);
        this.addColliders(child, part.physics.colliders, part.physics.mass, part.physics.friction);

        const data = part.joint.type === 'revolute'
          ? RAPIER.JointData.revolute(vec(part.joint.parentAnchor), vec(part.joint.childAnchor), vec(part.joint.axis))
          : RAPIER.JointData.prismatic(vec(part.joint.parentAnchor), vec(part.joint.childAnchor), vec(part.joint.axis));
        const joint = this.world.createImpulseJoint(data, parentBody, child, true);
        joint.setContactsEnabled(false);
        if (part.joint.limits) joint.setLimits(part.joint.limits[0], part.joint.limits[1]);
        bodies.set(partName, child);
        entry.parts.set(partName, { body: child, joint, node, spec: part, parentName, lastLocalRotation: node.quaternion.clone(), lastLocalPosition: node.position.clone() });
      }

      this.entries.set(id, entry);
      return entry;
    } catch (error) {
      for (const body of createdBodies.reverse()) {
        try { this.world.removeRigidBody(body); } catch {}
      }
      throw error;
    }
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
    entry.lastRotation.copy(q);
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


  dispose() {
    this.entries.clear();
    this.world?.free?.();
    this.world = null;
  }

  step(dt, store) {
    this.world.timestep = dt;
    this.world.step();
    let changed = false;

    for (const [id, entry] of this.entries) {
      const record = store.has(id) ? store.get(id) : null;
      if (!record) continue;

      if (!entry.body.isFixed()) {
        const p = entry.body.translation();
        const q = entry.body.rotation();
        const dx = p.x - entry.lastPosition.x;
        const dy = p.y - entry.lastPosition.y;
        const dz = p.z - entry.lastPosition.z;
        const rotationDot = Math.abs(
          entry.lastRotation.x * q.x + entry.lastRotation.y * q.y +
          entry.lastRotation.z * q.z + entry.lastRotation.w * q.w
        );
        if (dx * dx + dy * dy + dz * dz > 1e-10 || 1 - rotationDot > 1e-10) changed = true;
        record.object.position.set(p.x, p.y, p.z);
        record.object.quaternion.set(q.x, q.y, q.z, q.w);
        entry.lastPosition.set(p.x, p.y, p.z);
        entry.lastRotation.set(q.x, q.y, q.z, q.w);
      }

      for (const part of entry.parts.values()) {
        const q = part.body.rotation();
        const p = part.body.translation();
        this.partWorldRotation.set(q.x, q.y, q.z, q.w);
        this.partWorldPosition.set(p.x, p.y, p.z);
        const parentNode = part.node.parent;
        if (parentNode) {
          parentNode.updateWorldMatrix(true, false);
          parentNode.getWorldPosition(this.parentWorldPosition);
          parentNode.getWorldQuaternion(this.parentWorldRotation);
          this.inverseParentWorldRotation.copy(this.parentWorldRotation).invert();
          this.partLocalRotation.copy(this.inverseParentWorldRotation).multiply(this.partWorldRotation);
          this.partLocalPosition.copy(this.partWorldPosition).sub(this.parentWorldPosition).applyQuaternion(this.inverseParentWorldRotation);
        } else {
          this.partLocalRotation.copy(this.partWorldRotation);
          this.partLocalPosition.copy(this.partWorldPosition);
        }
        if (1 - Math.abs(part.lastLocalRotation.dot(this.partLocalRotation)) > 1e-10 || part.lastLocalPosition.distanceToSquared(this.partLocalPosition) > 1e-10) changed = true;
        part.node.quaternion.copy(this.partLocalRotation);
        part.node.position.copy(this.partLocalPosition);
        part.node.updateMatrixWorld(false);
        part.lastLocalRotation.copy(this.partLocalRotation);
        part.lastLocalPosition.copy(this.partLocalPosition);
      }
    }
    return changed;
  }
}
