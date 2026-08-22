import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat/rapier.es.js';
import { orderParts, ROOT_PART } from '../../assets/parts.js';

const vec = (a = [0, 0, 0]) => ({ x: a[0], y: a[1], z: a[2] });
const array3 = (v) => [v.x, v.y, v.z];
const upright = (q) => {
  const upX = 2 * (q.x * q.y - q.z * q.w);
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
  const upZ = 2 * (q.y * q.z + q.x * q.w);
  return upY > 0.999 && Math.abs(upX) < 0.02 && Math.abs(upZ) < 0.02;
};
const yaw = (q) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
const boxAabbHalfExtents = (half, q) => {
  const xx = 1 - 2 * (q.y * q.y + q.z * q.z), xy = 2 * (q.x * q.y - q.z * q.w), xz = 2 * (q.x * q.z + q.y * q.w);
  const yx = 2 * (q.x * q.y + q.z * q.w), yy = 1 - 2 * (q.x * q.x + q.z * q.z), yz = 2 * (q.y * q.z - q.x * q.w);
  const zx = 2 * (q.x * q.z - q.y * q.w), zy = 2 * (q.y * q.z + q.x * q.w), zz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return [
    Math.abs(xx) * half.x + Math.abs(xy) * half.y + Math.abs(xz) * half.z,
    Math.abs(yx) * half.x + Math.abs(yy) * half.y + Math.abs(yz) * half.z,
    Math.abs(zx) * half.x + Math.abs(zy) * half.y + Math.abs(zz) * half.z
  ];
};
const cylinderAabbHalfExtents = (radius, halfHeight, q) => {
  const axis = [2 * (q.x * q.y - q.z * q.w), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.x * q.w)];
  return axis.map((component) => radius * Math.sqrt(Math.max(0, 1 - component * component)) + halfHeight * Math.abs(component));
};
const convexAabb = (vertices, position, rotation) => {
  const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  const v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < vertices.length; i += 3) {
    v.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyQuaternion(q).add(position);
    min.min(v); max.max(v);
  }
  return { position:min.clone().add(max).multiplyScalar(0.5).toArray(), halfExtents:max.clone().sub(min).multiplyScalar(0.5).toArray() };
};

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

  addEnvironment(colliders = []) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.addColliders(body, colliders);
    return body;
  }

  addFloor() {
    return this.addEnvironment([{ shape:'box', halfExtents:[5, 0.1, 4], translation:[0, -0.1, 0] }]);
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
    const colliderMass = mass != null && colliders.length ? mass / colliders.length : null;
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
      if (colliderMass != null) desc.setMass(colliderMass);
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

      const entry = { body, root: object, rootSpec:manifest.physics || {}, parts: new Map(), lastPosition: worldPos.clone(), lastRotation: worldRot.clone() };
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

  navigationObstacles() {
    this.world?.updateSceneQueries();
    const items = [];
    const skipped = [];
    const addBody = (objectId, partName, body, bodyType) => {
      if (bodyType === 'fixed') return;
      for (let i = 0; i < body.numColliders(); i++) {
        const collider = body.collider(i);
        const shape = collider.shape;
        const position = collider.translation();
        const rotation = collider.rotation();
        const id = `${objectId}:${partName}:${i}`;
        if (shape.type === RAPIER.ShapeType.Cuboid) {
          const exact = upright(rotation);
          items.push({
            id, objectId, part:partName, collider:i, shape:'box', sourceShape:'box', quality:exact ? 'exact-yaw' : 'conservative-aabb',
            position:array3(position),
            halfExtents:exact ? array3(shape.halfExtents) : boxAabbHalfExtents(shape.halfExtents, rotation),
            angle:exact ? yaw(rotation) : 0
          });
        } else if (shape.type === RAPIER.ShapeType.Cylinder) {
          if (upright(rotation)) {
            items.push({ id, objectId, part:partName, collider:i, shape:'cylinder', sourceShape:'cylinder', quality:'exact-upright', position:[position.x, position.y - shape.halfHeight, position.z], radius:shape.radius, height:shape.halfHeight * 2 });
          } else {
            items.push({ id, objectId, part:partName, collider:i, shape:'box', sourceShape:'cylinder', quality:'conservative-aabb', position:array3(position), halfExtents:cylinderAabbHalfExtents(shape.radius, shape.halfHeight, rotation), angle:0 });
          }
        } else if (shape.type === RAPIER.ShapeType.ConvexPolyhedron && shape.vertices?.length) {
          const box = convexAabb(shape.vertices, new THREE.Vector3(position.x, position.y, position.z), rotation);
          items.push({ id, objectId, part:partName, collider:i, shape:'box', sourceShape:'convexHull', quality:'conservative-aabb', ...box, angle:0 });
        } else {
          skipped.push({ id, objectId, part:partName, collider:i, reason:'unsupported-shape', shapeType:shape.type });
        }
      }
    };

    for (const [id, entry] of this.entries) {
      addBody(id, '$root', entry.body, entry.rootSpec.body || 'fixed');
      for (const [partName, part] of entry.parts) addBody(id, partName, part.body, part.spec.physics?.body || 'dynamic');
    }
    return { items, skipped };
  }

  articulationPenetrations(id, partName, { refresh = false } = {}) {
    if (refresh) this.world.updateSceneQueries();
    const entry = this.entries.get(id);
    const part = entry?.parts.get(partName);
    if (!entry || !part) return [];
    const owners = new Map([[entry.body.handle, '$root']]);
    for (const [name, value] of entry.parts) owners.set(value.body.handle, name);
    const hits = new Map();

    for (let i = 0; i < part.body.numColliders(); i++) {
      const source = part.body.collider(i);
      this.world.intersectionsWithShape(source.translation(), source.rotation(), source.shape, (other) => {
        const otherBody = other.parent();
        if (!otherBody || otherBody.handle === part.body.handle) return true;
        const contact = source.contactCollider(other, 0);
        if (!contact || contact.distance >= 0) return true;
        const targetPart = owners.get(otherBody.handle) || '$external';
        let targetIndex = -1;
        for (let j = 0; j < otherBody.numColliders(); j++) if (otherBody.collider(j).handle === other.handle) { targetIndex = j; break; }
        const key = `${partName}[${i}]->${targetPart}[${targetIndex}]`;
        const depth = -contact.distance;
        const previous = hits.get(key);
        if (!previous || depth > previous.depth) {
          hits.set(key, { key, depth, sourcePart:partName, sourceCollider:i, targetPart, targetCollider:targetIndex });
        }
        return true;
      });
    }
    return [...hits.values()];
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
