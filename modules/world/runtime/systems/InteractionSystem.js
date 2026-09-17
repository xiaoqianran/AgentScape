import * as THREE from 'three';
import { Errors } from '../../errors.js';
import { compileInteractionContract } from '../interaction/InteractionContract.js';
import { ArticulationRuntime } from '../interaction/ArticulationRuntime.js';
import { SettleRuntime } from '../interaction/SettleRuntime.js';
import { InteractionApproach, DEFAULT_INTERACTION_DISTANCE, INTERACTION_APPROACH_MARGIN } from '../interaction/InteractionApproach.js';
import { CarryRuntime } from '../interaction/CarryRuntime.js';
import { RecoveryRuntime } from '../interaction/RecoveryRuntime.js';

export { DEFAULT_INTERACTION_DISTANCE };
export class InteractionSystem {
  constructor({ store, physics, spatial, navigation = null, locomotion = null, events, onObjectTransform = null }) {
    this.store = store;
    this.physics = physics;
    this.spatial = spatial;
    this.navigation = navigation;
    this.locomotion = locomotion;
    this.events = events;
    this.onObjectTransform = typeof onObjectTransform === 'function' ? onObjectTransform : null;
    this.carry = new CarryRuntime({ store, physics, spatial, events, assertSupports:(...args)=>this.assertSupports(...args) });
    this.articulationRuntime = new ArticulationRuntime({ store, physics, events, assertSupports:(...args)=>this.assertSupports(...args) });
    this.articulationTasks = this.articulationRuntime.tasks;
    this.articulationResults = this.articulationRuntime.results;
    this.settleRuntime = new SettleRuntime({ store, physics, spatial, events, carry:this.carry, articulation:this.articulationRuntime });
    this.settleTasks = this.settleRuntime.tasks;
    this.approach = new InteractionApproach({
      store, physics, spatial, navigation, locomotion,
      actionSweepBounds: (...args) => this.actionSweepBounds(...args)
    });
    this.recovery = new RecoveryRuntime({
      store, physics, spatial, navigation, locomotion,
      approach:this.approach, carry:this.carry, articulation:this.articulationRuntime,
      interactionDistance:DEFAULT_INTERACTION_DISTANCE,
      waypointTolerance:INTERACTION_APPROACH_MARGIN
    });
  }

  get heldId() { return this.carry.humanHeldId; }
  get humanHeldId() { return this.carry.humanHeldId; }
  set humanHeldId(value) { this.carry.humanHeldId = value; }
  get agentHeld() { return this.carry.agentHeld; }
  get recoveryHeld() { return this.recovery.held; }

  setHumanViewPose(...args) { return this.carry.setHumanViewPose(...args); }

  debugSnapshot({ actorId = null, targetId = null, maxDistance = DEFAULT_INTERACTION_DISTANCE } = {}) {
    let reach = null;
    if (actorId && targetId && this.store.has(actorId) && this.store.has(targetId)) {
      try { reach = this.interactionStatus(actorId, targetId, { maxDistance }); }
      catch { reach = null; }
    }
    return {
      schemaVersion: 1,
      source: "interaction",
      held: {
        human: this.carry.humanHeldId,
        agents: [...this.carry.agentHeld.entries()].map(([actor, object]) => ({ actorId: actor, objectId: object })),
        recovery: [...this.recoveryHeld.entries()].map(([actor, value]) => ({ actorId: actor, ...structuredClone(value) }))
      },
      pending: {
        settle: [...this.settleTasks.values()].map((task) => ({
          kind: task.kind,
          actorId: task.actorId || null,
          objectId: task.objectId || null,
          targetId: task.targetId || null,
          elapsed: Number((task.elapsed || 0).toFixed(4))
        })),
        articulation: [...this.articulationTasks.values()].map((task) => ({
          id: task.id,
          partName: task.partName,
          action: task.action,
          elapsed: Number((task.elapsed || 0).toFixed(4))
        }))
      },
      reach
    };
  }

  isHeld(...args) { return this.carry.isHeld(...args); }

  heldByAgent(...args) { return this.carry.heldByAgent(...args); }

  syncRecoveryRuntime() {
    this.recovery.physics = this.physics;
    this.recovery.spatial = this.spatial;
    this.recovery.navigation = this.navigation;
    this.recovery.locomotion = this.locomotion;
    this.recovery.carry = {
      heldByAgent:(...args)=>this.heldByAgent(...args),
      holdAnchor:(...args)=>this.holdAnchor(...args),
      carryStandOff:(...args)=>this.carryStandOff(...args),
      holdPoseAt:(...args)=>this.holdPoseAt(...args)
    };
    this.recovery.approach = {
      actorMetrics:(...args)=>this.actorMetrics(...args),
      actorBoxAt:(...args)=>this.actorBoxAt(...args)
    };
    this.recovery.articulation = { actionSweepBounds:(...args)=>this.actionSweepBounds(...args) };
    this.recovery.getProvenance = (...args)=>this.recoveryHeldStatus(...args);
  }

  markRecoveryHeld(...args) { this.syncRecoveryRuntime(); return this.recovery.markHeld(...args); }

  recoveryHeldStatus(...args) { return this.recovery.status(...args); }

  holdAnchor(...args) { return this.carry.holdAnchor(...args); }

  carryStandOff(actorId, heldId) { return this.carry.carryStandOff(actorId, heldId, this.holdAnchor(actorId)); }

  holdPoseAt(...args) { return this.carry.holdPoseAt(...args); }

  reorientHeldToward(...args) { return this.carry.reorientHeldToward(...args); }

  assertAgentCarryable(...args) { return this.carry.assertAgentCarryable(...args); }

  releaseHeld(id, reason = null, options = {}) { const result=this.carry.releaseHeld(id,reason,options); if(result.released && result.heldBy?.kind==='agent') this.recoveryHeld.delete(result.heldBy.id); return result.released; }

  rebuildHeldOwnership() { this.recoveryHeld.clear(); return this.carry.rebuildHeldOwnership(); }

  beforeRemove(id,{silent=false}={}) {
    for (const [actorId,recovery] of [...this.recoveryHeld]) if (actorId===id || recovery.blockerId===id || recovery.targetId===id) this.recoveryHeld.delete(actorId);
    for (const key of [...this.articulationResults.keys()]) if (key.startsWith(`${id}:`)) this.articulationResults.delete(key);
    for (const task of [...this.articulationTasks.values()]) if (task.id === id) {
      this.finishArticulationTask(task,{status:'action-unverified',reason:'OBJECT_REMOVED',targetReached:false,settled:false,elapsed:Number(task.elapsed.toFixed(3))});
    }
    for (const settle of [...this.settleTasks.values()]) if (settle.objectId===id || settle.targetId===id) {
      this.finishPlacementSettle(settle,settle.kind==='recovery-cleanup'
        ? this.recoveryCleanupSettleResult(settle,null,{settled:false,reason:'OBJECT_REMOVED'})
        : settle.kind==='drop'
          ? this.dropSettleResult(settle,null,{settled:false,reason:'OBJECT_REMOVED'})
          : {status:'place-unverified',reason:'OBJECT_REMOVED',supportVerified:false,settled:false,elapsed:Number(settle.elapsed.toFixed(3))});
    }
    if (this.store.has(id) && this.store.get(id).state?.heldBy) this.releaseHeld(id, 'OBJECT_REMOVED',{silent});
    const carried = this.carry.agentHeld.get(id);
    if (carried && this.store.has(carried)) this.releaseHeld(carried, 'OWNER_REMOVED',{silent});
  }

  cancelPending(reason = 'RUNTIME_DISPOSED') {
    for (const task of [...this.settleTasks.values()]) {
      this.finishPlacementSettle(task,task.kind==='recovery-cleanup'
        ? this.recoveryCleanupSettleResult(task,null,{settled:false,reason})
        : task.kind==='drop'
          ? this.dropSettleResult(task,null,{settled:false,reason})
          : {status:'place-unverified',reason,supportVerified:false,settled:false,elapsed:Number(task.elapsed.toFixed(3))});
    }
    for (const task of [...this.articulationTasks.values()]) {
      this.finishArticulationTask(task,{status:'action-unverified',reason,targetReached:false,settled:false,elapsed:Number(task.elapsed.toFixed(3))});
    }
  }

  notifyObjectTransform(id, reason) { return this.onObjectTransform?.(id, reason) ?? false; }

  supports(record, action) { return record.manifest.actions.includes(action); }
  interactionContracts(record) { return compileInteractionContract(record.manifest); }

  assertSupports(id, action) {
    const record = this.store.get(id);
    if (!this.supports(record, action)) throw Errors.actionUnsupported(id, action);
    return record;
  }

  move(id, position, {silent=false} = {}) {
    const record = this.assertSupports(id, 'move');
    record.object.position.fromArray(position);
    this.physics.setPosition(id, position);
    this.notifyObjectTransform(id, 'interaction.move');
    if(!silent) this.events.emit('interaction', { action: 'move', id, position });
  }

  pickup(id,{silent=false}={}) {
    const record = this.assertSupports(id, 'pickup');
    if (record.state?.heldBy?.kind === 'agent') throw Errors.carryUnavailable('human', id, 'OBJECT_ALREADY_HELD', { heldBy:record.state.heldBy });
    if (this.carry.humanHeldId && this.carry.humanHeldId !== id) this.drop(this.carry.humanHeldId,{silent});
    record.state.heldBy = { kind:'human' };
    this.carry.humanHeldId = id;
    this.physics.setHeld(id, true);
    if(!silent) this.events.emit('interaction', { action:'pickup', id, heldBy:{kind:'human'} });
    return { status:'held', id, heldBy:{kind:'human'} };
  }

  drop(id = this.carry.humanHeldId,{silent=false}={}) { if (!id) return false; this.assertSupports(id, 'drop'); return this.releaseHeld(id,null,{silent}); }

  place(id, targetId, options = {}) {
    const {silent=false,...placementOptions}=options;
    this.assertSupports(id, 'place');
    const target = this.store.get(targetId);
    if (!target.manifest.surfaces?.length) throw Errors.actionUnsupported(targetId, 'receive');
    const p = this.spatial.findFreeSpace(id, targetId, placementOptions);
    if (!p) throw new Error(`No overlap-free placement found on ${targetId}`);
    this.pickup(id,{silent});
    this.store.get(id).object.position.copy(p);
    this.physics.setPosition(id, p.toArray());
    this.notifyObjectTransform(id, 'interaction.place');
    this.drop(id,{silent});
    if(!silent) this.events.emit('interaction', { action: 'place', id, targetId, position: p.toArray() });
    return { id, targetId, position: p.toArray().map((v) => Number(v.toFixed(3))) };
  }



  placeInside(id, targetId, { receptacleId = null, clearance = 0.03, silent = false } = {}) {
    const record=this.store.get(id);
    const target=this.store.get(targetId);
    if (!target.manifest.receptacles?.length) return {status:'inside-blocked',reason:'TARGET_HAS_NO_RECEPTACLE',id,targetId,receptacleId};
    const position=this.spatial.findFreeSpaceInside(id,targetId,{
      receptacleId,clearance,ignore:[],
      poseClear:(candidate)=>this.physics.checkManifestPose(record.manifest,candidate,{excludeIds:[id]})
    });
    if (!position) return {status:'inside-blocked',reason:'NO_FREE_RECEPTACLE_SPACE',id,targetId,receptacleId};
    record.object.position.copy(position);
    this.physics.setPosition(id,position.toArray());
    this.notifyObjectTransform(id, 'interaction.place-inside');
    record.object.updateWorldMatrix(true,true);
    const containment=this.spatial.containmentGeometry(id,targetId,{receptacleId});
    if(!silent) this.events.emit('interaction',{action:'place-inside',id,targetId,receptacleId:containment.receptacleId,position:position.toArray()});
    return {
      status:containment.inside?'inside':'inside-unverified',id,targetId,
      receptacleId:containment.receptacleId || receptacleId,
      containmentVerified:containment.inside,
      position:position.toArray().map((value)=>Number(value.toFixed(4)))
    };
  }

  actorBoxAt(...args) { return this.approach.actorBoxAt(...args); }

  actionSweepBounds(...args) { return this.articulationRuntime.actionSweepBounds(...args); }

  actorMetrics(...args) { return this.approach.actorMetrics(...args); }

  interactionStatusAt(...args) { return this.approach.interactionStatusAt(...args); }

  interactionStatus(...args) { return this.approach.interactionStatus(...args); }

  async findInteractionPose(...args) { this.approach.navigation = this.navigation; this.approach.locomotion = this.locomotion; return this.approach.findInteractionPose(...args); }

  async navigateToPose(...args) { this.approach.locomotion = this.locomotion; return this.approach.navigateToPose(...args); }

  async correctToPose(...args) { this.approach.locomotion = this.locomotion; return this.approach.correctToPose(...args); }

  async approachAndInteract(actorId, targetId, action, { partName = null, maxDistance = DEFAULT_INTERACTION_DISTANCE, speed } = {}) {
    if (!['open', 'close'].includes(action)) throw Errors.actionUnsupported(targetId, `embodied:${action}`);
    this.assertSupports(targetId, action);
    const heldId = this.heldByAgent(actorId);
    if (heldId && !this.recoveryHeld.has(actorId)) return {
      status:'interaction-blocked', reason:'HANDS_FULL', actorId,targetId,action,heldId,
      requires:'dropHeld', instruction:'Release the carried object and retry the interaction.'
    };
    if (!this.locomotion) throw Errors.interactionUnavailable(actorId, targetId, 'LOCOMOTION_UNAVAILABLE');
    const pose = await this.findInteractionPose(actorId, targetId, { maxDistance, action, partName });
    if (!pose) throw Errors.interactionUnavailable(actorId, targetId, 'NO_INTERACTION_POSE', { maxDistance });

    const locomotion = await this.navigateToPose(actorId, pose, { speed });
    if (locomotion && locomotion.status !== 'arrived') return { status:'interaction-blocked', reason:'APPROACH_FAILED', actorId,targetId,action,pose,locomotion };

    let reach = this.interactionStatus(actorId, targetId, { maxDistance });
    if (!reach.interactable) {
      const reason = reach.inRange ? 'LINE_OF_SIGHT_BLOCKED' : 'OUT_OF_RANGE';
      return { status:'interaction-blocked', reason, actorId,targetId,action,pose,locomotion,reach };
    }
    const finalSweep = this.actionSweepBounds(targetId, action, partName);
    if (!finalSweep.checked) return { status:'interaction-blocked', reason:'ACTION_SWEEP_UNAVAILABLE', actorId,targetId,action,pose,locomotion,sweep:{checked:false,reason:finalSweep.reason,partName:finalSweep.partName} };
    let actualPosition = this.physics.getPosition(actorId);
    let arrivalCorrection = null;
    if (actualPosition && pose.status !== 'current-pose' && finalSweep.box.intersectsBox(this.actorBoxAt(actorId, actualPosition))) {
      arrivalCorrection = await this.correctToPose(actorId, pose, { speed, force:true });
      actualPosition=this.physics.getPosition(actorId);
      if (arrivalCorrection?.status==='arrived') {
        reach=this.interactionStatus(actorId,targetId,{maxDistance});
        if (!reach.interactable) {
          const reason=reach.inRange ? 'LINE_OF_SIGHT_BLOCKED' : 'OUT_OF_RANGE';
          return {status:'interaction-blocked',reason,actorId,targetId,action,pose,locomotion,arrivalCorrection,reach};
        }
      }
    }
    if (!actualPosition || finalSweep.box.intersectsBox(this.actorBoxAt(actorId, actualPosition))) {
      return { status:'interaction-blocked', reason:'AGENT_BLOCKS_ACTION_SWEEP', actorId,targetId,action,pose,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),sweep:{checked:true,partName:finalSweep.partName} };
    }
    const center = this.spatial.getBounds(targetId).center;
    const actor = this.physics.getPosition(actorId);
    if (actor) this.physics.faceCharacter(actorId, [center[0] - actor[0], 0, center[2] - actor[2]]);
    const interaction = this.setArticulationAction(targetId, action, { partName });
    const completion = await this.waitForArticulationCompletion(targetId,interaction.part,action,interaction.target);
    const statePromoted = this.promoteArticulationCompletion(completion);
    const stateFinalized = !statePromoted && this.finalizeArticulationAttempt(completion);
    return { ...completion, statePromoted,stateFinalized,actorId,targetId,action,pose,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),reach,actionSweep:{checked:true,clear:true,partName:finalSweep.partName},interaction };
  }

  pickupSupportIds(targetId) {
    const supports=[];
    for (const [id,record] of this.store.list()) {
      if (id===targetId || !record.manifest.surfaces?.length) continue;
      const status=this.spatial.supportGeometry(targetId,id);
      if (status.supported) supports.push(id);
    }
    return supports.sort();
  }

  pickupStanceBounds(targetId,supportIds) {
    const target=this.spatial.getBounds(targetId);
    if (!supportIds.length) return target;
    const min=[...target.min],max=[...target.max];
    for (const id of supportIds) {
      const support=this.spatial.getBounds(id);
      for (let axis=0;axis<3;axis++) {
        if (Number.isFinite(support.min[axis])) min[axis]=Math.min(min[axis],support.min[axis]);
        if (Number.isFinite(support.max[axis])) max[axis]=Math.max(max[axis],support.max[axis]);
      }
    }
    return {min,max,center:min.map((value,index)=>(value+max[index])/2),size:min.map((value,index)=>max[index]-value)};
  }

  async findPickupPlan(actorId, targetId, { maxDistance = DEFAULT_INTERACTION_DISTANCE } = {}) {
    this.assertAgentCarryable(actorId,targetId);
    if (!this.locomotion) throw Errors.carryUnavailable(actorId,targetId,'LOCOMOTION_UNAVAILABLE');
    const targetCenter=this.spatial.getBounds(targetId).center;
    const supportIds=this.pickupSupportIds(targetId);
    const stanceBounds=this.pickupStanceBounds(targetId,supportIds);
    const anchor=this.holdAnchor(actorId);
    const transferAt=(position)=>{
      const dx=targetCenter[0]-position[0], dz=targetCenter[2]-position[2];
      const yaw=Math.hypot(dx,dz)<1e-8 ? 0 : Math.atan2(-dx,-dz);
      const anchorPose=this.holdPoseAt(position,yaw,anchor);
      const transfer=supportIds.length
        ? this.physics.checkBodyPose(targetId,anchorPose.position,anchorPose.rotation,{excludeIds:[actorId]})
        : this.physics.checkBodyMotion(targetId,anchorPose.position,anchorPose.rotation,{excludeIds:[actorId]});
      return {yaw,anchorPose,transfer};
    };
    const plannedMaxDistance=Math.max(.05,maxDistance-INTERACTION_APPROACH_MARGIN);
    const supportClearance=supportIds.length ? .05 : .12;
    const standOff=this.carryStandOff(actorId,targetId);
    const pose=await this.findInteractionPose(actorId,targetId,{maxDistance:plannedMaxDistance,clearance:supportClearance,standOff,stanceBounds,candidateFilter:(position)=>transferAt(position).transfer.clear});
    if (!pose) throw Errors.carryUnavailable(actorId,targetId,'NO_PICKUP_TRANSFER_POSE',{supportIds});
    const preview=transferAt(pose.position);
    return {pose,facingYaw:preview.yaw,anchorPose:preview.anchorPose,transfer:preview.transfer,plannedMaxDistance,supportIds,standOff:Number(standOff.toFixed(4)),supportClearance};
  }

  transferPickupToAnchor(...args) { return this.carry.transferPickupToAnchor(...args); }

  async approachAndPickup(actorId, targetId, { speed, maxDistance = DEFAULT_INTERACTION_DISTANCE } = {}) {
    const target = this.assertAgentCarryable(actorId,targetId);
    if (target.state?.heldBy?.kind === 'agent' && target.state.heldBy.id === actorId) {
      return { status:'held',actorId,targetId,attachment:'kinematic-anchor',graspVerified:false,alreadyHeld:true };
    }
    const plan=await this.findPickupPlan(actorId,targetId,{maxDistance});
    const pose=plan.pose;
    const locomotion=await this.navigateToPose(actorId,pose,{speed});
    if (locomotion && locomotion.status!=='arrived') return {status:'pickup-blocked',reason:'APPROACH_FAILED',actorId,targetId,pose,locomotion,held:false};
    const arrivalCorrection=await this.correctToPose(actorId,pose,{speed});
    if (arrivalCorrection && arrivalCorrection.status!=='arrived') return {
      status:'pickup-blocked',reason:'APPROACH_CORRECTION_FAILED',actorId,targetId,pose,locomotion,arrivalCorrection,held:false
    };
    const reach=this.interactionStatus(actorId,targetId,{maxDistance});
    if (!reach.interactable) return {status:'pickup-blocked',reason:reach.inRange?'LINE_OF_SIGHT_BLOCKED':'OUT_OF_RANGE',actorId,targetId,pose,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),reach,held:false};
    const actorPosition=this.physics.getPosition(actorId);
    const targetCenter=this.spatial.getBounds(targetId).center;
    const dx=targetCenter[0]-actorPosition[0], dz=targetCenter[2]-actorPosition[2];
    const facingYaw=Math.hypot(dx,dz)<1e-8 ? plan.facingYaw : Math.atan2(-dx,-dz);
    this.physics.setCharacterYaw(actorId,facingYaw);
    const anchorPose=this.physics.anchorPose(actorId,this.holdAnchor(actorId));
    if (!anchorPose) return {status:'pickup-blocked',reason:'HOLD_ANCHOR_UNAVAILABLE',actorId,targetId,pose,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),held:false};
    const supportIds=this.pickupSupportIds(targetId);
    let transfer;
    if (supportIds.length) {
      transfer=this.transferPickupToAnchor(actorId,targetId,anchorPose,supportIds);
    } else {
      const direct=this.physics.checkBodyMotion(targetId,anchorPose.position,anchorPose.rotation,{excludeIds:[actorId]});
      transfer=direct.clear ? direct : this.transferPickupToAnchor(actorId,targetId,anchorPose,[]);
      if (transfer !== direct) transfer={...transfer,direct};
    }
    if (!transfer.clear) return {status:'pickup-blocked',reason:'PICKUP_TRANSFER_BLOCKED',actorId,targetId,pose,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),transfer,held:false};

    if (!supportIds.length && transfer.mode!=='lift-horizontal-anchor') {
      this.physics.setHeld(targetId,true);
      this.physics.setHeldPose(targetId,anchorPose.position,anchorPose.rotation);
    }
    target.state.heldBy={kind:'agent',id:actorId,anchor:'hold'};
    this.carry.agentHeld.set(actorId,targetId);
    this.events.emit('interaction',{action:'pickup',id:targetId,actorId,heldBy:target.state.heldBy});
    return {
      status:'held',actorId,targetId,attachment:'kinematic-anchor',graspVerified:false,
      pose,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),reach,transfer,facingYaw,anchor:{name:'hold',position:anchorPose.position},supportIds
    };
  }

  articulationTaskKey(...args) { return this.articulationRuntime.key(...args); }

  finishArticulationTask(...args) { return this.articulationRuntime.finish(...args); }

  promoteArticulationCompletion(...args) { return this.articulationRuntime.promoteCompletion(...args); }

  finalizeArticulationAttempt(...args) { return this.articulationRuntime.finalizeAttempt(...args); }

  articulationStatus(...args) { return this.articulationRuntime.status(...args); }

  waitForArticulationCompletion(...args) { return this.articulationRuntime.wait(...args); }

  articulationFailureAttribution(...args) { return this.articulationRuntime.failureAttribution(...args); }

  updateArticulationTasks(...args) { return this.articulationRuntime.update(...args); }

  transferHeldToRelease(...args) { return this.carry.transferHeldToRelease(...args); }

  syncSettleRuntime() {
    this.settleRuntime.physics = this.physics;
    this.settleRuntime.spatial = this.spatial;
    this.settleRuntime.carry = { heldByAgent:(...args)=>this.heldByAgent(...args) };
    this.settleRuntime.articulation = { actionSweepBounds:(...args)=>this.actionSweepBounds(...args) };
  }

  waitForObjectSettle(...args) { this.syncSettleRuntime(); return this.settleRuntime.wait(...args); }

  waitForPlacementSettle(...args) { this.syncSettleRuntime(); return this.settleRuntime.waitForPlacement(...args); }

  waitForRecoveryCleanupSettle(...args) { this.syncSettleRuntime(); return this.settleRuntime.waitForRecoveryCleanup(...args); }

  placementSettleResult(...args) { this.syncSettleRuntime(); return this.settleRuntime.placementResult(...args); }

  dropSettleResult(...args) { this.syncSettleRuntime(); return this.settleRuntime.dropResult(...args); }

  recoveryCleanupSettleResult(...args) { this.syncSettleRuntime(); return this.settleRuntime.recoveryCleanupResult(...args); }

  finishPlacementSettle(...args) { return this.settleRuntime.finish(...args); }

  updatePlacementSettles(...args) { this.syncSettleRuntime(); return this.settleRuntime.update(...args); }

  async approachAndPlace(actorId, targetId, { surfaceId = null, speed, clearance = 0.03 } = {}) {
    const heldId = this.heldByAgent(actorId);
    if (!heldId) return {
      status:'place-blocked', reason:'NOT_HOLDING_OBJECT', actorId,targetId,heldId:null,
      requires:'approachAndPickup', stillHeld:false
    };
    this.assertSupports(heldId, 'place');
    const target = this.store.get(targetId);
    if (!target.manifest.surfaces?.length) throw Errors.placeUnavailable(actorId, targetId, 'TARGET_HAS_NO_SURFACE');
    if (!this.locomotion) throw Errors.placeUnavailable(actorId, targetId, 'LOCOMOTION_UNAVAILABLE');

    let release = this.spatial.findFreeSpace(heldId,targetId,{surfaceId,clearance,ignore:[actorId]});
    if (!release) throw Errors.placeUnavailable(actorId,targetId,'NO_FREE_SURFACE_SPACE',{heldId,surfaceId});
    const anchor = this.holdAnchor(actorId);
    const releasePoint = release.toArray();
    const canReachRelease = (position) => {
      const dx=releasePoint[0]-position[0], dz=releasePoint[2]-position[2];
      const yaw=Math.hypot(dx,dz) < 1e-8 ? 0 : Math.atan2(-dx,-dz);
      const predicted=this.holdPoseAt(position,yaw,anchor);
      return new THREE.Vector3(...predicted.position).distanceTo(release) <= DEFAULT_INTERACTION_DISTANCE - INTERACTION_APPROACH_MARGIN;
    };
    const pose = await this.findInteractionPose(actorId,targetId,{
      ignoreIds:[heldId],standOff:this.carryStandOff(actorId,heldId),candidateFilter:canReachRelease,
      aimPoint:releasePoint,allowClearEndpoint:true
    });
    if (!pose) throw Errors.placeUnavailable(actorId,targetId,'NO_INTERACTION_POSE',{heldId});

    const locomotion = await this.navigateToPose(actorId,pose,{speed});
    if (locomotion && locomotion.status !== 'arrived') return { status:'place-blocked', reason:'APPROACH_FAILED', actorId,targetId,heldId,pose,locomotion,stillHeld:true };
    const arrivalCorrection=await this.correctToPose(actorId,pose,{speed});
    if (arrivalCorrection && arrivalCorrection.status!=='arrived') return {
      status:'place-blocked',reason:'APPROACH_CORRECTION_FAILED',actorId,targetId,heldId,
      pose,locomotion,arrivalCorrection,stillHeld:true
    };

    release = this.spatial.findFreeSpace(heldId,targetId,{surfaceId,clearance,ignore:[actorId]});
    if (!release) return { status:'place-blocked', reason:'NO_FREE_SURFACE_SPACE_AFTER_APPROACH', actorId,targetId,heldId,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),stillHeld:true };
    const reach = this.interactionStatus(actorId,targetId,{ignoreIds:[heldId],aimPoint:release.toArray(),allowClearEndpoint:true});
    if (!reach.interactable) return { status:'place-blocked', reason:reach.inRange ? 'LINE_OF_SIGHT_BLOCKED' : 'OUT_OF_RANGE', actorId,targetId,heldId,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),reach,stillHeld:true };
    const reorientation = this.reorientHeldToward(actorId,heldId,release.toArray());
    if (!reorientation.clear) return { status:'place-blocked', reason:'CARRY_REORIENT_BLOCKED', actorId,targetId,heldId,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),reach,reorientation,stillHeld:true };
    const originalPosition=this.physics.getPosition(heldId);
    const releaseDistance=originalPosition ? new THREE.Vector3(...originalPosition).distanceTo(release) : Infinity;
    if (releaseDistance>DEFAULT_INTERACTION_DISTANCE) return {
      status:'place-blocked',reason:'RELEASE_OUT_OF_RANGE',actorId,targetId,heldId,
      pose,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),reach,reorientation,
      heldPosition:originalPosition?[...originalPosition]:null,release:release.toArray(),releaseDistance:Number(releaseDistance.toFixed(3)),stillHeld:true
    };
    const moved=this.transferHeldToRelease(actorId,heldId,release);
    if (!moved.clear) return {status:'place-blocked',reason:moved.reason==='HELD_BODY_UNAVAILABLE'?'HELD_BODY_UNAVAILABLE':'PLACE_TRANSFER_BLOCKED',actorId,targetId,heldId,transfer:moved.transfer,stillHeld:true};
    const transfer=moved.transfer;

    const selectedSurface = this.spatial.getSupportSurface(targetId,surfaceId)?.id || surfaceId;
    this.releaseHeld(heldId,'PLACE_RELEASE');
    const settled = await this.waitForPlacementSettle(heldId,targetId,selectedSurface);
    this.notifyObjectTransform(heldId, 'interaction.place');
    return {
      ...settled, actorId,targetId,heldId,pose,locomotion,...(arrivalCorrection?{arrivalCorrection}:{}),reach,reorientation,
      release:release.toArray().map((value)=>Number(value.toFixed(4))),
      transfer:transfer.map(({point,clear,code,blockedBy,toi})=>({point,clear,...(code?{code}:{}),...(blockedBy?{blockedBy}:{}),...(Number.isFinite(toi)?{toi}: {})})),
      stillHeld:false
    };
  }

  cleanupReleaseCandidates(...args) { this.syncRecoveryRuntime(); return this.recovery.cleanupReleaseCandidates(...args); }

  async findRecoveryCleanupPlan(...args) { this.syncRecoveryRuntime(); return this.recovery.findCleanupPlan(...args); }

  async cleanupRecoveryBlocker(actorId,targetId,{partName=null,action=null,blockerId=null,speed}={}) {
    let plan=await this.findRecoveryCleanupPlan(actorId,targetId,{partName,action,blockerId});
    if (plan.status!=='cleanup-proposed') return plan;
    let locomotion=null;
    if (plan.pose.status!=='current-pose') {
      locomotion=await this.locomotion.navigate(actorId,plan.pose.position,{speed});
      if (locomotion.status!=='arrived') return {status:'recovery-cleanup-blocked',reason:'APPROACH_FAILED',actorId,targetId,blockerId:plan.blockerId,plan,locomotion,stillHeld:true};
    }
    plan=await this.findRecoveryCleanupPlan(actorId,targetId,{partName:plan.partName,action:plan.action,blockerId:plan.blockerId});
    if (plan.status!=='cleanup-proposed' || plan.pose.status!=='current-pose') return {status:'recovery-cleanup-blocked',reason:'CLEANUP_PLAN_CHANGED',actorId,targetId,blockerId:blockerId || this.heldByAgent(actorId),plan,locomotion,stillHeld:true};
    const release=new THREE.Vector3(...plan.release);
    const reorientation=this.reorientHeldToward(actorId,plan.blockerId,plan.release);
    if (!reorientation.clear) return {status:'recovery-cleanup-blocked',reason:'CARRY_REORIENT_BLOCKED',actorId,targetId,blockerId:plan.blockerId,plan,locomotion,reorientation,stillHeld:true};
    const heldPosition=this.physics.getPosition(plan.blockerId);
    const releaseDistance=heldPosition ? new THREE.Vector3(...heldPosition).distanceTo(release) : Infinity;
    if (releaseDistance>DEFAULT_INTERACTION_DISTANCE) return {status:'recovery-cleanup-blocked',reason:'RELEASE_OUT_OF_RANGE',actorId,targetId,blockerId:plan.blockerId,plan,locomotion,reorientation,releaseDistance:Number(releaseDistance.toFixed(3)),stillHeld:true};
    const moved=this.transferHeldToRelease(actorId,plan.blockerId,release);
    if (!moved.clear) return {status:'recovery-cleanup-blocked',reason:moved.reason==='HELD_BODY_UNAVAILABLE'?'HELD_BODY_UNAVAILABLE':'CLEANUP_TRANSFER_BLOCKED',actorId,targetId,blockerId:plan.blockerId,plan,locomotion,reorientation,transfer:moved.transfer,stillHeld:true};
    const provenance=this.recoveryHeldStatus(actorId);
    this.releaseHeld(plan.blockerId,'RECOVERY_CLEANUP_RELEASE');
    const settled=await this.waitForRecoveryCleanupSettle(actorId,plan.blockerId,targetId,plan.partName,plan.action);
    return {
      ...settled,actorId,targetId,blockerId:plan.blockerId,plan,locomotion,reorientation,
      recovery:provenance,release:[...plan.release],
      transfer:moved.transfer.map(({point,clear,code,blockedBy,toi})=>({point,clear,...(code?{code}:{}),...(blockedBy?{blockedBy}:{}),...(Number.isFinite(toi)?{toi}:{})})),
      stillHeld:false
    };
  }

  async dropHeld(actorId, { timeout=4, stableDuration=.35 } = {}) {
    const id = this.heldByAgent(actorId);
    if (!id) return { status:'empty', actorId };
    this.assertSupports(id, 'drop');
    this.releaseHeld(id,'AGENT_DROP_RELEASE');
    return this.waitForObjectSettle(id,{kind:'drop',actorId,timeout,stableDuration});
  }

  carryStatus(...args) { return this.carry.carryStatus(...args); }

  findPartForAction(...args) { return this.articulationRuntime.findPartForAction(...args); }

  setArticulationAction(...args) { return this.articulationRuntime.execute(...args); }

  update(dt) {
    this.updatePlacementSettles(dt);
    this.updateArticulationTasks(dt);
    this.carry.update();
  }
}
