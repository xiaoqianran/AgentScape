import * as THREE from 'three';
import { Errors } from '../../core/errors.js';
import { DEFAULT_WAYPOINT_TOLERANCE } from './LocomotionSystem.js';

export const DEFAULT_INTERACTION_DISTANCE = 1.5;

export class InteractionSystem {
  constructor({ store, physics, spatial, navigation = null, locomotion = null, events }) {
    this.store = store;
    this.physics = physics;
    this.spatial = spatial;
    this.navigation = navigation;
    this.locomotion = locomotion;
    this.events = events;
    this.humanHeldId = null;
    this.agentHeld = new Map();
    this.settleTasks = new Map();
    this.articulationTasks = new Map();
    this.articulationResults = new Map();
  }

  get heldId() { return this.humanHeldId; }

  isHeld(id) { return Boolean(this.store.has(id) && this.store.get(id).state?.heldBy); }

  heldByAgent(actorId) { return this.agentHeld.get(actorId) || null; }

  holdAnchor(actorId) {
    const record = this.store.get(actorId);
    if (record.manifest.type !== 'agent') throw Errors.carryUnavailable(actorId, actorId, 'ACTOR_NOT_AGENT');
    const anchor = record.manifest.embodiment?.holdAnchor;
    if (!anchor?.translation) throw Errors.carryUnavailable(actorId, actorId, 'HOLD_ANCHOR_UNAVAILABLE');
    return anchor;
  }

  carryStandOff(actorId, heldId) {
    const anchor = this.holdAnchor(actorId);
    const colliders = this.store.get(heldId).manifest.physics?.colliders || [];
    const radius = Math.max(0, ...colliders.map((collider) => Number(collider.radius) || 0));
    return Math.hypot(anchor.translation[0], anchor.translation[2]) + radius;
  }

  holdPoseAt(actorPosition, yaw, anchor) {
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
    const position = new THREE.Vector3(...actorPosition).add(new THREE.Vector3(...anchor.translation).applyQuaternion(rotation));
    const localRotation = new THREE.Quaternion(...(anchor.rotation || [0,0,0,1]));
    return { position:position.toArray(), rotation:rotation.multiply(localRotation).normalize().toArray() };
  }

  reorientHeldToward(actorId, heldId, point, { maxStep = Math.PI / 12 } = {}) {
    const actorPosition = this.physics.getPosition(actorId);
    const actorRotation = this.physics.getRotation(actorId);
    const heldPosition = this.physics.getPosition(heldId);
    const heldRotation = this.physics.getRotation(heldId);
    if (!actorPosition || !actorRotation || !heldPosition || !heldRotation) return { clear:false, reason:'POSE_UNAVAILABLE' };
    const dx = point[0]-actorPosition[0], dz = point[2]-actorPosition[2];
    if (Math.hypot(dx,dz) < 1e-8) return { clear:true, steps:0, yaw:null };
    const current = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...actorRotation),'YXZ').y;
    const target = Math.atan2(-dx,-dz);
    const delta = Math.atan2(Math.sin(target-current),Math.cos(target-current));
    const steps = Math.max(1,Math.ceil(Math.abs(delta)/maxStep));
    const anchor = this.holdAnchor(actorId);
    const checks = [];
    for(let i=1;i<=steps;i++) {
      const yaw = current + delta*(i/steps);
      const pose = this.holdPoseAt(actorPosition,yaw,anchor);
      const check = this.physics.bodyMotionClear(heldId,pose.position,pose.rotation,{excludeIds:[actorId]});
      checks.push({yaw,clear:check.clear,...(!check.clear?{code:check.code,blockedBy:check.blockedBy || []}:{})});
      if(!check.clear) {
        this.physics.setCharacterYaw(actorId,current);
        this.physics.setHeldPose(heldId,heldPosition,heldRotation);
        return { clear:false, reason:'CARRY_REORIENT_BLOCKED', step:i, steps, checks };
      }
      this.physics.setCharacterYaw(actorId,yaw);
      this.physics.setHeldPose(heldId,pose.position,pose.rotation);
    }
    return { clear:true, steps, yaw:target, checks };
  }

  assertAgentCarryable(actorId, targetId) {
    this.holdAnchor(actorId);
    const target = this.assertSupports(targetId, 'pickup');
    if (!target.manifest.actions.includes('drop')) throw Errors.carryUnavailable(actorId, targetId, 'DROP_UNSUPPORTED');
    if (target.manifest.physics?.body !== 'dynamic') throw Errors.carryUnavailable(actorId, targetId, 'TARGET_NOT_DYNAMIC');
    if (Object.keys(target.manifest.parts || {}).length) throw Errors.carryUnavailable(actorId, targetId, 'ARTICULATED_TARGET_UNSUPPORTED');
    const colliders = target.manifest.physics?.colliders || [];
    if (!colliders.length || colliders.some((collider) => !['cylinder','capsule'].includes(collider.shape))) {
      throw Errors.carryUnavailable(actorId, targetId, 'CARRY_COLLIDER_UNSUPPORTED');
    }
    const anchorRotation = target.id && (this.store.get(actorId).manifest.embodiment?.holdAnchor?.rotation || [0,0,0,1]);
    if (Math.abs(anchorRotation[0]) > 1e-6 || Math.abs(anchorRotation[2]) > 1e-6) throw Errors.carryUnavailable(actorId,targetId,'HOLD_ANCHOR_ROTATION_UNSUPPORTED');
    if (colliders.some((collider) => collider.rotation && (Math.abs(collider.rotation[0]) > 1e-6 || Math.abs(collider.rotation[2]) > 1e-6))) {
      throw Errors.carryUnavailable(actorId,targetId,'CARRY_COLLIDER_ROTATION_UNSUPPORTED');
    }
    const existing = target.state?.heldBy;
    if (existing && !(existing.kind === 'agent' && existing.id === actorId)) throw Errors.carryUnavailable(actorId, targetId, 'OBJECT_ALREADY_HELD', { heldBy:existing });
    const held = this.heldByAgent(actorId);
    if (held && held !== targetId) throw Errors.carryUnavailable(actorId, targetId, 'HANDS_FULL', { heldId:held });
    return target;
  }

  releaseHeld(id, reason = null) {
    if (!this.store.has(id)) return false;
    const record = this.store.get(id);
    const heldBy = record.state?.heldBy;
    if (!heldBy) return false;
    if (heldBy.kind === 'human' && this.humanHeldId === id) this.humanHeldId = null;
    if (heldBy.kind === 'agent' && this.agentHeld.get(heldBy.id) === id) this.agentHeld.delete(heldBy.id);
    delete record.state.heldBy;
    this.physics.setHeld(id, false);
    this.events.emit('interaction', { action:'drop', id, heldBy, ...(reason ? {reason} : {}) });
    return true;
  }

  rebuildHeldOwnership() {
    this.humanHeldId = null;
    this.agentHeld.clear();
    for (const [id, record] of this.store.list()) {
      const heldBy = record.state?.heldBy;
      if (!heldBy) continue;
      if (heldBy.kind === 'human') {
        if (this.humanHeldId) throw new Error('Scene contains multiple human-held objects');
        this.humanHeldId = id;
        this.physics.setHeld(id, true);
        continue;
      }
      if (heldBy.kind !== 'agent' || !heldBy.id || !this.store.has(heldBy.id)) throw new Error(`${id}: invalid heldBy state`);
      if (this.agentHeld.has(heldBy.id)) throw new Error(`${heldBy.id}: multiple held objects are not supported`);
      this.assertAgentCarryable(heldBy.id, id);
      this.agentHeld.set(heldBy.id, id);
      this.physics.setHeld(id, true);
      const pose = this.physics.anchorPose(heldBy.id, this.holdAnchor(heldBy.id));
      if (!pose) throw new Error(`${id}: hold anchor pose unavailable`);
      this.physics.setHeldPose(id, pose.position, pose.rotation);
    }
  }

  beforeRemove(id) {
    for (const key of [...this.articulationResults.keys()]) if (key.startsWith(`${id}:`)) this.articulationResults.delete(key);
    for (const task of [...this.articulationTasks.values()]) if (task.id === id) {
      this.finishArticulationTask(task,{status:'action-unverified',reason:'OBJECT_REMOVED',targetReached:false,settled:false,elapsed:Number(task.elapsed.toFixed(3))});
    }
    const settle = this.settleTasks.get(id);
    if (settle) this.finishPlacementSettle(settle,{status:'place-unverified',reason:'OBJECT_REMOVED',supportVerified:false,settled:false,elapsed:Number(settle.elapsed.toFixed(3))});
    if (this.store.has(id) && this.store.get(id).state?.heldBy) this.releaseHeld(id, 'OBJECT_REMOVED');
    const carried = this.agentHeld.get(id);
    if (carried && this.store.has(carried)) this.releaseHeld(carried, 'OWNER_REMOVED');
  }

  cancelPending(reason = 'RUNTIME_DISPOSED') {
    for (const task of [...this.settleTasks.values()]) {
      this.finishPlacementSettle(task,{status:'place-unverified',reason,supportVerified:false,settled:false,elapsed:Number(task.elapsed.toFixed(3))});
    }
    for (const task of [...this.articulationTasks.values()]) {
      this.finishArticulationTask(task,{status:'action-unverified',reason,targetReached:false,settled:false,elapsed:Number(task.elapsed.toFixed(3))});
    }
  }

  supports(record, action) { return record.manifest.actions.includes(action); }

  assertSupports(id, action) {
    const record = this.store.get(id);
    if (!this.supports(record, action)) throw Errors.actionUnsupported(id, action);
    return record;
  }

  move(id, position) {
    const record = this.assertSupports(id, 'move');
    record.object.position.fromArray(position);
    this.physics.setPosition(id, position);
    this.events.emit('interaction', { action: 'move', id, position });
  }

  pickup(id) {
    const record = this.assertSupports(id, 'pickup');
    if (record.state?.heldBy?.kind === 'agent') throw Errors.carryUnavailable('human', id, 'OBJECT_ALREADY_HELD', { heldBy:record.state.heldBy });
    if (this.humanHeldId && this.humanHeldId !== id) this.drop(this.humanHeldId);
    record.state.heldBy = { kind:'human' };
    this.humanHeldId = id;
    this.physics.setHeld(id, true);
    this.events.emit('interaction', { action:'pickup', id, heldBy:{kind:'human'} });
    return { status:'held', id, heldBy:{kind:'human'} };
  }

  drop(id = this.humanHeldId) {
    if (!id) return false;
    this.assertSupports(id, 'drop');
    return this.releaseHeld(id);
  }

  place(id, targetId, options = {}) {
    this.assertSupports(id, 'place');
    const target = this.store.get(targetId);
    if (!target.manifest.surfaces?.length) throw Errors.actionUnsupported(targetId, 'receive');
    const p = this.spatial.findFreeSpace(id, targetId, options);
    if (!p) throw new Error(`No collision-free placement found on ${targetId}`);
    this.pickup(id);
    this.store.get(id).object.position.copy(p);
    this.physics.setPosition(id, p.toArray());
    this.drop(id);
    this.events.emit('interaction', { action: 'place', id, targetId, position: p.toArray() });
    return { id, targetId, position: p.toArray().map((v) => Number(v.toFixed(3))) };
  }



  actorBoxAt(actorId, position) {
    const record = this.store.get(actorId);
    const collider = record.manifest.physics?.colliders?.find((value) => value.shape === 'capsule');
    if (collider) {
      const center = new THREE.Vector3(...position).add(new THREE.Vector3(...(collider.translation || [0,0,0])));
      const half = new THREE.Vector3(collider.radius, collider.halfHeight + collider.radius, collider.radius);
      return new THREE.Box3(center.clone().sub(half), center.clone().add(half));
    }
    const current = this.physics.getPosition(actorId);
    if (!current) return null;
    const bounds = this.spatial.getBounds(actorId);
    const center = new THREE.Vector3(...bounds.center).sub(new THREE.Vector3(...current)).add(new THREE.Vector3(...position));
    const half = new THREE.Vector3(...bounds.size).multiplyScalar(.5);
    return new THREE.Box3(center.clone().sub(half), center.clone().add(half));
  }

  actionSweepBounds(targetId, action, partName = null, samples = 9) {
    const record = this.store.get(targetId);
    const [name, part] = this.findPartForAction(record, action, partName);
    const node = record.object.getObjectByName(part.node);
    const rest = this.physics.getPartRestPose(targetId, name);
    if (!node || !node.parent || !rest) return { checked:false, reason:'PART_REST_POSE_UNAVAILABLE', partName:name };
    if (part.joint.type === 'revolute' && Math.hypot(...(part.joint.childAnchor || [0,0,0])) > 1e-5) {
      return { checked:false, reason:'REVOLUTE_CHILD_ANCHOR_UNSUPPORTED', partName:name };
    }

    const target = part.targets[action];
    const live = this.physics.articulationState(targetId,name,{target});
    if (!live) return { checked:false, reason:'JOINT_COORDINATE_UNAVAILABLE', partName:name };
    const axis = new THREE.Vector3(...live.localAxis);
    const currentCoordinate = live.coordinate;
    const restPosition = new THREE.Vector3(...rest.position);
    const restRotation = new THREE.Quaternion(...rest.rotation);

    const originalPosition = node.position.clone();
    const originalRotation = node.quaternion.clone();
    const swept = new THREE.Box3();
    try {
      for (let i = 0; i < samples; i++) {
        const alpha = samples === 1 ? 1 : i / (samples - 1);
        const coordinate = currentCoordinate + (target - currentCoordinate) * alpha;
        if (part.joint.type === 'prismatic') {
          node.position.copy(restPosition).addScaledVector(axis, coordinate);
          node.quaternion.copy(restRotation);
        } else {
          node.position.copy(restPosition);
          node.quaternion.setFromAxisAngle(axis, coordinate).multiply(restRotation);
        }
        node.updateMatrixWorld(true);
        swept.union(new THREE.Box3().setFromObject(node));
      }
    } finally {
      node.position.copy(originalPosition);
      node.quaternion.copy(originalRotation);
      node.updateMatrixWorld(true);
    }
    if (swept.isEmpty()) return { checked:false, reason:'PART_SWEEP_EMPTY', partName:name };
    swept.expandByScalar(.02);
    return {
      checked:true,
      partName:name,
      action,
      currentCoordinate,
      target,
      bounds:{ min:swept.min.toArray(), max:swept.max.toArray() },
      box:swept
    };
  }

  actorMetrics(actorId) {
    const record = this.store.get(actorId);
    if (record.manifest.type !== 'agent') throw Errors.interactionUnavailable(actorId, actorId, 'ACTOR_NOT_AGENT');
    const bounds = this.spatial.getBounds(actorId);
    const capsule = record.manifest.physics?.colliders?.find((collider) => collider.shape === 'capsule');
    return {
      radius:capsule?.radius ?? Math.max(0.2, Math.min(bounds.size[0], bounds.size[2]) / 2),
      eyeHeight:Math.max(0.9, bounds.size[1] * 0.82)
    };
  }

  interactionStatusAt(actorId, targetId, position, { maxDistance = DEFAULT_INTERACTION_DISTANCE, ignoreIds = [] } = {}) {
    const metrics = this.actorMetrics(actorId);
    const bounds = this.spatial.getBounds(targetId);
    const dx = Math.max(bounds.min[0] - position[0], 0, position[0] - bounds.max[0]);
    const dz = Math.max(bounds.min[2] - position[2], 0, position[2] - bounds.max[2]);
    const distance = Math.hypot(dx, dz);
    const eye = [position[0], position[1] + metrics.eyeHeight, position[2]];
    const aim = [...bounds.center];
    const hit = this.physics.raycast(eye, aim, { excludeId:actorId, excludeIds:ignoreIds });
    const visible = hit?.id === targetId;
    return {
      actorId,
      targetId,
      position:[...position],
      distance:Number(distance.toFixed(3)),
      maxDistance,
      inRange:distance <= maxDistance,
      visible,
      interactable:distance <= maxDistance && visible,
      lineOfSight:{ eye, aim, hit:hit ? { id:hit.id, part:hit.part, environment:hit.environment, distance:Number(hit.distance.toFixed(3)) } : null }
    };
  }

  interactionStatus(actorId, targetId, options = {}) {
    const position = this.physics.getPosition(actorId);
    if (!position) throw Errors.interactionUnavailable(actorId, targetId, 'ACTOR_PHYSICS_UNAVAILABLE');
    return this.interactionStatusAt(actorId, targetId, position, options);
  }

  async findInteractionPose(actorId, targetId, { maxDistance = DEFAULT_INTERACTION_DISTANCE, clearance = 0.12, action = null, partName = null, ignoreIds = [], standOff = 0, candidateFilter = null } = {}) {
    if (!this.navigation) throw Errors.interactionUnavailable(actorId, targetId, 'NAVIGATION_UNAVAILABLE');
    const current = this.physics.getPosition(actorId);
    if (!current) throw Errors.interactionUnavailable(actorId, targetId, 'ACTOR_PHYSICS_UNAVAILABLE');
    const sweep = action ? this.actionSweepBounds(targetId, action, partName) : null;
    if (action && !sweep.checked) throw Errors.interactionUnavailable(actorId, targetId, 'ACTION_SWEEP_UNAVAILABLE', { sweep:{ checked:false, reason:sweep.reason, partName:sweep.partName } });
    const clearOfSweep = (position) => !sweep || !sweep.box.intersectsBox(this.actorBoxAt(actorId, position));
    const now = this.interactionStatusAt(actorId, targetId, current, { maxDistance, ignoreIds });
    if (now.interactable && clearOfSweep(current) && (!candidateFilter || candidateFilter(current))) return { status:'current-pose', position:[...current], routeCost:0, distance:now.distance, lineOfSight:now.lineOfSight, ...(sweep ? { actionSweep:{checked:true,clear:true,partName:sweep.partName} } : {}) };

    const metrics = this.actorMetrics(actorId);
    const bounds = this.spatial.getBounds(targetId);
    const offset = Math.max(metrics.radius,standOff) + clearance;
    const [cx,,cz] = bounds.center;
    const targetRoot = new THREE.Vector3();
    this.store.get(targetId).object.getWorldPosition(targetRoot);
    const y = targetRoot.y;
    const candidates = [
      [bounds.min[0] - offset, y, cz], [bounds.max[0] + offset, y, cz],
      [cx, y, bounds.min[2] - offset], [cx, y, bounds.max[2] + offset],
      [bounds.min[0] - offset, y, bounds.min[2] - offset],
      [bounds.max[0] + offset, y, bounds.min[2] - offset],
      [bounds.min[0] - offset, y, bounds.max[2] + offset],
      [bounds.max[0] + offset, y, bounds.max[2] + offset]
    ];

    const valid = [];
    for (const candidate of candidates) {
      const route = await this.navigation.findPath(current, candidate);
      if (!route.reachable || !route.end?.snapped) continue;
      const position = route.end.snapped;
      const status = this.interactionStatusAt(actorId, targetId, position, { maxDistance, ignoreIds });
      if (!status.interactable || !clearOfSweep(position) || (candidateFilter && !candidateFilter(position))) continue;
      valid.push({ status:'approach-pose', position, routeCost:route.cost, distance:status.distance, waypointCount:route.path.length, lineOfSight:status.lineOfSight, ...(sweep ? { actionSweep:{checked:true,clear:true,partName:sweep.partName} } : {}) });
    }
    valid.sort((a, b) => (a.routeCost ?? Infinity) - (b.routeCost ?? Infinity));
    return valid[0] || null;
  }

  async approachAndInteract(actorId, targetId, action, { partName = null, maxDistance = DEFAULT_INTERACTION_DISTANCE, speed } = {}) {
    if (!['open', 'close'].includes(action)) throw Errors.actionUnsupported(targetId, `embodied:${action}`);
    this.assertSupports(targetId, action);
    if (!this.locomotion) throw Errors.interactionUnavailable(actorId, targetId, 'LOCOMOTION_UNAVAILABLE');
    const pose = await this.findInteractionPose(actorId, targetId, { maxDistance, action, partName });
    if (!pose) throw Errors.interactionUnavailable(actorId, targetId, 'NO_INTERACTION_POSE', { maxDistance });

    let locomotion = null;
    if (pose.status !== 'current-pose') {
      locomotion = await this.locomotion.navigate(actorId, pose.position, { speed });
      if (locomotion.status !== 'arrived') return { status:'interaction-blocked', reason:'APPROACH_FAILED', actorId,targetId,action,pose,locomotion };
    }

    const reach = this.interactionStatus(actorId, targetId, { maxDistance });
    if (!reach.interactable) {
      const reason = reach.inRange ? 'LINE_OF_SIGHT_BLOCKED' : 'OUT_OF_RANGE';
      return { status:'interaction-blocked', reason, actorId,targetId,action,pose,locomotion,reach };
    }
    const finalSweep = this.actionSweepBounds(targetId, action, partName);
    const actualPosition = this.physics.getPosition(actorId);
    if (!finalSweep.checked) return { status:'interaction-blocked', reason:'ACTION_SWEEP_UNAVAILABLE', actorId,targetId,action,pose,locomotion,sweep:{checked:false,reason:finalSweep.reason,partName:finalSweep.partName} };
    if (!actualPosition || finalSweep.box.intersectsBox(this.actorBoxAt(actorId, actualPosition))) {
      return { status:'interaction-blocked', reason:'AGENT_BLOCKS_ACTION_SWEEP', actorId,targetId,action,pose,locomotion,sweep:{checked:true,partName:finalSweep.partName} };
    }
    const center = this.spatial.getBounds(targetId).center;
    const actor = this.physics.getPosition(actorId);
    if (actor) this.physics.faceCharacter(actorId, [center[0] - actor[0], 0, center[2] - actor[2]]);
    const interaction = this.setArticulationAction(targetId, action, { partName });
    const completion = await this.waitForArticulationCompletion(targetId,interaction.part,action,interaction.target);
    const statePromoted = this.promoteArticulationCompletion(completion);
    const stateFinalized = !statePromoted && this.finalizeArticulationAttempt(completion);
    return { ...completion, statePromoted,stateFinalized,actorId,targetId,action,pose,locomotion,reach,actionSweep:{checked:true,clear:true,partName:finalSweep.partName},interaction };
  }

  async findPickupPlan(actorId, targetId, { maxDistance = DEFAULT_INTERACTION_DISTANCE } = {}) {
    this.assertAgentCarryable(actorId,targetId);
    if (!this.locomotion) throw Errors.carryUnavailable(actorId,targetId,'LOCOMOTION_UNAVAILABLE');
    const targetCenter=this.spatial.getBounds(targetId).center;
    const anchor=this.holdAnchor(actorId);
    const transferAt=(position)=>{
      const dx=targetCenter[0]-position[0], dz=targetCenter[2]-position[2];
      const yaw=Math.hypot(dx,dz)<1e-8 ? 0 : Math.atan2(-dx,-dz);
      const anchorPose=this.holdPoseAt(position,yaw,anchor);
      const transfer=this.physics.bodyMotionClear(targetId,anchorPose.position,anchorPose.rotation,{excludeIds:[actorId]});
      return {yaw,anchorPose,transfer};
    };
    const plannedMaxDistance=Math.max(.05,maxDistance-DEFAULT_WAYPOINT_TOLERANCE);
    const pose=await this.findInteractionPose(actorId,targetId,{maxDistance:plannedMaxDistance,candidateFilter:(position)=>transferAt(position).transfer.clear});
    if (!pose) throw Errors.carryUnavailable(actorId,targetId,'NO_PICKUP_TRANSFER_POSE');
    const preview=transferAt(pose.position);
    return {pose,facingYaw:preview.yaw,anchorPose:preview.anchorPose,transfer:preview.transfer,plannedMaxDistance};
  }

  async approachAndPickup(actorId, targetId, { speed, maxDistance = DEFAULT_INTERACTION_DISTANCE } = {}) {
    const target = this.assertAgentCarryable(actorId,targetId);
    if (target.state?.heldBy?.kind === 'agent' && target.state.heldBy.id === actorId) {
      return { status:'held',actorId,targetId,attachment:'kinematic-anchor',graspVerified:false,alreadyHeld:true };
    }
    const plan=await this.findPickupPlan(actorId,targetId,{maxDistance});
    const pose=plan.pose;
    let locomotion=null;
    if (pose.status!=='current-pose') {
      locomotion=await this.locomotion.navigate(actorId,pose.position,{speed});
      if (locomotion.status!=='arrived') return {status:'pickup-blocked',reason:'APPROACH_FAILED',actorId,targetId,pose,locomotion,held:false};
    }
    const reach=this.interactionStatus(actorId,targetId,{maxDistance});
    if (!reach.interactable) return {status:'pickup-blocked',reason:reach.inRange?'LINE_OF_SIGHT_BLOCKED':'OUT_OF_RANGE',actorId,targetId,pose,locomotion,reach,held:false};
    const actorPosition=this.physics.getPosition(actorId);
    const targetCenter=this.spatial.getBounds(targetId).center;
    const dx=targetCenter[0]-actorPosition[0], dz=targetCenter[2]-actorPosition[2];
    const facingYaw=Math.hypot(dx,dz)<1e-8 ? plan.facingYaw : Math.atan2(-dx,-dz);
    this.physics.setCharacterYaw(actorId,facingYaw);
    const anchorPose=this.physics.anchorPose(actorId,this.holdAnchor(actorId));
    if (!anchorPose) return {status:'pickup-blocked',reason:'HOLD_ANCHOR_UNAVAILABLE',actorId,targetId,pose,locomotion,held:false};
    const transfer=this.physics.bodyMotionClear(targetId,anchorPose.position,anchorPose.rotation,{excludeIds:[actorId]});
    if (!transfer.clear) return {status:'pickup-blocked',reason:'PICKUP_TRANSFER_BLOCKED',actorId,targetId,pose,locomotion,transfer,held:false};

    this.physics.setHeld(targetId,true);
    target.state.heldBy={kind:'agent',id:actorId,anchor:'hold'};
    this.agentHeld.set(actorId,targetId);
    this.physics.setHeldPose(targetId,anchorPose.position,anchorPose.rotation);
    this.events.emit('interaction',{action:'pickup',id:targetId,actorId,heldBy:target.state.heldBy});
    return {
      status:'held',actorId,targetId,attachment:'kinematic-anchor',graspVerified:false,
      pose,locomotion,reach,transfer:{clear:true},facingYaw,anchor:{name:'hold',position:anchorPose.position}
    };
  }

  articulationTaskKey(id, partName) { return `${id}:${partName}`; }

  finishArticulationTask(task, result) {
    const key = this.articulationTaskKey(task.id,task.partName);
    if (this.articulationTasks.get(key) !== task) return;
    this.articulationTasks.delete(key);
    const report = { ...result, id:task.id, partName:task.partName, action:task.action, target:task.target };
    this.articulationResults.set(key,report);
    this.events.emit('interaction', { ...report, action:'articulation-completion', articulationAction:report.action });
    task.resolve(report);
  }

  promoteArticulationCompletion(report) {
    if (report?.status !== 'action-completed' || !report.targetReached || !this.store.has(report.id)) return false;
    const record = this.store.get(report.id);
    if (record.state.partTargets?.[report.partName] !== report.action) return false;
    record.state.parts ||= {};
    record.state.parts[report.partName] = report.action;
    delete record.state.partTargets[report.partName];
    if (!Object.keys(record.state.partTargets).length) delete record.state.partTargets;
    return true;
  }

  finalizeArticulationAttempt(report) {
    if (!report || !['action-failed','action-unverified'].includes(report.status) || !this.store.has(report.id)) return false;
    const record = this.store.get(report.id);
    if (record.state.partTargets?.[report.partName] !== report.action) return false;
    this.physics.holdArticulationCurrent?.(report.id,report.partName);
    delete record.state.partTargets[report.partName];
    if (!Object.keys(record.state.partTargets).length) delete record.state.partTargets;
    return true;
  }

  articulationStatus(id, partName = null) {
    const record = this.store.get(id);
    const entries = Object.entries(record.manifest.parts || {}).filter(([name,part]) =>
      (!partName || name === partName) && part.joint && part.physics && Object.keys(part.targets || {}).length
    );
    if (!entries.length) throw Errors.actionUnsupported(id, partName ? `status:${partName}` : 'articulation-status');
    const parts = entries.map(([name,part]) => {
      const key = this.articulationTaskKey(id,name);
      const pending = this.articulationTasks.get(key);
      const last = this.articulationResults.get(key) || null;
      const requestedAction = record.state.partTargets?.[name] || null;
      const verifiedAction = record.state.parts?.[name] || null;
      const targetAction = pending?.action || requestedAction || verifiedAction;
      const target = targetAction && Number.isFinite(part.targets?.[targetAction]) ? part.targets[targetAction] : null;
      const live = this.physics.articulationState(id,name,{target});
      return {
        partName:name,
        status:pending ? 'moving' : (last?.status || (verifiedAction ? 'verified-state' : 'idle')),
        requestedAction,verifiedAction,
        ...(pending ? { pending:{action:pending.action,target:pending.target,elapsed:Number(pending.elapsed.toFixed(3))} } : {}),
        ...(last ? { last:structuredClone(last) } : {}),
        ...(live ? { live:{coordinate:live.coordinate,target:live.target,error:live.error,tolerance:live.tolerance,coordinateReference:live.coordinateReference} } : {})
      };
    });
    return { id, parts };
  }

  waitForArticulationCompletion(id, partName, action, target, {
    timeout = 4, stableDuration = .18, stallWindow = .5, stallTolerance = .008
  } = {}) {
    const key = this.articulationTaskKey(id,partName);
    const existing = this.articulationTasks.get(key);
    if (existing && existing.action === action && Math.abs(existing.target-target) <= 1e-9) return existing.promise;
    if (existing) this.finishArticulationTask(existing,{status:'action-unverified',reason:'SUPERSEDED',targetReached:false,settled:false,elapsed:Number(existing.elapsed.toFixed(3))});
    const state = this.physics.articulationState(id,partName,{target});
    if (!state) return Promise.resolve({status:'action-unverified',reason:'JOINT_STATE_UNAVAILABLE',id,partName,action,target,targetReached:false,settled:false,elapsed:0});
    let resolveTask;
    const task = {
      id,partName,action,target,timeout,stableDuration,stallWindow,stallTolerance,
      elapsed:0,stable:0,initialCoordinate:state.coordinate,samples:[{time:0,coordinate:state.coordinate}],
      resolve:null,promise:null
    };
    task.promise = new Promise((resolve) => { resolveTask=resolve; });
    task.resolve = resolveTask;
    this.articulationTasks.set(key,task);
    return task.promise;
  }

  articulationFailureAttribution(id, partName) {
    const contacts=(this.physics.articulationContacts?.(id,partName) || []).filter((item)=>item.external);
    const blockerMap=new Map();
    for (const item of contacts) {
      const target=item.target || {};
      if (!['object','environment'].includes(target.kind)) continue;
      const key=target.kind==='object'
        ? `object:${target.objectId}:${target.partName || '$root'}`
        : `environment:${target.environmentId}:${target.colliderIndex ?? -1}`;
      if (!blockerMap.has(key)) blockerMap.set(key,structuredClone(target));
    }
    return {
      status:contacts.length ? 'contact-evidence' : 'unattributed',
      evidence:'current-contact-at-failure',
      contactEvidence:contacts,
      blockerCandidates:[...blockerMap.values()]
    };
  }

  updateArticulationTasks(dt) {
    const wrap = (jointType,value) => jointType === 'revolute' ? Math.atan2(Math.sin(value),Math.cos(value)) : value;
    for (const task of [...this.articulationTasks.values()]) {
      task.elapsed += dt;
      const state = this.physics.articulationState(task.id,task.partName,{target:task.target});
      if (!state || !Number.isFinite(state.coordinate) || !Number.isFinite(state.error)) {
        this.finishArticulationTask(task,{status:'action-unverified',reason:'JOINT_STATE_UNAVAILABLE',targetReached:false,settled:false,elapsed:Number(task.elapsed.toFixed(3))});
        continue;
      }
      const limits = state.limits;
      if (limits?.length === 2 && (state.coordinate < limits[0]-state.tolerance || state.coordinate > limits[1]+state.tolerance)) {
        this.finishArticulationTask(task,{status:'action-failed',reason:'LIMIT_VIOLATION',targetReached:false,settled:false,coordinate:state.coordinate,error:state.error,tolerance:state.tolerance,limits,elapsed:Number(task.elapsed.toFixed(3))});
        continue;
      }
      const reached = state.error <= state.tolerance;
      task.stable = reached ? task.stable + dt : 0;
      task.samples.push({time:task.elapsed,coordinate:state.coordinate});
      const cutoff = task.elapsed-task.stallWindow;
      while (task.samples.length > 2 && task.samples[1].time <= cutoff) task.samples.shift();
      const oldest = task.samples[0];
      const recentMovement = Math.abs(wrap(state.jointType,state.coordinate-oldest.coordinate));
      const observedWindow = task.elapsed-oldest.time;
      const stableCutoff = task.elapsed-task.stableDuration;
      const stableReference = task.samples.find((sample)=>sample.time >= stableCutoff) || oldest;
      const settleMovement = Math.abs(wrap(state.jointType,state.coordinate-stableReference.coordinate));
      const settleTolerance = state.tolerance*.25;
      const progress = Math.abs(wrap(state.jointType,task.initialCoordinate-task.target)) - state.error;
      if (task.stable >= task.stableDuration && settleMovement <= settleTolerance) {
        this.finishArticulationTask(task,{status:'action-completed',targetReached:true,settled:true,coordinate:state.coordinate,error:state.error,tolerance:state.tolerance,settleMovement:Number(settleMovement.toFixed(6)),settleTolerance:Number(settleTolerance.toFixed(6)),progress:Number(progress.toFixed(6)),elapsed:Number(task.elapsed.toFixed(3)),coordinateReference:state.coordinateReference});
        continue;
      }
      if (!reached && task.elapsed >= task.stallWindow && observedWindow >= task.stallWindow*.8 && recentMovement < task.stallTolerance) {
        const attribution=this.articulationFailureAttribution(task.id,task.partName);
        this.finishArticulationTask(task,{status:'action-failed',reason:'STALL',targetReached:false,settled:false,coordinate:state.coordinate,error:state.error,tolerance:state.tolerance,recentMovement:Number(recentMovement.toFixed(6)),stallWindow:task.stallWindow,progress:Number(progress.toFixed(6)),elapsed:Number(task.elapsed.toFixed(3)),coordinateReference:state.coordinateReference,attribution});
        continue;
      }
      if (task.elapsed >= task.timeout) {
        this.finishArticulationTask(task,{status:'action-unverified',reason:'TIMEOUT',targetReached:false,settled:false,coordinate:state.coordinate,error:state.error,tolerance:state.tolerance,recentMovement:Number(recentMovement.toFixed(6)),progress:Number(progress.toFixed(6)),elapsed:Number(task.elapsed.toFixed(3)),coordinateReference:state.coordinateReference});
      }
    }
  }

  waitForPlacementSettle(objectId, targetId, surfaceId, { timeout = 4, stableDuration = 0.35, linearSpeed = 0.04, angularSpeed = 0.12 } = {}) {
    if (this.settleTasks.has(objectId)) throw Errors.placeUnavailable('runtime', targetId, 'SETTLE_ALREADY_ACTIVE', { objectId });
    return new Promise((resolve) => this.settleTasks.set(objectId, {
      objectId,targetId,surfaceId,timeout,stableDuration,linearSpeed,angularSpeed,elapsed:0,stable:0,resolve
    }));
  }

  finishPlacementSettle(task, result) {
    if (!this.settleTasks.has(task.objectId)) return;
    this.settleTasks.delete(task.objectId);
    this.events.emit('interaction', { action:'place', id:task.objectId, targetId:task.targetId, ...result });
    task.resolve(result);
  }

  updatePlacementSettles(dt) {
    for (const task of [...this.settleTasks.values()]) {
      task.elapsed += dt;
      const motion = this.physics.bodyMotionState(task.objectId);
      if (!motion) {
        this.finishPlacementSettle(task, { status:'place-failed', reason:'BODY_UNAVAILABLE', supportVerified:false, elapsed:Number(task.elapsed.toFixed(3)) });
        continue;
      }
      const slow = motion.sleeping || (motion.linearSpeed <= task.linearSpeed && motion.angularSpeed <= task.angularSpeed);
      task.stable = slow ? task.stable + dt : 0;
      if (task.stable >= task.stableDuration) {
        const support = this.spatial.supportStatus(task.objectId, task.targetId, { surfaceId:task.surfaceId });
        this.finishPlacementSettle(task, {
          status:support.on ? 'placed' : 'place-failed',
          ...(support.on ? {} : { reason:'SUPPORT_NOT_REACHED' }),
          supportVerified:support.on,
          support,
          settled:true,
          elapsed:Number(task.elapsed.toFixed(3)),
          motion:{ sleeping:motion.sleeping, linearSpeed:Number(motion.linearSpeed.toFixed(4)), angularSpeed:Number(motion.angularSpeed.toFixed(4)) }
        });
        continue;
      }
      if (task.elapsed >= task.timeout) {
        const support = this.spatial.supportStatus(task.objectId, task.targetId, { surfaceId:task.surfaceId });
        this.finishPlacementSettle(task, {
          status:'place-unverified', reason:'SETTLE_TIMEOUT', supportVerified:false, support, settled:false,
          elapsed:Number(task.elapsed.toFixed(3)),
          motion:{ sleeping:motion.sleeping, linearSpeed:Number(motion.linearSpeed.toFixed(4)), angularSpeed:Number(motion.angularSpeed.toFixed(4)) }
        });
      }
    }
  }

  async approachAndPlace(actorId, targetId, { surfaceId = null, speed, clearance = 0.03 } = {}) {
    const heldId = this.heldByAgent(actorId);
    if (!heldId) throw Errors.placeUnavailable(actorId, targetId, 'NOT_HOLDING_OBJECT');
    this.assertSupports(heldId, 'place');
    const target = this.store.get(targetId);
    if (!target.manifest.surfaces?.length) throw Errors.placeUnavailable(actorId, targetId, 'TARGET_HAS_NO_SURFACE');
    if (!this.locomotion) throw Errors.placeUnavailable(actorId, targetId, 'LOCOMOTION_UNAVAILABLE');

    let release = this.spatial.findFreeSpace(heldId,targetId,{surfaceId,clearance});
    if (!release) throw Errors.placeUnavailable(actorId,targetId,'NO_FREE_SURFACE_SPACE',{heldId,surfaceId});
    const anchor = this.holdAnchor(actorId);
    const releasePoint = release.toArray();
    const canReachRelease = (position) => {
      const dx=releasePoint[0]-position[0], dz=releasePoint[2]-position[2];
      const yaw=Math.hypot(dx,dz) < 1e-8 ? 0 : Math.atan2(-dx,-dz);
      const predicted=this.holdPoseAt(position,yaw,anchor);
      return new THREE.Vector3(...predicted.position).distanceTo(release) <= DEFAULT_INTERACTION_DISTANCE - DEFAULT_WAYPOINT_TOLERANCE;
    };
    const pose = await this.findInteractionPose(actorId,targetId,{ignoreIds:[heldId],standOff:this.carryStandOff(actorId,heldId),candidateFilter:canReachRelease});
    if (!pose) throw Errors.placeUnavailable(actorId,targetId,'NO_INTERACTION_POSE',{heldId});

    let locomotion = null;
    if (pose.status !== 'current-pose') {
      locomotion = await this.locomotion.navigate(actorId,pose.position,{speed});
      if (locomotion.status !== 'arrived') return { status:'place-blocked', reason:'APPROACH_FAILED', actorId,targetId,heldId,locomotion,stillHeld:true };
    }

    release = this.spatial.findFreeSpace(heldId,targetId,{surfaceId,clearance});
    if (!release) return { status:'place-blocked', reason:'NO_FREE_SURFACE_SPACE_AFTER_APPROACH', actorId,targetId,heldId,locomotion,stillHeld:true };
    const reach = this.interactionStatus(actorId,targetId,{ignoreIds:[heldId]});
    if (!reach.interactable) return { status:'place-blocked', reason:reach.inRange ? 'LINE_OF_SIGHT_BLOCKED' : 'OUT_OF_RANGE', actorId,targetId,heldId,locomotion,reach,stillHeld:true };
    const reorientation = this.reorientHeldToward(actorId,heldId,release.toArray());
    if (!reorientation.clear) return { status:'place-blocked', reason:'CARRY_REORIENT_BLOCKED', actorId,targetId,heldId,locomotion,reach,reorientation,stillHeld:true };
    const originalPosition = this.physics.getPosition(heldId);
    const rotation = this.physics.getRotation(heldId);
    const releaseDistance = originalPosition ? new THREE.Vector3(...originalPosition).distanceTo(release) : Infinity;
    if (releaseDistance > DEFAULT_INTERACTION_DISTANCE) return {
      status:'place-blocked',reason:'RELEASE_OUT_OF_RANGE',actorId,targetId,heldId,
      pose,locomotion,reach,reorientation,
      heldPosition:[...originalPosition],release:release.toArray(),releaseDistance:Number(releaseDistance.toFixed(3)),stillHeld:true
    };

    if (!originalPosition || !rotation) return { status:'place-blocked', reason:'HELD_BODY_UNAVAILABLE', actorId,targetId,heldId,stillHeld:true };
    const size = this.spatial.getBounds(heldId).size;
    const liftY = Math.max(originalPosition[1],release.y + size[1] + 0.08);
    const transferPoints = [
      [originalPosition[0],liftY,originalPosition[2]],
      [release.x,liftY,release.z],
      release.toArray()
    ];
    const transfer = [];
    for (const point of transferPoints) {
      const check = this.physics.bodyMotionClear(heldId,point,rotation,{excludeIds:[actorId]});
      transfer.push({point:[...point],...check});
      if (!check.clear) {
        this.physics.setHeldPose(heldId,originalPosition,rotation);
        return { status:'place-blocked', reason:'PLACE_TRANSFER_BLOCKED', actorId,targetId,heldId,transfer,stillHeld:true };
      }
      this.physics.setHeldPose(heldId,point,rotation);
    }

    const selectedSurface = this.spatial.getSupportSurface(targetId,surfaceId)?.id || surfaceId;
    this.releaseHeld(heldId,'PLACE_RELEASE');
    const settled = await this.waitForPlacementSettle(heldId,targetId,selectedSurface);
    return {
      ...settled, actorId,targetId,heldId,pose,locomotion,reach,reorientation,
      release:release.toArray().map((value)=>Number(value.toFixed(4))),
      transfer:transfer.map(({point,clear,code,blockedBy,toi})=>({point,clear,...(code?{code}:{}),...(blockedBy?{blockedBy}:{}),...(Number.isFinite(toi)?{toi}: {})})),
      stillHeld:false
    };
  }

  dropHeld(actorId) {
    const id = this.heldByAgent(actorId);
    if (!id) return { status:'empty', actorId };
    this.assertSupports(id, 'drop');
    this.releaseHeld(id);
    return { status:'dropped', actorId, targetId:id, position:this.physics.getPosition(id) };
  }

  carryStatus(actorId) {
    const id = this.heldByAgent(actorId);
    if (!id) return { status:'empty', actorId };
    const record = this.store.get(id);
    return { status:'held', actorId, targetId:id, heldBy:structuredClone(record.state.heldBy), position:this.physics.getPosition(id), attachment:'kinematic-anchor', graspVerified:false };
  }

  findPartForAction(record, action, partName = null) {
    const parts = Object.entries(record.manifest.parts || {}).filter(([name, part]) =>
      (!partName || name === partName) && part.actions?.includes(action) && Number.isFinite(part.targets?.[action])
    );
    if (parts.length !== 1) throw Errors.actionUnsupported(record.id, partName ? `${action}:${partName}` : action);
    return parts[0];
  }

  setArticulationAction(id, action, { partName = null } = {}) {
    const record = this.assertSupports(id, action);
    const [name, part] = this.findPartForAction(record, action, partName);
    if (!this.physics.setArticulationTarget(id, name, part.targets[action])) throw Errors.actionUnsupported(id, action);
    record.state.partTargets ||= {};
    record.state.partTargets[name] = action;
    this.articulationResults.delete(this.articulationTaskKey(id,name));
    this.waitForArticulationCompletion(id,name,action,part.targets[action]);
    this.events.emit('interaction', { action, id, part:name, target:part.targets[action] });
    return { id, part:name, action, target:part.targets[action], requested:true };
  }

  update(dt, camera) {
    this.updatePlacementSettles(dt);
    this.updateArticulationTasks(dt);
    if (this.humanHeldId) {
      const target = new THREE.Vector3(0,0,-1.6).applyQuaternion(camera.quaternion).add(camera.position);
      this.physics.setHeldTarget(this.humanHeldId, target);
    }
    for (const [actorId, targetId] of this.agentHeld) {
      if (!this.store.has(actorId) || !this.store.has(targetId)) continue;
      const pose = this.physics.anchorPose(actorId, this.holdAnchor(actorId));
      if (pose) this.physics.setHeldTarget(targetId, pose.position, pose.rotation);
    }
  }
}
