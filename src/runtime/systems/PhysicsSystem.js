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

  manifestPoseClear(manifest, targetPosition, { excludeIds = [] } = {}) {
    const colliders=manifest?.physics?.colliders || [];
    if (!colliders.length) return {checked:false,clear:false,reason:'ROOT_COLLIDER_UNAVAILABLE'};
    const excluded=new Set(excludeIds);
    const blockedBy=new Set();
    const shapeFor=(spec)=>{
      if (spec.shape==='box') return new RAPIER.Cuboid(...spec.halfExtents);
      if (spec.shape==='cylinder') return new RAPIER.Cylinder(spec.halfHeight,spec.radius);
      if (spec.shape==='capsule') return new RAPIER.Capsule(spec.halfHeight,spec.radius);
      if (spec.shape==='convexHull') return new RAPIER.ConvexPolyhedron(new Float32Array(spec.vertices));
      return null;
    };
    this.world.updateSceneQueries();
    for(let i=0;i<colliders.length;i++) {
      const spec=colliders[i],shape=shapeFor(spec);
      if (!shape) return {checked:false,clear:false,reason:'ROOT_COLLIDER_UNSUPPORTED',collider:i,shape:spec.shape || null};
      const local=spec.translation || [0,0,0];
      const position={x:targetPosition[0]+local[0],y:targetPosition[1]+local[1],z:targetPosition[2]+local[2]};
      const rotation=spec.rotation ? {x:spec.rotation[0],y:spec.rotation[1],z:spec.rotation[2],w:spec.rotation[3]} : {x:0,y:0,z:0,w:1};
      this.world.intersectionsWithShape(position,rotation,shape,(other)=>{
        const provenance=this.provenanceOfCollider(other);
        if (provenance?.kind==='object' && excluded.has(provenance.objectId)) return true;
        blockedBy.add(provenance?.kind==='environment' ? `environment:${provenance.environmentId || '$environment'}`
          : provenance?.kind==='object' ? `object:${provenance.objectId}:${provenance.partName || ROOT_PART}` : '$unknown');
        return false;
      });
      shape.free?.();
      if (blockedBy.size) return {checked:true,clear:false,blockedBy:[...blockedBy].sort(),coverage:Object.keys(manifest.parts || {}).length?'root-only':'full-root'};
    }
    return {checked:true,clear:true,blockedBy:[],coverage:Object.keys(manifest.parts || {}).length?'root-only':'full-root'};
  }

  bodyPoseClear(id, targetPosition, targetRotation = null, { excludeIds = [] } = {}) {
    const entry = this.entries.get(id);
    if (!entry || entry.parts.size) return { clear:false, code:'CARRY_BODY_UNSUPPORTED' };
    const bodyRotationRaw = entry.body.rotation();
    const bodyRotation = new THREE.Quaternion(bodyRotationRaw.x,bodyRotationRaw.y,bodyRotationRaw.z,bodyRotationRaw.w);
    const nextRotation = targetRotation ? new THREE.Quaternion(...targetRotation) : bodyRotation.clone();
    const targetBody = new THREE.Vector3(...targetPosition);
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
    }
    return this.bodyPoseClear(id,targetPosition,targetRotation,{excludeIds});
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

  articulationColliderPoses(id, partName, coordinate) {
    const entry=this.entries.get(id);
    const part=entry?.parts.get(partName);
    if (!entry || !part?.node?.parent || !Number.isFinite(coordinate)) return {checked:false,reason:'PART_POSE_UNAVAILABLE',id,partName,coordinate};
    const state=this.articulationState(id,partName);
    if (!state) return {checked:false,reason:'JOINT_COORDINATE_UNAVAILABLE',id,partName,coordinate};
    const childAnchor=new THREE.Vector3(...(part.spec.joint.childAnchor || [0,0,0]));
    const parentRotation=new THREE.Quaternion();
    part.node.parent.updateWorldMatrix(true,false);
    part.node.parent.getWorldQuaternion(parentRotation);
    const worldAxis=new THREE.Vector3(...state.localAxis).applyQuaternion(parentRotation).normalize();
    if (!Number.isFinite(worldAxis.lengthSq()) || worldAxis.lengthSq()<.99) return {checked:false,reason:'JOINT_AXIS_UNAVAILABLE',id,partName,coordinate};

    const rawBodyPosition=part.body.translation();
    const rawBodyRotation=part.body.rotation();
    const currentBodyPosition=new THREE.Vector3(rawBodyPosition.x,rawBodyPosition.y,rawBodyPosition.z);
    const currentBodyRotation=new THREE.Quaternion(rawBodyRotation.x,rawBodyRotation.y,rawBodyRotation.z,rawBodyRotation.w).normalize();
    const delta=coordinate-state.coordinate;
    const bodyPosition=currentBodyPosition.clone();
    const bodyRotation=currentBodyRotation.clone();
    if (part.spec.joint.type==='prismatic') {
      bodyPosition.addScaledVector(worldAxis,delta);
    } else {
      const pivotWorld=childAnchor.clone().applyQuaternion(currentBodyRotation).add(currentBodyPosition);
      bodyRotation.premultiply(new THREE.Quaternion().setFromAxisAngle(worldAxis,delta)).normalize();
      bodyPosition.copy(pivotWorld).sub(childAnchor.clone().applyQuaternion(bodyRotation));
    }

    const inverseCurrent=currentBodyRotation.clone().invert();
    const colliders=[];
    for(let i=0;i<part.body.numColliders();i++) {
      const collider=part.body.collider(i);
      const rawColliderPosition=collider.translation();
      const rawColliderRotation=collider.rotation();
      const currentColliderPosition=new THREE.Vector3(rawColliderPosition.x,rawColliderPosition.y,rawColliderPosition.z);
      const currentColliderRotation=new THREE.Quaternion(rawColliderRotation.x,rawColliderRotation.y,rawColliderRotation.z,rawColliderRotation.w).normalize();
      const localPosition=currentColliderPosition.clone().sub(currentBodyPosition).applyQuaternion(inverseCurrent);
      const localRotation=inverseCurrent.clone().multiply(currentColliderRotation).normalize();
      const position=localPosition.clone().applyQuaternion(bodyRotation).add(bodyPosition);
      const rotation=bodyRotation.clone().multiply(localRotation).normalize();
      colliders.push({index:i,shape:collider.shape,position,rotation});
    }
    return {checked:true,id,partName,jointType:state.jointType,currentCoordinate:state.coordinate,coordinate,parentName:part.parentName,frameAssumption:'parent-pose-at-query',colliders};
  }

  shapeBoundingRadius(shape) {
    if (!shape) return null;
    if (shape.halfExtents) {
      const h=shape.halfExtents;
      const border=Number(shape.borderRadius) || 0;
      return Math.hypot(h.x+border,h.y+border,h.z+border);
    }
    if (Number.isFinite(shape.halfHeight) && Number.isFinite(shape.radius)) {
      const border=Number(shape.borderRadius) || 0;
      return Math.hypot(shape.radius+border,shape.halfHeight+shape.radius+border);
    }
    if (Number.isFinite(shape.radius)) return shape.radius;
    if (shape.vertices?.length) {
      let radius=0;
      for(let i=0;i+2<shape.vertices.length;i+=3) radius=Math.max(radius,Math.hypot(shape.vertices[i],shape.vertices[i+1],shape.vertices[i+2]));
      return radius || null;
    }
    if (shape.a && shape.b) return Math.max(Math.hypot(shape.a.x,shape.a.y,shape.a.z),Math.hypot(shape.b.x,shape.b.y,shape.b.z));
    return null;
  }

  articulationCounterfactualSampleCount(id, partName, current, target, { minSamples = 5, maxSamples = 33 } = {}) {
    const entry=this.entries.get(id);
    const part=entry?.parts.get(partName);
    if (!part || !Number.isFinite(current) || !Number.isFinite(target)) return {checked:false,reason:'PART_SAMPLE_GEOMETRY_UNAVAILABLE'};
    const delta=Math.abs(target-current);
    if (delta<1e-9) return {checked:true,count:minSamples,delta,maxTravel:0,resolution:.08};
    const rawBodyPosition=part.body.translation();
    const rawBodyRotation=part.body.rotation();
    const bodyPosition=new THREE.Vector3(rawBodyPosition.x,rawBodyPosition.y,rawBodyPosition.z);
    const bodyRotation=new THREE.Quaternion(rawBodyRotation.x,rawBodyRotation.y,rawBodyRotation.z,rawBodyRotation.w).normalize();
    const inverseBody=bodyRotation.clone().invert();
    const childAnchor=new THREE.Vector3(...(part.spec.joint.childAnchor || [0,0,0]));
    let minRadius=Infinity,maxLever=0,covered=0;
    for(let i=0;i<part.body.numColliders();i++) {
      const collider=part.body.collider(i);
      const radius=this.shapeBoundingRadius(collider.shape);
      if (!Number.isFinite(radius) || radius<=0) continue;
      const raw=collider.translation();
      const localCenter=new THREE.Vector3(raw.x,raw.y,raw.z).sub(bodyPosition).applyQuaternion(inverseBody);
      minRadius=Math.min(minRadius,radius);
      maxLever=Math.max(maxLever,localCenter.distanceTo(childAnchor)+radius);
      covered+=1;
    }
    if (!covered || !Number.isFinite(minRadius)) return {checked:false,reason:'COLLIDER_EXTENT_UNAVAILABLE'};
    const maxTravel=part.spec.joint.type==='revolute' ? delta*maxLever : delta;
    const resolution=THREE.MathUtils.clamp(minRadius*.35,.02,.08);
    const count=THREE.MathUtils.clamp(Math.ceil(maxTravel/resolution)+1,minSamples,maxSamples);
    return {checked:true,count,delta,maxTravel,resolution,colliders:covered,minRadius,maxLever:part.spec.joint.type==='revolute'?maxLever:null};
  }

  articulationPairCounterfactual(originalId, originalPartName, originalTarget, blockerId, blockerPartName, blockerTarget, { samples = null } = {}) {
    const originalState=this.articulationState(originalId,originalPartName,{target:originalTarget});
    const blockerState=this.articulationState(blockerId,blockerPartName,{target:blockerTarget});
    if (!originalState || !blockerState) return {checked:false,reason:'JOINT_COORDINATE_UNAVAILABLE'};
    if (!Number.isFinite(originalTarget) || !Number.isFinite(blockerTarget)) return {checked:false,reason:'TARGET_UNAVAILABLE'};
    const fixedSamples=Number.isFinite(samples) ? Math.max(2,Math.min(33,Math.trunc(samples))) : null;
    const pairedSamples=samples && typeof samples==='object' ? {
      original:Math.max(2,Math.min(33,Math.trunc(samples.original) || 2)),
      blocker:Math.max(2,Math.min(33,Math.trunc(samples.blocker) || 2))
    } : null;
    const originalSampling=fixedSamples ? {checked:true,count:fixedSamples,mode:'fixed'}
      : pairedSamples ? {checked:true,count:pairedSamples.original,mode:'fixed-pair'}
      : this.articulationCounterfactualSampleCount(originalId,originalPartName,originalState.coordinate,originalTarget);
    const blockerSampling=fixedSamples ? {checked:true,count:fixedSamples,mode:'fixed'}
      : pairedSamples ? {checked:true,count:pairedSamples.blocker,mode:'fixed-pair'}
      : this.articulationCounterfactualSampleCount(blockerId,blockerPartName,blockerState.coordinate,blockerTarget);
    if (!originalSampling.checked) return {checked:false,reason:originalSampling.reason,source:'original-sampling'};
    if (!blockerSampling.checked) return {checked:false,reason:blockerSampling.reason,source:'blocker-sampling'};

    const trajectory=(id,partName,current,target,count)=>{
      const poses=[];
      for(let i=0;i<count;i++) {
        const alpha=i/(count-1);
        const coordinate=current+(target-current)*alpha;
        const pose=this.articulationColliderPoses(id,partName,coordinate);
        if (!pose.checked) return pose;
        poses.push(pose);
      }
      return {checked:true,poses};
    };
    const original=trajectory(originalId,originalPartName,originalState.coordinate,originalTarget,originalSampling.count);
    if (!original.checked) return {checked:false,reason:original.reason,source:'original'};
    const blocker=trajectory(blockerId,blockerPartName,blockerState.coordinate,blockerTarget,blockerSampling.count);
    if (!blocker.checked) return {checked:false,reason:blocker.reason,source:'blocker'};

    const pairAt=(a,b)=>{
      let intersections=0;
      for(const left of a.colliders) for(const right of b.colliders) {
        if (left.shape.intersectsShape(vec(left.position.toArray()),left.rotation,right.shape,vec(right.position.toArray()),right.rotation)) intersections+=1;
      }
      return intersections;
    };
    const againstPose=(originalPoses,blockerPose)=>{
      let conflictSamples=0,pairIntersections=0;
      for(const originalPose of originalPoses) {
        const pairs=pairAt(originalPose,blockerPose);
        if (pairs) conflictSamples+=1;
        pairIntersections+=pairs;
      }
      return {conflictSamples,pairIntersections};
    };
    const trajectoryConflict=(originalPoses,blockerPoses)=>{
      let conflictSamplePairs=0,pairIntersections=0;
      for(const originalPose of originalPoses) for(const blockerPose of blockerPoses) {
        const pairs=pairAt(originalPose,blockerPose);
        if (pairs) conflictSamplePairs+=1;
        pairIntersections+=pairs;
      }
      return {conflictSamplePairs,pairIntersections};
    };
    const current=againstPose(original.poses,blocker.poses[0]);
    const target=againstPose(original.poses,blocker.poses.at(-1));
    const action=trajectoryConflict(original.poses,blocker.poses);
    return {
      checked:true,geometry:'rapier-shape-pairs',causal:false,frameAssumption:'parent-poses-static-during-hypothesis',
      samples:{original:originalSampling.count,blocker:blockerSampling.count,mode:fixedSamples?'fixed':pairedSamples?'fixed-pair':'adaptive'},
      sampling:{original:originalSampling,blocker:blockerSampling},
      original:{id:originalId,partName:originalPartName,currentCoordinate:originalState.coordinate,target:originalTarget},
      blocker:{id:blockerId,partName:blockerPartName,currentCoordinate:blockerState.coordinate,target:blockerTarget},
      current,target,action,
      targetSweepClear:target.conflictSamples===0,
      conflictReduction:Math.max(0,current.conflictSamples-target.conflictSamples)
    };
  }

  articulationWorldCounterfactual(id, partName, target, { excludeObjectIds = [], excludeParts = [], samples = null } = {}) {
    const state=this.articulationState(id,partName,{target});
    if (!state || !Number.isFinite(target)) return {checked:false,reason:'JOINT_COORDINATE_UNAVAILABLE',id,partName};
    const fixedSamples=Number.isFinite(samples) ? Math.max(2,Math.min(33,Math.trunc(samples))) : null;
    const sampling=fixedSamples ? {checked:true,count:fixedSamples,mode:'fixed'} : this.articulationCounterfactualSampleCount(id,partName,state.coordinate,target);
    if (!sampling.checked) return {checked:false,reason:sampling.reason,source:'sampling',id,partName};
    const excluded=new Set([id,...excludeObjectIds]);
    const excludedParts=new Set(excludeParts.map((item)=>`${item.objectId}:${item.partName || ROOT_PART}`));
    const keyOf=(provenance,collider)=>{
      if (provenance?.kind==='environment') return `environment:${provenance.environmentId || '$environment'}:${provenance.colliderIndex ?? collider.handle}`;
      if (provenance?.kind==='object') return `object:${provenance.objectId}:${provenance.partName || ROOT_PART}:${provenance.colliderIndex ?? collider.handle}`;
      return `unknown:${collider.handle}`;
    };
    const describe=(provenance,collider,key)=>provenance?.kind==='environment'
      ? {key,kind:'environment',environmentId:provenance.environmentId || '$environment',colliderIndex:provenance.colliderIndex ?? null}
      : provenance?.kind==='object'
        ? {key,kind:'object',objectId:provenance.objectId,partName:provenance.partName || ROOT_PART,colliderIndex:provenance.colliderIndex ?? null}
        : {key,kind:'unknown',colliderHandle:collider.handle};
    const poseHits=(pose)=>{
      const hits=new Map();
      for(const source of pose.colliders) {
        this.world.intersectionsWithShape(vec(source.position.toArray()),source.rotation,source.shape,(other)=>{
          const provenance=this.provenanceOfCollider(other);
          if (provenance?.kind==='object' && (excluded.has(provenance.objectId) || excludedParts.has(`${provenance.objectId}:${provenance.partName || ROOT_PART}`))) return true;
          const key=keyOf(provenance,other);
          if (!hits.has(key)) hits.set(key,describe(provenance,other,key));
          return true;
        });
      }
      return hits;
    };
    this.world.updateSceneQueries();
    const poses=[];
    for(let i=0;i<sampling.count;i++) {
      const alpha=i/(sampling.count-1);
      const coordinate=state.coordinate+(target-state.coordinate)*alpha;
      const pose=this.articulationColliderPoses(id,partName,coordinate);
      if (!pose.checked) return {checked:false,reason:pose.reason,source:'trajectory',id,partName};
      poses.push(pose);
    }
    const currentHits=poseHits(poses[0]);
    const targetHits=poseHits(poses.at(-1));
    const actionHits=new Map();
    const sampleConflicts=[];
    for(let sampleIndex=0;sampleIndex<poses.length;sampleIndex++) {
      const hits=poseHits(poses[sampleIndex]);
      if (hits.size) sampleConflicts.push({sampleIndex,coordinate:poses[sampleIndex].coordinate,blockers:[...hits.keys()]});
      for(const [key,value] of hits) if (!actionHits.has(key)) actionHits.set(key,value);
    }
    const introduced=(hits)=>[...hits.entries()].filter(([key])=>!currentHits.has(key)).map(([,value])=>value);
    const current=[...currentHits.values()];
    const targetAll=[...targetHits.values()];
    const actionAll=[...actionHits.values()];
    const introducedTarget=introduced(targetHits);
    const introducedAction=introduced(actionHits);
    return {
      checked:true,geometry:'rapier-world-shape-query',causal:false,
      frameAssumption:'other-world-colliders-static-during-hypothesis',
      id,partName,currentCoordinate:state.coordinate,target,
      excludedObjectIds:[...excluded].sort(),excludedParts:[...excludedParts].sort(),
      samples:{count:sampling.count,mode:fixedSamples?'fixed':'adaptive'},sampling,
      current:{blockers:current},targetPose:{blockers:targetAll,introducedBlockers:introducedTarget},
      actionEnvelope:{blockers:actionAll,introducedBlockers:introducedAction,sampleConflicts},
      targetIntroducesNoCollision:introducedTarget.length===0,
      actionIntroducesNoCollision:introducedAction.length===0
    };
  }

  articulationPairCounterfactualConvergence(originalId, originalPartName, originalTarget, blockerId, blockerPartName, blockerTarget, { multiplier = 2 } = {}) {
    const base=this.articulationPairCounterfactual(originalId,originalPartName,originalTarget,blockerId,blockerPartName,blockerTarget);
    if (!base.checked) return {checked:false,reason:base.reason || 'BASE_COUNTERFACTUAL_UNAVAILABLE',base};
    const denserCount=(count)=>Math.min(33,Math.max(count+2,Math.ceil(count*Math.max(1.25,multiplier))));
    const denseSamples={original:denserCount(base.samples.original),blocker:denserCount(base.samples.blocker)};
    const dense=this.articulationPairCounterfactual(originalId,originalPartName,originalTarget,blockerId,blockerPartName,blockerTarget,{samples:denseSamples});
    if (!dense.checked) return {checked:false,reason:dense.reason || 'DENSE_COUNTERFACTUAL_UNAVAILABLE',base,dense};
    const ratio=(value,total)=>total>0?value/total:0;
    const baseRatios={
      current:ratio(base.current.conflictSamples,base.samples.original),
      target:ratio(base.target.conflictSamples,base.samples.original),
      action:ratio(base.action.conflictSamplePairs,base.samples.original*base.samples.blocker)
    };
    const denseRatios={
      current:ratio(dense.current.conflictSamples,dense.samples.original),
      target:ratio(dense.target.conflictSamples,dense.samples.original),
      action:ratio(dense.action.conflictSamplePairs,dense.samples.original*dense.samples.blocker)
    };
    const drift={
      current:Math.abs(baseRatios.current-denseRatios.current),
      target:Math.abs(baseRatios.target-denseRatios.target),
      action:Math.abs(baseRatios.action-denseRatios.action)
    };
    const qualitative={
      targetSweepClear:base.targetSweepClear===dense.targetSweepClear,
      clearanceGain:(base.conflictReduction>0)===(dense.conflictReduction>0)
    };
    return {
      checked:true,causal:false,status:qualitative.targetSweepClear&&qualitative.clearanceGain?'stable':'unstable',
      base,dense,
      qualitative,
      ratios:{base:baseRatios,dense:denseRatios,drift},
      maxRatioDrift:Math.max(drift.current,drift.target,drift.action)
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
