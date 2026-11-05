import * as THREE from 'three';
import { ObjectStore } from '../runtime/ObjectStore.js';
import { PhysicsSystem } from '../runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../physics/RapierPhysicsBackend.js';
import { disposeObject3D } from '../../rendering/disposeObject3D.js';

const finiteVec3 = (v) => [v.x, v.y, v.z].every(Number.isFinite);
const finiteQuat = (q) => [q.x, q.y, q.z, q.w].every(Number.isFinite);
const angularDelta = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
const axisVector = (axis = [1, 0, 0]) => new THREE.Vector3(...axis).normalize();
const wrappedAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const failure = (stage, code, details = {}) => ({ stage, code, ...details });

function jointCoordinate(node, reference, part) {
  const axis = reference.axis;
  if (part.joint.type === 'prismatic') {
    return (node.position.x-reference.position.x)*axis.x + (node.position.y-reference.position.y)*axis.y + (node.position.z-reference.position.z)*axis.z;
  }
  const delta = node.quaternion.clone().multiply(reference.inverseRotation).normalize();
  return wrappedAngle(2 * Math.atan2(delta.x*axis.x + delta.y*axis.y + delta.z*axis.z, delta.w));
}

function penetrationMap(physics, instanceId, partName, refresh = false) {
  return new Map(physics.articulationPenetrations(instanceId, partName, { refresh }).map((item) => [item.key, item]));
}

export class ArticulationVerifier {
  constructor({
    assetRegistry,
    assetLoader,
    physicsFactory = () => new PhysicsSystem({ backend:new RapierPhysicsBackend() }),
    steps = 180,
    dt = 1 / 60,
    prismaticTolerance = 0.03,
    revoluteTolerance = 0.08,
    movementTolerance = 0.01,
    collisionTolerance = 0.005,
    stallWindow = 30,
    stallTolerance = 0.002
  } = {}) {
    if (!assetRegistry?.getManifest) throw new TypeError('ArticulationVerifier requires AssetRegistry');
    if (!assetLoader?.instantiate) throw new TypeError('ArticulationVerifier requires AssetLoader');
    this.assetRegistry = assetRegistry;
    this.assetLoader = assetLoader;
    this.physicsFactory = physicsFactory;
    this.steps = steps;
    this.dt = dt;
    this.prismaticTolerance = prismaticTolerance;
    this.revoluteTolerance = revoluteTolerance;
    this.movementTolerance = movementTolerance;
    this.collisionTolerance = collisionTolerance;
    this.stallWindow = stallWindow;
    this.stallTolerance = stallTolerance;
  }

  async verify(assetId,{requireRegistration=false,manifest:override=null,instantiate=null,verifyRigidBody=false,requireSettled=false}={}) {
    const manifest = override || this.assetRegistry.getManifest(assetId);
    const parts = Object.entries(manifest.parts || {}).filter(([, part]) => part.joint && part.joint.type!=='fixed' && part.physics && (Object.keys(part.targets || {}).length || part.joint.limits?.length===2));
    if (!parts.length && !requireRegistration) return { ok: true, assetId, tested: 0, parts: [], note: 'no executable articulation' };

    const { object } = await (instantiate ? instantiate() : this.assetLoader.instantiate(assetId));
    const physics = this.physicsFactory();
    const store = new ObjectStore();
    const instanceId = `verify_${assetId}`;
    store.add(instanceId, { id: instanceId, assetId, object, manifest, state: {} });

    try {
      await physics.init();
      if(requireRegistration && (!physics.hasCapability('rigid-body') || !physics.hasCapability('collision'))) return {ok:false,assetId,tested:0,parts:[],physicsRegistered:false,reason:'PHYSICS_CAPABILITY_UNAVAILABLE'};
      physics.addObject(instanceId, manifest, object);
      const reports = [];
      for (const [partName, part] of parts) reports.push(this.verifyPart({ physics, store, object, instanceId, partName, part, requireSettled }));
      let rigidBody=null;
      if(verifyRigidBody && !parts.length) {
        const body=physics.manipulationBody(instanceId);
        let exercised=true,displacement=0;
        if(body.body==='dynamic') {
          const bounds=new THREE.Box3().setFromObject(object),center=bounds.getCenter(new THREE.Vector3());
          physics.addEnvironment([{shape:'box',halfExtents:[10,.1,10],translation:[center.x,bounds.min.y-.1,center.z]}]);
          const before=physics.getPosition(instanceId);
          exercised=physics.applyImpulse(instanceId,[Math.min(body.mass || 1,100)*.5,0,0]);
          for(let step=0;step<15;step++) physics.step(this.dt,store);
          const after=physics.getPosition(instanceId);
          displacement=Math.hypot(...after.map((value,index)=>value-before[index]));
          exercised=exercised && after.every(Number.isFinite) && Math.abs(after[0]-before[0])>1e-5;
        }
        rigidBody={ok:body.registered && body.colliderCount>0 && exercised,colliderCount:body.colliderCount,body:body.body,displacement};
      }
      return { ok: reports.every((report) => report.ok) && (!rigidBody || rigidBody.ok), assetId, tested: reports.length, parts: reports,
        ...(rigidBody?{rigidBody}:{}),physicsRegistered:Boolean(physics.getPosition(instanceId)) };
    } finally {
      physics.dispose();
      disposeObject3D(object);
    }
  }

  verifyPart({ physics, store, object, instanceId, partName, part, requireSettled=false }) {
    const node = object.getObjectByName(part.node);
    if (!node) {
      return {
        ok: false,
        part: partName,
        node: part.node,
        failures: [failure('PRE_CONDITION', 'MISSING_NODE', { node:part.node })]
      };
    }

    const reference = {
      position:node.position.clone(),
      rotation:node.quaternion.clone(),
      inverseRotation:node.quaternion.clone().invert(),
      axis:axisVector(part.joint.axis)
    };
    const declared=Object.entries(part.targets || {});
    const probes=declared.length ? declared : [['probe',part.joint.limits.reduce((a,b)=>Math.abs(a)>Math.abs(b)?a:b)],['return',0]];
    const actions = probes.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const referencePenetrations = penetrationMap(physics, instanceId, partName, true);
    const reports = [];
    for (const [action, target] of actions) reports.push(this.verifyAction({
      physics, store, node, reference, referencePenetrations, instanceId, partName, part, action, target,requireSettled
    }));

    const zeroAction = actions.find(([, target]) => Math.abs(target) <= 1e-8);
    const returnPositionDelta = node.position.distanceTo(reference.position);
    const returnRotationDelta = angularDelta(node.quaternion, reference.rotation);
    const returnTolerance = part.joint.type === 'prismatic' ? this.prismaticTolerance : this.revoluteTolerance;
    const returnMovement = part.joint.type === 'prismatic' ? returnPositionDelta : returnRotationDelta;
    const reversibility = zeroAction
      ? { checked:true, ok:returnMovement <= returnTolerance, action:zeroAction[0], positionDelta:returnPositionDelta, rotationDelta:returnRotationDelta }
      : { checked:false, ok:true };
    const failures = reversibility.ok ? [] : [failure('RETURN', 'RETURN_FAILED', { movement:returnMovement, tolerance:returnTolerance })];

    return {
      ok: reports.every((report) => report.ok) && reversibility.ok,
      part: partName,
      node: part.node,
      jointType: part.joint.type,
      limits: part.joint.limits ? [...part.joint.limits] : null,
      actions: reports,
      reversibility,
      baselinePenetrations:[...referencePenetrations.values()],
      failures
    };
  }

  verifyAction({ physics, store, node, reference, referencePenetrations, instanceId, partName, part, action, target,requireSettled=false }) {
    const tolerance = part.joint.type === 'prismatic' ? this.prismaticTolerance : this.revoluteTolerance;
    const failures = [];
    const limits = part.joint.limits || [];
    if (!Number.isFinite(target)) failures.push(failure('PRE_CONDITION', 'TARGET_NON_FINITE', { target }));
    if (limits.length === 2 && Number.isFinite(target) && (target < limits[0] - 1e-8 || target > limits[1] + 1e-8)) {
      failures.push(failure('PRE_CONDITION', 'TARGET_OUT_OF_LIMITS', { target, limits:[...limits] }));
    }

    const beforePosition = node.position.clone();
    const beforeRotation = node.quaternion.clone();
    const initialCoordinate = jointCoordinate(node, reference, part);
    const initialError = Number.isFinite(target) ? Math.abs(wrappedAngleIfNeeded(part, initialCoordinate - target)) : Infinity;
    const baseline = referencePenetrations;
    const collisions = new Map();
    const coordinates = [initialCoordinate];
    let finite = finiteVec3(node.position) && finiteQuat(node.quaternion);
    let accepted = false;

    if (!failures.length) {
      accepted = physics.setArticulationTarget(instanceId, partName, target);
      if (!accepted) failures.push(failure('PRE_CONDITION', 'TARGET_REJECTED', { target }));
    }

    let stepsRun = 0;
    if (accepted) {
      for (let i = 0; i < this.steps; i++) {
        physics.step(this.dt, store);
        stepsRun += 1;
        finite = finiteVec3(node.position) && finiteQuat(node.quaternion);
        if (!finite) {
          failures.push(failure('EXECUTION', 'NON_FINITE_TRANSFORM', { step:i + 1 }));
          break;
        }
        coordinates.push(jointCoordinate(node, reference, part));
        for (const hit of physics.articulationPenetrations(instanceId, partName)) {
          const baseDepth = baseline.get(hit.key)?.depth || 0;
          const regression = hit.depth - baseDepth;
          if (regression > this.collisionTolerance) {
            const previous = collisions.get(hit.key);
            if (!previous || regression > previous.regression) collisions.set(hit.key, { ...hit, baseDepth, regression, step:i + 1 });
          }
        }
      }
    }

    if (collisions.size) failures.push(failure('EXECUTION', 'COLLISION_REGRESSION', { collisions:[...collisions.values()] }));
    let minCoordinate = Infinity;
    let maxCoordinate = -Infinity;
    for (const coordinate of coordinates) { minCoordinate = Math.min(minCoordinate, coordinate); maxCoordinate = Math.max(maxCoordinate, coordinate); }
    if (limits.length === 2 && finite && (minCoordinate < limits[0] - tolerance || maxCoordinate > limits[1] + tolerance)) {
      failures.push(failure('EXECUTION', 'LIMIT_VIOLATION', { minCoordinate, maxCoordinate, limits:[...limits], tolerance }));
    }
    const finalCoordinate = coordinates.at(-1);
    const targetError = Number.isFinite(target) && Number.isFinite(finalCoordinate)
      ? Math.abs(wrappedAngleIfNeeded(part, finalCoordinate - target))
      : Infinity;
    const alreadyAtTarget = initialError <= tolerance;
    const positionDelta = node.position.distanceTo(beforePosition);
    const rotationDelta = angularDelta(node.quaternion, beforeRotation);
    const movement = part.joint.type === 'prismatic' ? positionDelta : rotationDelta;
    const moved = movement > this.movementTolerance;
    const window = Math.min(this.stallWindow, Math.max(0, coordinates.length - 1));
    const recentMovement = window > 0 ? Math.abs(wrappedAngleIfNeeded(part, finalCoordinate - coordinates[coordinates.length - 1 - window])) : 0;
    const stalled = accepted && finite && !alreadyAtTarget && targetError > tolerance && recentMovement < this.stallTolerance;
    if (stalled) failures.push(failure('EXECUTION', 'STALL', { recentMovement, window, targetError }));
    const targetReached = targetError <= tolerance;
    const motion=physics.getMotion(instanceId,{partName});
    const settled=targetReached && recentMovement<=tolerance*.25 && motion?.linearSpeed<.08 && motion?.angularSpeed<.08;
    if(requireSettled && !settled) failures.push(failure('POST_CONDITION','NOT_SETTLED',{recentMovement,linearSpeed:motion?.linearSpeed,angularSpeed:motion?.angularSpeed}));
    if (accepted && finite && !targetReached) failures.push(failure('POST_CONDITION', 'TARGET_NOT_REACHED', { target, coordinate:finalCoordinate, error:targetError, tolerance }));

    return {
      ok: failures.length === 0,
      action,
      target,
      accepted,
      finite,
      alreadyAtTarget,
      positionDelta,
      rotationDelta,
      moved,
      initialCoordinate,
      finalCoordinate,
      minCoordinate,
      maxCoordinate,
      initialError,
      targetError,
      targetReached,
      settled,
      progress: Number.isFinite(initialError) && Number.isFinite(targetError) ? initialError - targetError : null,
      stepsRun,
      stalled,
      recentMovement,
      collisionRegressions:[...collisions.values()],
      failures,
      coordinateReference:'initial-zero-pose',
      phases:{
        preCondition:{ ok:!failures.some((item) => item.stage === 'PRE_CONDITION') },
        execution:{ ok:!failures.some((item) => item.stage === 'EXECUTION') },
        postCondition:{ ok:!failures.some((item) => item.stage === 'POST_CONDITION'), targetReached }
      }
    };
  }
}

function wrappedAngleIfNeeded(part, value) {
  return part.joint.type === 'revolute' ? wrappedAngle(value) : value;
}
