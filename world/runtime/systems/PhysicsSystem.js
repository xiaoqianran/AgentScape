import * as THREE from 'three';
import { orderParts, ROOT_PART } from '../../../asset/parts.js';

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
const capsuleAabbHalfExtents = (radius, halfHeight, q) => {
  const axis = [2 * (q.x * q.y - q.z * q.w), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.x * q.w)];
  return axis.map((component) => radius + halfHeight * Math.abs(component));
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
  constructor({ backend } = {}) {
    if (!backend) throw new TypeError('PhysicsSystem requires a physics backend');
    this.backend = backend;
    this.solverEnabled = backend.hasCapability?.('rigid-body') === true;
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
    await this.backend.init();
    this.world = this.backend.createWorld();
    if (!this.solverEnabled || !this.backend.hasCapability('character-controller')) return this;
    this.characterController=this.backend.createCharacterController(this.world);
    return this;
  }

  runtimeCapabilities() {
    const capabilities=['transform-state','articulation-pose'];
    if (this.backend.hasCapability('collision') && this.backend.hasCapability('scene-query')) capabilities.push('counterfactual-query');
    return capabilities;
  }

  hasCapability(capability) {
    return this.backend.hasCapability(capability) || this.runtimeCapabilities().includes(capability);
  }
  runtimeExecutionModes() { return ['render-only']; }
  supportsExecutionMode(mode) {
    return this.backend.supportsExecutionMode(mode) || this.runtimeExecutionModes().includes(mode);
  }
  profile() {
    const backendCapabilities=[...this.backend.capabilities];
    const runtimeCapabilities=this.runtimeCapabilities();
    const backendExecutionModes=[...this.backend.executionModes];
    const runtimeExecutionModes=this.runtimeExecutionModes();
    return {
      identity:this.backend.identity,
      backendCapabilities,
      runtimeCapabilities,
      capabilities:[...new Set([...backendCapabilities,...runtimeCapabilities])],
      backendExecutionModes,
      runtimeExecutionModes,
      executionModes:[...new Set([...backendExecutionModes,...runtimeExecutionModes])],
      qualities:{...this.backend.qualities},
      solverEnabled:this.solverEnabled
    };
  }

  addEnvironment(colliders = [], { id = '$environment' } = {}) {
    if (!this.solverEnabled) return null;
    const body=this.backend.createBody(this.world,{type:'fixed'});
    this.addColliders(body, colliders, undefined, undefined, { kind:'environment', environmentId:id });
    return body;
  }

  addFloor() {
    return this.addEnvironment([{ shape:'box', halfExtents:[5, 0.1, 4], translation:[0, -0.1, 0] }]);
  }

  addColliders(body, colliders = [], mass, friction, provenance = null) {
    if (!this.solverEnabled || !body || !this.backend.hasCapability('collision')) return [];
    const created=this.backend.createColliders(this.world,body,colliders,{mass,friction});
    created.forEach((collider,colliderIndex)=>{
      if(provenance) this.colliderProvenance.set(this.backend.colliderKey(collider),{...provenance,colliderIndex});
    });
    return created;
  }

  unregisterBodyColliders(body) {
    if (!body) return;
    for(const collider of this.backend.colliders(body)) this.colliderProvenance.delete(this.backend.colliderKey(collider));
  }

  provenanceOfCollider(collider) {
    if (!collider) return null;
    const owner=this.colliderProvenance.get(this.backend.colliderKey(collider));
    return owner ? structuredClone(owner) : null;
  }

  attach(id, manifest, object) {
    if (!this.solverEnabled) return this.attachTransformState(id, manifest, object);
    const createdBodies = [];
    try {
      const worldPos = new THREE.Vector3();
      const worldRot = new THREE.Quaternion();
      object.getWorldPosition(worldPos);
      object.getWorldQuaternion(worldRot);
      const body=this.backend.createBody(this.world,{
        type:manifest.physics?.body || 'fixed', position:worldPos, rotation:worldRot
      });
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
        const child=this.backend.createBody(this.world,{
          type:part.physics.body || 'dynamic', position:partWorld, rotation:partRotation
        });
        createdBodies.push(child);
        this.addColliders(child, part.physics.colliders, part.physics.mass, part.physics.friction, { kind:'object', objectId:id, partName });

        const joint=this.backend.createJoint(this.world,part,parentBody,child);
        bodies.set(partName, child);
        entry.parts.set(partName, { body: child, joint, node, spec: part, parentName, restLocalRotation:node.quaternion.clone(), restLocalPosition:node.position.clone(), lastLocalRotation: node.quaternion.clone(), lastLocalPosition: node.position.clone() });
      }

      this.entries.set(id, entry);
      return entry;
    } catch (error) {
      for (const body of createdBodies.reverse()) {
        try { this.unregisterBodyColliders(body); this.backend.removeBody(this.world,body); } catch {}
      }
      throw error;
    }
  }

  attachTransformState(id, manifest, object) {
    object.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    const worldRot = new THREE.Quaternion();
    object.getWorldPosition(worldPos);
    object.getWorldQuaternion(worldRot);
    const entry = {
      body:null,
      root:object,
      rootSpec:manifest.physics || {},
      parts:new Map(),
      lastPosition:worldPos.clone(),
      lastRotation:worldRot.clone(),
      held:false,
      transformOnly:true
    };
    for (const [partName, part] of orderParts(manifest.parts || {})) {
      if (!part.joint) continue;
      const node = object.getObjectByName(part.node);
      if (!node) continue;
      entry.parts.set(partName, {
        body:null,
        joint:null,
        node,
        spec:part,
        parentName:part.parent || ROOT_PART,
        restLocalRotation:node.quaternion.clone(),
        restLocalPosition:node.position.clone(),
        lastLocalRotation:node.quaternion.clone(),
        lastLocalPosition:node.position.clone()
      });
    }
    this.entries.set(id, entry);
    return entry;
  }

  setPosition(id, position) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const next = new THREE.Vector3(...position);
    if (!entry.body) {
      if (entry.root.parent) {
        entry.root.parent.updateWorldMatrix(true, false);
        entry.root.position.copy(entry.root.parent.worldToLocal(next.clone()));
      } else entry.root.position.copy(next);
      entry.root.updateMatrixWorld(true);
      entry.lastPosition.copy(next);
      return true;
    }
    const delta = next.clone().sub(entry.lastPosition);
    this.backend.setBodyPose(entry.body,{position});
    this.backend.clearBodyMotion(entry.body,{linear:true,angular:false,wake:true});
    for (const { body } of entry.parts.values()) {
      this.backend.translateBody(body,delta.toArray(),{clearLinearVelocity:true,wake:true});
    }
    entry.lastPosition.copy(next);
  }

  beginTransform(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (!entry.body) { entry.transforming = true; return true; }
    entry.originalType=this.backend.bodyType(entry.body);
    this.backend.setBodyType(entry.body,'kinematic');
    for (const part of entry.parts.values()) {
      part.originalType=this.backend.bodyType(part.body);
      this.backend.setBodyType(part.body,'kinematic');
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
    if (!entry.body) {
      entry.lastPosition.copy(p);
      entry.lastRotation.copy(q);
      for (const part of entry.parts.values()) {
        part.lastLocalPosition.copy(part.node.position);
        part.lastLocalRotation.copy(part.node.quaternion);
      }
      return true;
    }
    this.backend.setBodyPose(entry.body,{position:p,rotation:q});
    entry.lastPosition.copy(p);
    entry.lastRotation.copy(q);
    for (const part of entry.parts.values()) {
      const pp = new THREE.Vector3();
      const pq = new THREE.Quaternion();
      part.node.getWorldPosition(pp);
      part.node.getWorldQuaternion(pq);
      this.backend.setBodyPose(part.body,{position:pp,rotation:pq});
    }
  }

  endTransform(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (!entry.body) { delete entry.transforming; return true; }
    if (entry.originalType != null) this.backend.setBodyType(entry.body,entry.originalType);
    delete entry.originalType;
    for (const part of entry.parts.values()) {
      if (part.originalType != null) this.backend.setBodyType(part.body,part.originalType);
      delete part.originalType;
      this.backend.wakeBody(part.body);
    }
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (!entry.body) { this.entries.delete(id); return true; }
    for (const part of entry.parts.values()) {
      this.unregisterBodyColliders(part.body);
      this.backend.removeBody(this.world,part.body);
    }
    this.unregisterBodyColliders(entry.body);
    this.backend.removeBody(this.world,entry.body);
    this.entries.delete(id);
    return true;
  }

  setHeld(id, held) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (!entry.body) { entry.held = Boolean(held); return true; }
    if (held) {
      if (entry.heldOriginalType == null) entry.heldOriginalType=this.backend.bodyType(entry.body);
      entry.held=true;
      this.backend.setBodyType(entry.body,'kinematic');
      this.backend.clearBodyMotion(entry.body,{wake:true});
    } else {
      entry.held=false;
      this.backend.setBodyType(entry.body,entry.heldOriginalType ?? 'dynamic');
      this.backend.clearBodyMotion(entry.body,{wake:true});
      delete entry.heldOriginalType;
    }
    return true;
  }

  setHeldTarget(id, target, rotation = null) {
    const entry = this.entries.get(id);
    const body = entry?.body;
    if (!entry) return false;
    if (!body) return this.setHeldPose(id, target, rotation);
    this.backend.setBodyPose(body,{position:target,rotation,next:true});
    return true;
  }

  setHeldPose(id, position, rotation = null) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.body) {
      this.backend.setBodyPose(entry.body,{position,rotation});
    }
    if (entry.root.parent) {
      entry.root.parent.updateWorldMatrix(true, false);
      entry.root.position.copy(entry.root.parent.worldToLocal(new THREE.Vector3(...position)));
    } else entry.root.position.fromArray(position);
    entry.lastPosition.fromArray(position);
    if (rotation) {
      entry.root.quaternion.fromArray(rotation);
      entry.lastRotation.fromArray(rotation);
    }
    entry.root.updateMatrixWorld(true);
    return true;
  }

  anchorPose(id, anchor, { next = false } = {}) {
    const entry = this.entries.get(id);
    const body = entry?.body;
    if (!entry || !anchor?.translation) return null;
    let position;
    let rotation;
    if (body) {
      const pose=this.backend.bodyPose(body,{next});
      position=new THREE.Vector3(...pose.position);
      rotation=new THREE.Quaternion(...pose.rotation);
    } else {
      entry.root.updateWorldMatrix(true, false);
      position = new THREE.Vector3();
      rotation = new THREE.Quaternion();
      entry.root.getWorldPosition(position);
      entry.root.getWorldQuaternion(rotation);
    }
    const local = new THREE.Vector3(...anchor.translation).applyQuaternion(rotation);
    const anchorPosition = position.clone().add(local);
    const localRotation = new THREE.Quaternion(...(anchor.rotation || [0,0,0,1]));
    const worldRotation = rotation.clone().multiply(localRotation).normalize();
    return { position:anchorPosition.toArray(), rotation:worldRotation.toArray() };
  }

  manifestPoseClear(manifest, targetPosition, { excludeIds = [] } = {}) {
    if (!this.backend.hasCapability('collision')) return {checked:false,clear:false,reason:'PHYSICS_CAPABILITY_UNAVAILABLE',capability:'collision'};
    const colliders=manifest?.physics?.colliders || [];
    if (!colliders.length) return {checked:false,clear:false,reason:'ROOT_COLLIDER_UNAVAILABLE'};
    const excluded=new Set(excludeIds);
    const blockedBy=new Set();
    const shapeFor=(spec)=>{
      return this.backend.createQueryShape(spec);
    };
    this.backend.syncSceneQueries(this.world);
    for(let i=0;i<colliders.length;i++) {
      const spec=colliders[i],shape=shapeFor(spec);
      if (!shape) return {checked:false,clear:false,reason:'ROOT_COLLIDER_UNSUPPORTED',collider:i,shape:spec.shape || null};
      const local=spec.translation || [0,0,0];
      const position={x:targetPosition[0]+local[0],y:targetPosition[1]+local[1],z:targetPosition[2]+local[2]};
      const rotation=spec.rotation ? {x:spec.rotation[0],y:spec.rotation[1],z:spec.rotation[2],w:spec.rotation[3]} : {x:0,y:0,z:0,w:1};
      this.backend.intersectionsWithShape(this.world,position,rotation,shape,(other)=>{
        const provenance=this.provenanceOfCollider(other);
        if (provenance?.kind==='object' && excluded.has(provenance.objectId)) return true;
        blockedBy.add(provenance?.kind==='environment' ? `environment:${provenance.environmentId || '$environment'}`
          : provenance?.kind==='object' ? `object:${provenance.objectId}:${provenance.partName || ROOT_PART}` : '$unknown');
        return false;
      });
      this.backend.disposeQueryShape(shape);
      if (blockedBy.size) return {checked:true,clear:false,blockedBy:[...blockedBy].sort(),coverage:Object.keys(manifest.parts || {}).length?'root-only':'full-root'};
    }
    return {checked:true,clear:true,blockedBy:[],coverage:Object.keys(manifest.parts || {}).length?'root-only':'full-root'};
  }

  bodyPoseClear(id, targetPosition, targetRotation = null, { excludeIds = [] } = {}) {
    if (!this.backend.hasCapability('collision')) return {clear:false,code:'PHYSICS_CAPABILITY_UNAVAILABLE',capability:'collision'};
    const entry = this.entries.get(id);
    if (!entry || entry.parts.size) return { clear:false, code:'CARRY_BODY_UNSUPPORTED' };
    const bodyPose=this.backend.bodyPose(entry.body);
    const bodyRotation=new THREE.Quaternion(...bodyPose.rotation);
    const nextRotation = targetRotation ? new THREE.Quaternion(...targetRotation) : bodyRotation.clone();
    const targetBody = new THREE.Vector3(...targetPosition);
    const excluded = new Set([id, ...excludeIds]);
    const filter=(collider)=>{
      const parent=this.backend.colliderParent(collider);
      const owner=parent ? this.ownerOfBody(parent) : null;
      return !owner || !excluded.has(owner.id);
    };

    this.backend.syncSceneQueries(this.world);
    const bodyColliders=this.backend.colliders(entry.body);
    for (let i=0;i<bodyColliders.length;i++) {
      const collider=bodyColliders[i];
      const snapshot=this.backend.colliderSnapshot(collider);
      const spec = entry.rootSpec.colliders?.[i] || {};
      if (!['cylinder','capsule'].includes(spec.shape)) return { clear:false, code:'CARRY_COLLIDER_UNSUPPORTED', collider:i, shape:spec.shape || null };
      const local = new THREE.Vector3(...(spec.translation || [0,0,0]));
      const targetCenter = local.applyQuaternion(nextRotation).add(targetBody);
      let overlap = null;
      this.backend.intersectionsWithShape(this.world,targetCenter,nextRotation,snapshot.shapeRef,(other)=>{
        const parent=this.backend.colliderParent(other);
        const owner=parent ? this.ownerOfBody(parent) : null;
        if (owner && excluded.has(owner.id)) return true;
        overlap = owner?.id || '$environment';
        return false;
      },{excludeCollider:collider,excludeBody:entry.body,predicate:filter});
      if (overlap) return { clear:false, code:'CARRY_TARGET_BLOCKED', collider:i, blockedBy:[overlap] };
    }
    return { clear:true };
  }

  bodyMotionClear(id, targetPosition, targetRotation = null, { excludeIds = [] } = {}) {
    if (!this.backend.hasCapability('collision')) return {clear:false,code:'PHYSICS_CAPABILITY_UNAVAILABLE',capability:'collision'};
    const entry = this.entries.get(id);
    if (!entry || entry.parts.size) return { clear:false, code:'CARRY_BODY_UNSUPPORTED' };
    const bodyPose=this.backend.bodyPose(entry.body);
    const bodyRotation=new THREE.Quaternion(...bodyPose.rotation);
    const nextRotation = targetRotation ? new THREE.Quaternion(...targetRotation) : bodyRotation.clone();
    const targetBody = new THREE.Vector3(...targetPosition);
    const blockedBy = new Set();
    const excluded = new Set([id, ...excludeIds]);
    const filter=(collider)=>{
      const parent=this.backend.colliderParent(collider);
      const owner=parent ? this.ownerOfBody(parent) : null;
      return !owner || !excluded.has(owner.id);
    };

    this.backend.syncSceneQueries(this.world);
    const bodyColliders=this.backend.colliders(entry.body);
    for (let i=0;i<bodyColliders.length;i++) {
      const collider=bodyColliders[i];
      const snapshot=this.backend.colliderSnapshot(collider);
      const spec = entry.rootSpec.colliders?.[i] || {};
      if (!['cylinder','capsule'].includes(spec.shape)) return { clear:false, code:'CARRY_COLLIDER_UNSUPPORTED', collider:i, shape:spec.shape || null };
      const local = new THREE.Vector3(...(spec.translation || [0,0,0]));
      const targetCenter = local.applyQuaternion(nextRotation).add(targetBody);
      const delta=targetCenter.clone().sub(new THREE.Vector3(snapshot.position.x,snapshot.position.y,snapshot.position.z));
      if (delta.lengthSq() > 1e-12) {
        const hit=this.backend.castCollider(this.world,collider,delta.toArray(),{
          excludeCollider:collider,excludeBody:entry.body,predicate:filter,
          targetDistance:0,maxToi:1,stopAtPenetration:false
        });
        if(hit) {
          const parent=this.backend.colliderParent(hit.collider);
          const owner=parent ? this.ownerOfBody(parent) : null;
          blockedBy.add(owner?.id || '$environment');
          return {clear:false,code:'CARRY_SWEEP_BLOCKED',collider:i,blockedBy:[...blockedBy],toi:hit.timeOfImpact};
        }
      }
    }
    return this.bodyPoseClear(id,targetPosition,targetRotation,{excludeIds});
  }

  cancelCharacterMovement(id) {
    if (!this.backend.hasCapability('character-controller')) return false;
    const body = this.entries.get(id)?.body;
    if (!body) return false;
    return this.backend.cancelCharacterMovement(body);
  }

  getPosition(id) {
    const entry = this.entries.get(id);
    const pose=entry?.body ? this.backend.bodyPose(entry.body) : null;
    if (pose) return [...pose.position];
    if (!entry?.root) return null;
    entry.root.updateWorldMatrix(true, false);
    const world = new THREE.Vector3();
    entry.root.getWorldPosition(world);
    return world.toArray();
  }

  getRotation(id) {
    const entry = this.entries.get(id);
    const pose=entry?.body ? this.backend.bodyPose(entry.body) : null;
    if (pose) return [...pose.rotation];
    if (!entry?.root) return null;
    entry.root.updateWorldMatrix(true, false);
    const world = new THREE.Quaternion();
    entry.root.getWorldQuaternion(world);
    return world.toArray();
  }

  bodyMotionState(id) {
    const entry = this.entries.get(id);
    const body = entry?.body;
    if (!entry) return null;
    if (!body) return {
      sleeping:true,
      linearVelocity:[0,0,0],
      angularVelocity:[0,0,0],
      linearSpeed:0,
      angularSpeed:0,
      source:'transform-state'
    };
    return this.backend.bodyMotion(body);
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
    if (!this.backend.hasCapability('collision')) return {checked:false,reason:'PHYSICS_CAPABILITY_UNAVAILABLE',capability:'collision',id,partName,coordinate};
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

    const bodyPose=this.backend.bodyPose(part.body);
    const currentBodyPosition=new THREE.Vector3(...bodyPose.position);
    const currentBodyRotation=new THREE.Quaternion(...bodyPose.rotation).normalize();
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
    for(const [i,collider] of this.backend.colliders(part.body).entries()) {
      const snapshot=this.backend.colliderSnapshot(collider);
      const currentColliderPosition=new THREE.Vector3(snapshot.position.x,snapshot.position.y,snapshot.position.z);
      const currentColliderRotation=new THREE.Quaternion(snapshot.rotation.x,snapshot.rotation.y,snapshot.rotation.z,snapshot.rotation.w).normalize();
      const localPosition=currentColliderPosition.clone().sub(currentBodyPosition).applyQuaternion(inverseCurrent);
      const localRotation=inverseCurrent.clone().multiply(currentColliderRotation).normalize();
      const position=localPosition.clone().applyQuaternion(bodyRotation).add(bodyPosition);
      const rotation=bodyRotation.clone().multiply(localRotation).normalize();
      colliders.push({index:i,shape:snapshot.shape,shapeRef:snapshot.shapeRef,position,rotation});
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
    const bodyPose=this.backend.bodyPose(part.body);
    const bodyPosition=new THREE.Vector3(...bodyPose.position);
    const bodyRotation=new THREE.Quaternion(...bodyPose.rotation).normalize();
    const inverseBody=bodyRotation.clone().invert();
    const childAnchor=new THREE.Vector3(...(part.spec.joint.childAnchor || [0,0,0]));
    let minRadius=Infinity,maxLever=0,covered=0;
    for(const collider of this.backend.colliders(part.body)) {
      const snapshot=this.backend.colliderSnapshot(collider);
      const radius=this.shapeBoundingRadius(snapshot.shape);
      if (!Number.isFinite(radius) || radius<=0) continue;
      const localCenter=new THREE.Vector3(snapshot.position.x,snapshot.position.y,snapshot.position.z).sub(bodyPosition).applyQuaternion(inverseBody);
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
        if(this.backend.shapesIntersect(
          left.shapeRef,left.position.toArray(),left.rotation,
          right.shapeRef,right.position.toArray(),right.rotation
        )) intersections+=1;
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
      checked:true,geometry:this.backend.evidenceGeometry('shape-pairs'),causal:false,frameAssumption:'parent-poses-static-during-hypothesis',
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
      const colliderKey=this.backend.colliderKey(collider);
      if (provenance?.kind==='environment') return `environment:${provenance.environmentId || '$environment'}:${provenance.colliderIndex ?? colliderKey}`;
      if (provenance?.kind==='object') return `object:${provenance.objectId}:${provenance.partName || ROOT_PART}:${provenance.colliderIndex ?? colliderKey}`;
      return `unknown:${colliderKey}`;
    };
    const describe=(provenance,collider,key)=>provenance?.kind==='environment'
      ? {key,kind:'environment',environmentId:provenance.environmentId || '$environment',colliderIndex:provenance.colliderIndex ?? null}
      : provenance?.kind==='object'
        ? {key,kind:'object',objectId:provenance.objectId,partName:provenance.partName || ROOT_PART,colliderIndex:provenance.colliderIndex ?? null}
        : {key,kind:'unknown',colliderHandle:this.backend.colliderKey(collider)};
    const poseHits=(pose)=>{
      const hits=new Map();
      for(const source of pose.colliders) {
        this.backend.intersectionsWithShape(this.world,source.position.toArray(),source.rotation,source.shapeRef,(other)=>{
          const provenance=this.provenanceOfCollider(other);
          if (provenance?.kind==='object' && (excluded.has(provenance.objectId) || excludedParts.has(`${provenance.objectId}:${provenance.partName || ROOT_PART}`))) return true;
          const key=keyOf(provenance,other);
          if (!hits.has(key)) hits.set(key,describe(provenance,other,key));
          return true;
        });
      }
      return hits;
    };
    this.backend.syncSceneQueries(this.world);
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
      checked:true,geometry:this.backend.evidenceGeometry('world-shape-query'),causal:false,
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

  ownerOfBody(body) {
    const key=this.backend.bodyKey(body);
    for (const [id,entry] of this.entries) {
      if (this.backend.bodyKey(entry.body)===key) return {id,part:'$root'};
      for (const [part,value] of entry.parts) if (this.backend.bodyKey(value.body)===key) return {id,part};
    }
    return null;
  }

  raycast(origin, target, { excludeId = null, excludeIds = [] } = {}) {
    if (!this.backend.hasCapability('scene-query')) return null;
    const direction = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
    const distance = Math.hypot(...direction);
    if (!Number.isFinite(distance) || distance < 1e-8 || !this.world) return null;
    const normalized = direction.map((value) => value / distance);
    const excluded = new Set([...(excludeId ? [excludeId] : []), ...excludeIds]);
    const filter=excluded.size ? (collider)=>{
      const parent=this.backend.colliderParent(collider);
      const owner=parent ? this.ownerOfBody(parent) : null;
      return !owner || !excluded.has(owner.id);
    } : undefined;
    const hit=this.backend.raycast(this.world,origin,normalized,distance,{solid:true,predicate:filter});
    if(!hit) return null;
    const body=this.backend.colliderParent(hit.collider);
    const owner=body ? this.ownerOfBody(body) : null;
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
    if (!entry) return false;
    const length = Math.hypot(direction[0], direction[2]);
    if (length < 1e-8) return false;
    const yaw = Math.atan2(-direction[0], -direction[2]);
    if (!entry.body) return this.setCharacterYaw(id, yaw);
    if (this.backend.bodyType(entry.body)!=='kinematic') return false;
    this.backend.setBodyPose(entry.body,{rotation:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],next:true});
    return true;
  }

  setCharacterYaw(id, yaw) {
    const entry = this.entries.get(id);
    if (!entry || !Number.isFinite(yaw)) return false;
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
    if (entry.body) {
      if (this.backend.bodyType(entry.body)!=='kinematic') return false;
      this.backend.setBodyPose(entry.body,{rotation});
      this.backend.setBodyPose(entry.body,{rotation,next:true});
    }
    entry.root.quaternion.copy(rotation);
    entry.lastRotation.copy(rotation);
    entry.root.updateMatrixWorld(true);
    return true;
  }

  moveCharacter(id, desiredTranslation, { ignoreIds = [] } = {}) {
    if (!this.backend.hasCapability('character-controller')) {
      return { success:false, code:'PHYSICS_CAPABILITY_UNAVAILABLE', capability:'character-controller', movement:[0,0,0], grounded:false, collisions:[] };
    }
    const entry=this.entries.get(id);
    if(!entry?.body || !this.characterController) {
      return {success:false,code:'CHARACTER_BODY_UNAVAILABLE',movement:[0,0,0],grounded:false,collisions:[]};
    }
    const ignored=new Set(ignoreIds);
    const result=this.backend.moveCharacter(this.characterController,entry.body,desiredTranslation,{
      predicate:(other)=>{
        const parent=this.backend.colliderParent(other);
        const owner=parent ? this.ownerOfBody(parent) : null;
        return !owner || !ignored.has(owner.id);
      }
    });
    if(!result.success) return result;
    return {
      ...result,
      collisions:result.collisions.map(({colliderKey,toi,normal})=>({colliderHandle:colliderKey,toi,normal}))
    };
  }

  setArticulationTarget(id, partName, target) {
    const part = this.entries.get(id)?.parts.get(partName);
    if (!part || !Number.isFinite(target)) return false;
    if (!part.joint || !part.body) {
      if (!this.hasCapability('articulation-pose')) return false;
      const limits = part.spec.joint.limits || [];
      if (limits.length === 2 && (target < limits[0] || target > limits[1])) return false;
      const state = this.articulationState(id, partName);
      if (!state) return false;
      const axis = new THREE.Vector3(...state.localAxis).normalize();
      if (part.spec.joint.type === 'prismatic') {
        part.node.position.copy(part.restLocalPosition).addScaledVector(axis, target);
      } else if (part.spec.joint.type === 'revolute') {
        const rotation = new THREE.Quaternion().setFromAxisAngle(axis, target);
        part.node.quaternion.copy(part.restLocalRotation).premultiply(rotation).normalize();
      } else return false;
      part.node.updateMatrixWorld(true);
      part.lastLocalPosition.copy(part.node.position);
      part.lastLocalRotation.copy(part.node.quaternion);
      return true;
    }
    const motor=part.spec.joint.motor || {};
    this.backend.setJointTarget(part.joint,target,motor);
    this.backend.wakeBody(part.body);
    return true;
  }

  holdArticulationCurrent(id, partName) {
    const part = this.entries.get(id)?.parts.get(partName);
    const state = this.articulationState(id,partName);
    if (!part || !state) return false;
    if (!part.joint || !part.body) return this.hasCapability('articulation-pose');
    const motor=part.spec.joint.motor || {};
    this.backend.setJointTarget(part.joint,state.coordinate,motor);
    this.backend.wakeBody(part.body);
    return true;
  }

  navigationObstacles() {
    if (!this.backend.hasCapability('collision')) return {items:[],skipped:[{reason:'physics-capability-unavailable',capability:'collision'}]};
    this.backend.syncSceneQueries(this.world);
    const items = [];
    const skipped = [];
    const addBody=(objectId,partName,body,bodyType,navigationObstacle=true)=>{
      if(bodyType==='fixed' || navigationObstacle===false) return;
      for(const [i,collider] of this.backend.colliders(body).entries()) {
        const snapshot=this.backend.colliderSnapshot(collider);
        const {shape,position,rotation}=snapshot;
        const id=`${objectId}:${partName}:${i}`;
        if(shape.kind==='box') {
          const exact=upright(rotation);
          items.push({
            id,objectId,part:partName,collider:i,shape:'box',sourceShape:'box',quality:exact?'exact-yaw':'conservative-aabb',
            position:array3(position),
            halfExtents:exact?array3(shape.halfExtents):boxAabbHalfExtents(shape.halfExtents,rotation),
            angle:exact?yaw(rotation):0
          });
        } else if(shape.kind==='cylinder') {
          if(upright(rotation)) {
            items.push({id,objectId,part:partName,collider:i,shape:'cylinder',sourceShape:'cylinder',quality:'exact-upright',position:[position.x,position.y-shape.halfHeight,position.z],radius:shape.radius,height:shape.halfHeight*2});
          } else {
            items.push({id,objectId,part:partName,collider:i,shape:'box',sourceShape:'cylinder',quality:'conservative-aabb',position:array3(position),halfExtents:cylinderAabbHalfExtents(shape.radius,shape.halfHeight,rotation),angle:0});
          }
        } else if(shape.kind==='capsule') {
          const extentY=shape.halfHeight+shape.radius;
          if(upright(rotation)) {
            items.push({id,objectId,part:partName,collider:i,shape:'cylinder',sourceShape:'capsule',quality:'conservative-upright',position:[position.x,position.y-extentY,position.z],radius:shape.radius,height:extentY*2});
          } else {
            items.push({id,objectId,part:partName,collider:i,shape:'box',sourceShape:'capsule',quality:'conservative-aabb',position:array3(position),halfExtents:capsuleAabbHalfExtents(shape.radius,shape.halfHeight,rotation),angle:0});
          }
        } else if(shape.kind==='convexHull' && shape.vertices?.length) {
          const box=convexAabb(shape.vertices,new THREE.Vector3(position.x,position.y,position.z),rotation);
          items.push({id,objectId,part:partName,collider:i,shape:'box',sourceShape:'convexHull',quality:'conservative-aabb',...box,angle:0});
        } else {
          skipped.push({id,objectId,part:partName,collider:i,reason:'unsupported-shape',shapeType:shape.kind});
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
    if (!this.backend.hasCapability('collision')) return [];
    const entry=this.entries.get(id);
    const part=entry?.parts.get(partName);
    if (!entry || !part || !this.world) return [];
    const contacts=[];
    for(const [sourceIndex,source] of this.backend.colliders(part.body).entries()) {
      const sourceOwner=this.provenanceOfCollider(source) || {kind:'object',objectId:id,partName,colliderIndex:sourceIndex};
      for(const pair of this.backend.contactPairs(this.world,source)) {
        const target=this.provenanceOfCollider(pair.other);
        const external=!target || target.kind==='environment' || target.objectId!==id;
        contacts.push({
          source:sourceOwner,
          target:target || {kind:'unknown',colliderIndex:null},
          external,
          manifoldCount:pair.manifoldCount,
          contactCount:pair.contactCount,
          activeContactCount:pair.activeContactCount,
          minDistance:pair.minDistance,
          totalImpulse:Number.isFinite(pair.totalImpulse)?pair.totalImpulse:null,
          evidenceKind:pair.evidenceKind || 'contact',
          impulseAvailable:pair.impulseAvailable===true,
          normal:pair.normal
        });
      }
    }
    contacts.sort((a,b)=>{
      const ak=`${a.target.kind}:${a.target.objectId || a.target.environmentId || ''}:${a.target.partName || ''}:${a.target.colliderIndex ?? -1}:${a.source.colliderIndex}`;
      const bk=`${b.target.kind}:${b.target.objectId || b.target.environmentId || ''}:${b.target.partName || ''}:${b.target.colliderIndex ?? -1}:${b.source.colliderIndex}`;
      return ak.localeCompare(bk);
    });
    return contacts;
  }

  articulationPenetrations(id, partName, { refresh = false } = {}) {
    if (!this.backend.hasCapability('collision')) return [];
    if(refresh) this.backend.syncSceneQueries(this.world);
    const entry=this.entries.get(id);
    const part=entry?.parts.get(partName);
    if(!entry || !part) return [];
    const owners=new Map([[this.backend.bodyKey(entry.body),'$root']]);
    for(const [name,value] of entry.parts) owners.set(this.backend.bodyKey(value.body),name);
    const hits=new Map();

    for(const [i,source] of this.backend.colliders(part.body).entries()) {
      for(const penetration of this.backend.penetrations(this.world,source)) {
        const otherBody=this.backend.colliderParent(penetration.other);
        if(!otherBody || this.backend.bodyKey(otherBody)===this.backend.bodyKey(part.body)) continue;
        const targetPart=owners.get(this.backend.bodyKey(otherBody)) || '$external';
        const targetColliders=this.backend.colliders(otherBody);
        const otherKey=this.backend.colliderKey(penetration.other);
        const targetIndex=targetColliders.findIndex((collider)=>this.backend.colliderKey(collider)===otherKey);
        const key=`${partName}[${i}]->${targetPart}[${targetIndex}]`;
        const depth=-penetration.distance;
        const previous=hits.get(key);
        if(!previous || depth>previous.depth) hits.set(key,{key,depth,sourcePart:partName,sourceCollider:i,targetPart,targetCollider:targetIndex});
      }
    }
    return [...hits.values()];
  }

  dispose() {
    this.entries.clear();
    this.colliderProvenance.clear();
    if(this.world && this.characterController) this.backend.removeCharacterController(this.world,this.characterController);
    this.characterController = null;
    this.backend.dispose(this.world);
    this.world = null;
  }

  step(dt, store) {
    this.backend.step(this.world, dt);
    let changed = false;
    if (!this.solverEnabled) {
      for (const [id, entry] of this.entries) {
        const record = store.has(id) ? store.get(id) : null;
        if (!record) continue;
        record.object.updateMatrixWorld(true);
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        record.object.getWorldPosition(p);
        record.object.getWorldQuaternion(q);
        if (p.distanceToSquared(entry.lastPosition) > 1e-10 || 1 - Math.abs(q.dot(entry.lastRotation)) > 1e-10) changed = true;
        entry.lastPosition.copy(p);
        entry.lastRotation.copy(q);
        for (const part of entry.parts.values()) {
          if (part.node.position.distanceToSquared(part.lastLocalPosition) > 1e-10 || 1 - Math.abs(part.node.quaternion.dot(part.lastLocalRotation)) > 1e-10) changed = true;
          part.lastLocalPosition.copy(part.node.position);
          part.lastLocalRotation.copy(part.node.quaternion);
        }
      }
      return changed;
    }

    for (const [id, entry] of this.entries) {
      const record = store.has(id) ? store.get(id) : null;
      if (!record) continue;

      if (this.backend.bodyType(entry.body)!=='fixed') {
        const pose=this.backend.bodyPose(entry.body);
        const p={x:pose.position[0],y:pose.position[1],z:pose.position[2]};
        const q={x:pose.rotation[0],y:pose.rotation[1],z:pose.rotation[2],w:pose.rotation[3]};
        const dx=p.x-entry.lastPosition.x;
        const dy=p.y-entry.lastPosition.y;
        const dz=p.z-entry.lastPosition.z;
        const rotationDot=Math.abs(
          entry.lastRotation.x*q.x+entry.lastRotation.y*q.y+
          entry.lastRotation.z*q.z+entry.lastRotation.w*q.w
        );
        if(dx*dx+dy*dy+dz*dz>1e-10 || 1-rotationDot>1e-10) changed=true;
        record.object.position.set(p.x,p.y,p.z);
        record.object.quaternion.set(q.x,q.y,q.z,q.w);
        entry.lastPosition.set(p.x,p.y,p.z);
        entry.lastRotation.set(q.x,q.y,q.z,q.w);
      }

      for (const part of entry.parts.values()) {
        const pose=this.backend.bodyPose(part.body);
        const p={x:pose.position[0],y:pose.position[1],z:pose.position[2]};
        const q={x:pose.rotation[0],y:pose.rotation[1],z:pose.rotation[2],w:pose.rotation[3]};
        this.partWorldRotation.set(q.x,q.y,q.z,q.w);
        this.partWorldPosition.set(p.x,p.y,p.z);
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
