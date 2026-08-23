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
    this.colliderProvenance = new Map();
    this.rootRotation = new THREE.Quaternion();
    this.inverseRootRotation = new THREE.Quaternion();
    this.partWorldRotation = new THREE.Quaternion();
    this.partLocalRotation = new THREE.Quaternion();
    this.rootWorldPosition = new THREE.Vector3();
    this.partWorldPosition = new THREE.Vector3();
    this.partLocalPosition = new THREE.Vector3();
    this.characterController = null;
    this.parentWorldPosition = new THREE.Vector3();
    this.parentWorldRotation = new THREE.Quaternion();
    this.inverseParentWorldRotation = new THREE.Quaternion();
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.characterController = this.world.createCharacterController(0.02);
    this.characterController.enableAutostep(0.3, 0.2, false);
    this.characterController.enableSnapToGround(0.3);
    this.characterController.setMaxSlopeClimbAngle(Math.PI / 4);
    this.characterController.setMinSlopeSlideAngle(Math.PI / 6);
    this.characterController.setApplyImpulsesToDynamicBodies(false);
  }

  addEnvironment(colliders = [], { id = '$environment' } = {}) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.addColliders(body, colliders, undefined, undefined, { kind:'environment', environmentId:id });
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

  addColliders(body, colliders = [], mass, friction, provenance = null) {
    const colliderMass = mass != null && colliders.length ? mass / colliders.length : null;
    const created = [];
    for (let colliderIndex=0; colliderIndex<colliders.length; colliderIndex++) {
      const spec = colliders[colliderIndex];
      let desc;
      if (spec.shape === 'box') desc = RAPIER.ColliderDesc.cuboid(...spec.halfExtents);
      else if (spec.shape === 'cylinder') desc = RAPIER.ColliderDesc.cylinder(spec.halfHeight, spec.radius);
      else if (spec.shape === 'capsule') desc = RAPIER.ColliderDesc.capsule(spec.halfHeight, spec.radius);
      else if (spec.shape === 'convexHull') {
        desc = RAPIER.ColliderDesc.convexHull(new Float32Array(spec.vertices));
        if (!desc) throw new Error('Rapier rejected a degenerate convex hull collider');
      }
      else continue;
      if (spec.translation) desc.setTranslation(...spec.translation);
      if (spec.rotation) desc.setRotation({ x:spec.rotation[0], y:spec.rotation[1], z:spec.rotation[2], w:spec.rotation[3] });
      if (colliderMass != null) desc.setMass(colliderMass);
      if (friction != null) desc.setFriction(friction);
      const collider=this.world.createCollider(desc, body);
      created.push(collider);
      if (provenance) this.colliderProvenance.set(collider.handle,{ ...provenance, colliderIndex });
    }
    return created;
  }

  unregisterBodyColliders(body) {
    if (!body) return;
    for (let i=0;i<body.numColliders();i++) this.colliderProvenance.delete(body.collider(i).handle);
  }

  provenanceOfCollider(collider) {
    if (!collider) return null;
    const owner=this.colliderProvenance.get(collider.handle);
    return owner ? structuredClone(owner) : null;
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
      this.addColliders(body, manifest.physics?.colliders, manifest.physics?.mass, manifest.physics?.friction, { kind:'object', objectId:id, partName:ROOT_PART });

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
        this.addColliders(child, part.physics.colliders, part.physics.mass, part.physics.friction, { kind:'object', objectId:id, partName });

        const data = part.joint.type === 'revolute'
          ? RAPIER.JointData.revolute(vec(part.joint.parentAnchor), vec(part.joint.childAnchor), vec(part.joint.axis))
          : RAPIER.JointData.prismatic(vec(part.joint.parentAnchor), vec(part.joint.childAnchor), vec(part.joint.axis));
        const joint = this.world.createImpulseJoint(data, parentBody, child, true);
        joint.setContactsEnabled(false);
        if (part.joint.limits) joint.setLimits(part.joint.limits[0], part.joint.limits[1]);
        bodies.set(partName, child);
        entry.parts.set(partName, { body: child, joint, node, spec: part, parentName, restLocalRotation:node.quaternion.clone(), restLocalPosition:node.position.clone(), lastLocalRotation: node.quaternion.clone(), lastLocalPosition: node.position.clone() });
      }

      this.entries.set(id, entry);
      return entry;
    } catch (error) {
      for (const body of createdBodies.reverse()) {
        try { this.unregisterBodyColliders(body); this.world.removeRigidBody(body); } catch {}
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
    for (const part of entry.parts.values()) {
      this.unregisterBodyColliders(part.body);
      this.world.removeRigidBody(part.body);
    }
    this.unregisterBodyColliders(entry.body);
    this.world.removeRigidBody(entry.body);
    this.entries.delete(id);
    return true;
  }

  setHeld(id, held) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (held) {
      if (entry.heldOriginalType == null) entry.heldOriginalType = entry.body.bodyType();
      entry.held = true;
      entry.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      entry.body.setLinvel?.({x:0,y:0,z:0}, true);
      entry.body.setAngvel?.({x:0,y:0,z:0}, true);
    } else {
      const type = entry.heldOriginalType ?? RAPIER.RigidBodyType.Dynamic;
      entry.held = false;
      entry.body.setBodyType(type, true);
      entry.body.setLinvel?.({x:0,y:0,z:0}, true);
      entry.body.setAngvel?.({x:0,y:0,z:0}, true);
      delete entry.heldOriginalType;
      entry.body.wakeUp();
    }
    return true;
  }

  setHeldTarget(id, target, rotation = null) {
    const body = this.entries.get(id)?.body;
    if (!body) return false;
    body.setNextKinematicTranslation(vec(target));
    if (rotation) body.setNextKinematicRotation({x:rotation[0],y:rotation[1],z:rotation[2],w:rotation[3]});
    return true;
  }

  setHeldPose(id, position, rotation = null) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.body.setTranslation(vec(position), true);
    if (rotation) entry.body.setRotation({x:rotation[0],y:rotation[1],z:rotation[2],w:rotation[3]}, true);
    entry.root.position.fromArray(position);
    entry.lastPosition.fromArray(position);
    if (rotation) {
      entry.root.quaternion.fromArray(rotation);
      entry.lastRotation.fromArray(rotation);
    }
    entry.root.updateMatrixWorld(true);
    return true;
  }

  anchorPose(id, anchor, { next = false } = {}) {
    const body = this.entries.get(id)?.body;
    if (!body || !anchor?.translation) return null;
    const p = next ? body.nextTranslation() : body.translation();
    const q = next ? body.nextRotation() : body.rotation();
    const rotation = new THREE.Quaternion(q.x,q.y,q.z,q.w);
    const local = new THREE.Vector3(...anchor.translation).applyQuaternion(rotation);
    const position = new THREE.Vector3(p.x,p.y,p.z).add(local);
    const localRotation = new THREE.Quaternion(...(anchor.rotation || [0,0,0,1]));
    const worldRotation = rotation.clone().multiply(localRotation).normalize();
    return { position:position.toArray(), rotation:worldRotation.toArray() };
  }

  bodyMotionClear(id, targetPosition, targetRotation = null, { excludeIds = [] } = {}) {
    const entry = this.entries.get(id);
    if (!entry || entry.parts.size) return { clear:false, code:'CARRY_BODY_UNSUPPORTED' };
    const bodyRotationRaw = entry.body.rotation();
    const bodyRotation = new THREE.Quaternion(bodyRotationRaw.x,bodyRotationRaw.y,bodyRotationRaw.z,bodyRotationRaw.w);
    const nextRotation = targetRotation ? new THREE.Quaternion(...targetRotation) : bodyRotation.clone();
    const targetBody = new THREE.Vector3(...targetPosition);
    const blockedBy = new Set();
    const excluded = new Set([id, ...excludeIds]);
    const filter = (collider) => {
      const parent = collider.parent();
      const owner = parent ? this.ownerOfBodyHandle(parent.handle) : null;
      return !owner || !excluded.has(owner.id);
    };

    this.world.updateSceneQueries();
    for (let i=0;i<entry.body.numColliders();i++) {
      const collider = entry.body.collider(i);
      const spec = entry.rootSpec.colliders?.[i] || {};
      if (!['cylinder','capsule'].includes(spec.shape)) return { clear:false, code:'CARRY_COLLIDER_UNSUPPORTED', collider:i, shape:spec.shape || null };
      const local = new THREE.Vector3(...(spec.translation || [0,0,0]));
      const targetCenter = local.applyQuaternion(nextRotation).add(targetBody);
      const current = collider.translation();
      const delta = targetCenter.clone().sub(new THREE.Vector3(current.x,current.y,current.z));
      const currentRotation = collider.rotation();
      if (delta.lengthSq() > 1e-12) {
        const hit = this.world.castShape(
          current, currentRotation, vec(delta.toArray()), collider.shape,
          0, 1, false, undefined, undefined, collider, entry.body, filter
        );
        if (hit) {
          const parent = hit.collider.parent();
          const owner = parent ? this.ownerOfBodyHandle(parent.handle) : null;
          blockedBy.add(owner?.id || '$environment');
          return { clear:false, code:'CARRY_SWEEP_BLOCKED', collider:i, blockedBy:[...blockedBy], toi:hit.time_of_impact };
        }
      }
      let overlap = null;
      this.world.intersectionsWithShape(targetCenter, nextRotation, collider.shape, (other) => {
        const parent = other.parent();
        const owner = parent ? this.ownerOfBodyHandle(parent.handle) : null;
        if (owner && excluded.has(owner.id)) return true;
        overlap = owner?.id || '$environment';
        return false;
      }, undefined, undefined, collider, entry.body, filter);
      if (overlap) return { clear:false, code:'CARRY_TARGET_BLOCKED', collider:i, blockedBy:[overlap] };
    }
    return { clear:true };
  }

  cancelCharacterMovement(id) {
    const body = this.entries.get(id)?.body;
    if (!body) return false;
    const p = body.translation(), q = body.rotation();
    body.setNextKinematicTranslation(p);
    body.setNextKinematicRotation(q);
    return true;
  }

  getPosition(id) {
    const p = this.entries.get(id)?.body?.translation();
    return p ? [p.x, p.y, p.z] : null;
  }

  getRotation(id) {
    const q = this.entries.get(id)?.body?.rotation();
    return q ? [q.x,q.y,q.z,q.w] : null;
  }

  bodyMotionState(id) {
    const body = this.entries.get(id)?.body;
    if (!body) return null;
    const linear = body.linvel(), angular = body.angvel();
    const linearSpeed = Math.hypot(linear.x,linear.y,linear.z);
    const angularSpeed = Math.hypot(angular.x,angular.y,angular.z);
    return {
      sleeping:body.isSleeping(),
      linearVelocity:[linear.x,linear.y,linear.z],
      angularVelocity:[angular.x,angular.y,angular.z],
      linearSpeed,
      angularSpeed
    };
  }

  getPartRestPose(id, partName) {
    const part = this.entries.get(id)?.parts.get(partName);
    if (!part) return null;
    return { position:part.restLocalPosition.toArray(), rotation:part.restLocalRotation.toArray() };
  }

  articulationState(id, partName, { target = null } = {}) {
    const entry = this.entries.get(id);
    const part = entry?.parts.get(partName);
    if (!entry || !part?.node?.parent) return null;
    const parentFrame = part.parentName === ROOT_PART ? entry.root : entry.parts.get(part.parentName)?.node;
    if (!parentFrame) return null;
    entry.root.updateWorldMatrix(true, true);
    const parentWorldRotation = new THREE.Quaternion();
    const nodeParentWorldRotation = new THREE.Quaternion();
    parentFrame.getWorldQuaternion(parentWorldRotation);
    part.node.parent.getWorldQuaternion(nodeParentWorldRotation);
    const axis = new THREE.Vector3(...(part.spec.joint.axis || [1,0,0])).normalize()
      .applyQuaternion(parentWorldRotation)
      .applyQuaternion(nodeParentWorldRotation.invert())
      .normalize();
    if (!Number.isFinite(axis.lengthSq()) || axis.lengthSq() < .99) return null;

    let coordinate;
    if (part.spec.joint.type === 'prismatic') {
      coordinate = part.node.position.clone().sub(part.restLocalPosition).dot(axis);
    } else {
      const delta = part.node.quaternion.clone().multiply(part.restLocalRotation.clone().invert()).normalize();
      const angle = 2 * Math.atan2(delta.x*axis.x + delta.y*axis.y + delta.z*axis.z, delta.w);
      coordinate = Math.atan2(Math.sin(angle), Math.cos(angle));
    }
    if (!Number.isFinite(coordinate)) return null;
    const wrap = (value) => part.spec.joint.type === 'revolute' ? Math.atan2(Math.sin(value),Math.cos(value)) : value;
    const error = Number.isFinite(target) ? Math.abs(wrap(coordinate-target)) : null;
    return {
      id,partName,jointType:part.spec.joint.type,
      coordinate,target:Number.isFinite(target) ? target : null,error,
      tolerance:part.spec.joint.type === 'prismatic' ? .03 : .08,
      limits:part.spec.joint.limits ? [...part.spec.joint.limits] : null,
      localAxis:axis.toArray(),
      coordinateReference:'rest-zero-pose'
    };
  }

  ownerOfBodyHandle(handle) {
    for (const [id, entry] of this.entries) {
      if (entry.body.handle === handle) return { id, part: '$root' };
      for (const [part, value] of entry.parts) if (value.body.handle === handle) return { id, part };
    }
    return null;
  }

  raycast(origin, target, { excludeId = null, excludeIds = [] } = {}) {
    const direction = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
    const distance = Math.hypot(...direction);
    if (!Number.isFinite(distance) || distance < 1e-8 || !this.world) return null;
    const normalized = direction.map((value) => value / distance);
    const excluded = new Set([...(excludeId ? [excludeId] : []), ...excludeIds]);
    const filter = excluded.size ? (collider) => {
      const parent = collider.parent();
      const owner = parent ? this.ownerOfBodyHandle(parent.handle) : null;
      return !owner || !excluded.has(owner.id);
    } : undefined;
    const ray = new RAPIER.Ray(vec(origin), vec(normalized));
    const hit = this.world.castRay(ray, distance, true, undefined, undefined, undefined, undefined, filter);
    if (!hit) return null;
    const body = hit.collider.parent();
    const owner = body ? this.ownerOfBodyHandle(body.handle) : null;
    return {
      id:owner?.id || null,
      part:owner?.part || null,
      environment:!owner,
      distance:hit.timeOfImpact,
      point:[
        origin[0] + normalized[0] * hit.timeOfImpact,
        origin[1] + normalized[1] * hit.timeOfImpact,
        origin[2] + normalized[2] * hit.timeOfImpact
      ]
    };
  }

  faceCharacter(id, direction) {
    const entry = this.entries.get(id);
    if (!entry?.body?.isKinematic?.()) return false;
    const length = Math.hypot(direction[0], direction[2]);
    if (length < 1e-8) return false;
    const yaw = Math.atan2(-direction[0], -direction[2]);
    entry.body.setNextKinematicRotation({ x:0, y:Math.sin(yaw / 2), z:0, w:Math.cos(yaw / 2) });
    return true;
  }

  setCharacterYaw(id, yaw) {
    const entry = this.entries.get(id);
    if (!entry?.body?.isKinematic?.() || !Number.isFinite(yaw)) return false;
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
    const q = {x:rotation.x,y:rotation.y,z:rotation.z,w:rotation.w};
    entry.body.setRotation(q,true);
    entry.body.setNextKinematicRotation(q);
    entry.root.quaternion.copy(rotation);
    entry.lastRotation.copy(rotation);
    entry.root.updateMatrixWorld(true);
    return true;
  }

  moveCharacter(id, desiredTranslation, { ignoreIds = [] } = {}) {
    const entry = this.entries.get(id);
    if (!entry?.body?.isKinematic?.() || entry.body.numColliders() !== 1 || !this.characterController) {
      return { success:false, code:'CHARACTER_BODY_UNAVAILABLE', movement:[0,0,0], grounded:false, collisions:[] };
    }
    const collider = entry.body.collider(0);
    const ignored = new Set(ignoreIds);
    this.characterController.computeColliderMovement(collider, vec(desiredTranslation), undefined, undefined, (other) => {
      const parent = other.parent();
      const owner = parent ? this.ownerOfBodyHandle(parent.handle) : null;
      return !owner || !ignored.has(owner.id);
    });
    const movement = this.characterController.computedMovement();
    const current = entry.body.translation();
    entry.body.setNextKinematicTranslation({ x:current.x + movement.x, y:current.y + movement.y, z:current.z + movement.z });
    const collisions = [];
    for (let i = 0; i < this.characterController.numComputedCollisions(); i++) {
      const hit = this.characterController.computedCollision(i);
      if (!hit?.collider) continue;
      collisions.push({ colliderHandle:hit.collider.handle, toi:hit.toi, normal:[hit.normal1.x, hit.normal1.y, hit.normal1.z] });
    }
    return { success:true, movement:[movement.x,movement.y,movement.z], grounded:this.characterController.computedGrounded(), collisions };
  }

  setArticulationTarget(id, partName, target) {
    const part = this.entries.get(id)?.parts.get(partName);
    if (!part) return false;
    const motor = part.spec.joint.motor || {};
    part.joint.configureMotorPosition(target, motor.stiffness ?? 40, motor.damping ?? 8);
    part.body.wakeUp();
    return true;
  }

  holdArticulationCurrent(id, partName) {
    const part = this.entries.get(id)?.parts.get(partName);
    const state = this.articulationState(id,partName);
    if (!part || !state) return false;
    const motor = part.spec.joint.motor || {};
    part.joint.configureMotorPosition(state.coordinate,motor.stiffness ?? 40,motor.damping ?? 8);
    part.body.wakeUp();
    return true;
  }

  navigationObstacles() {
    this.world?.updateSceneQueries();
    const items = [];
    const skipped = [];
    const addBody = (objectId, partName, body, bodyType, navigationObstacle = true) => {
      if (bodyType === 'fixed' || navigationObstacle === false) return;
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
      if (!entry.held) addBody(id, '$root', entry.body, entry.rootSpec.body || 'fixed', entry.rootSpec.navigationObstacle);
      for (const [partName, part] of entry.parts) addBody(id, partName, part.body, part.spec.physics?.body || 'dynamic');
    }
    return { items, skipped };
  }

  articulationContacts(id, partName) {
    const entry=this.entries.get(id);
    const part=entry?.parts.get(partName);
    if (!entry || !part || !this.world) return [];
    const contacts=[];
    for (let sourceIndex=0;sourceIndex<part.body.numColliders();sourceIndex++) {
      const source=part.body.collider(sourceIndex);
      const sourceOwner=this.provenanceOfCollider(source) || { kind:'object',objectId:id,partName,colliderIndex:sourceIndex };
      this.world.contactPairsWith(source,(other)=>{
        const target=this.provenanceOfCollider(other);
        const external=!target || target.kind==='environment' || target.objectId!==id;
        let manifoldCount=0,contactCount=0,activeContactCount=0,minDistance=Infinity,totalImpulse=0,normal=null;
        this.world.contactPair(source,other,(manifold,flipped)=>{
          manifoldCount+=1;
          const rawNormal=manifold.normal();
          normal=flipped ? [-rawNormal.x,-rawNormal.y,-rawNormal.z] : [rawNormal.x,rawNormal.y,rawNormal.z];
          for(let i=0;i<manifold.numContacts();i++) {
            const distance=manifold.contactDist(i);
            const impulse=Math.abs(manifold.contactImpulse(i) || 0);
            contactCount+=1;
            if (distance <= 1e-6 || impulse > 1e-8) activeContactCount+=1;
            minDistance=Math.min(minDistance,distance);
            totalImpulse+=impulse;
          }
        });
        if (!manifoldCount || !activeContactCount) return;
        contacts.push({
          source:sourceOwner,
          target:target || { kind:'unknown',colliderIndex:null },
          external,
          manifoldCount,contactCount,activeContactCount,
          minDistance:Number.isFinite(minDistance) ? minDistance : null,
          totalImpulse,
          normal
        });
      });
    }
    contacts.sort((a,b)=>{
      const ak=`${a.target.kind}:${a.target.objectId || a.target.environmentId || ''}:${a.target.partName || ''}:${a.target.colliderIndex ?? -1}:${a.source.colliderIndex}`;
      const bk=`${b.target.kind}:${b.target.objectId || b.target.environmentId || ''}:${b.target.partName || ''}:${b.target.colliderIndex ?? -1}:${b.source.colliderIndex}`;
      return ak.localeCompare(bk);
    });
    return contacts;
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
    this.colliderProvenance.clear();
    if (this.world && this.characterController) this.world.removeCharacterController(this.characterController);
    this.characterController = null;
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
