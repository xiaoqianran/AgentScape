import * as THREE from 'three';
import { Errors } from '../../errors.js';
import { compileInteractionContract } from '../interaction/InteractionContract.js';
import { ArticulationRuntime } from '../interaction/ArticulationRuntime.js';
import { SettleRuntime } from '../interaction/SettleRuntime.js';
import { InteractionApproach, DEFAULT_INTERACTION_DISTANCE, INTERACTION_APPROACH_MARGIN } from '../interaction/InteractionApproach.js';
import { CarryRuntime } from '../interaction/CarryRuntime.js';
import { RecoveryRuntime } from '../interaction/RecoveryRuntime.js';
import { assetAdmission } from '../../../asset/model/admission.js';

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
    this.physicalTasks = new Map();
    this.manipulationEpoch = 0;
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
        physical: [...this.physicalTasks.values()].map(task => ({ actorId:task.actorId, targetId:task.targetId, action:task.action, elapsed:task.elapsed, progress:task.progress, error:task.error })),
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
    for (const task of this.physicalTasks.values()) if (task.targetId === id || task.actorId === id) this.finishPhysicalTask(task, 'OBJECT_REMOVED');
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
    this.manipulationEpoch++;
    for (const task of this.physicalTasks.values()) this.finishPhysicalTask(task, reason);
    for (const task of [...this.settleTasks.values()]) {
      this.finishPlacementSettle(task,task.kind==='recovery-cleanup'
        ? this.recoveryCleanupSettleResult(task,null,{settled:false,reason})
        : task.kind==='drop'
          ? this.dropSettleResult(task,null,{settled:false,reason})
          : {status:'place-unverified',reason,supportVerified:false,settled:false,elapsed:Number(task.elapsed.toFixed(3))});
    }
    for (const task of [...this.articulationTasks.values()]) {
      if (task.physicalOperation) this.physics.holdArticulationCurrent(task.id, task.partName);
      this.finishArticulationTask(task,{status:'action-unverified',reason,targetReached:false,settled:false,elapsed:Number(task.elapsed.toFixed(3))});
    }
  }

  notifyObjectTransform(id, reason) { return this.onObjectTransform?.(id, reason) ?? false; }

  supports(record, action) { return record.manifest.actions.includes(action); }
  interactionContracts(record) { return compileInteractionContract(record.manifest); }

  assertSupports(id, action) {
    const record = this.store.get(id);
    if (record.manifest.source?.kind==='compiled' && this.interactionContracts(record).contracts.some(contract => contract.action === action) && assetAdmission(record.manifest).layers.runtime.status!=='ready') throw Errors.interactionUnavailable(null,id,'RUNTIME_VERIFICATION_REQUIRED');
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
    // Any declared physical part target may use the existing approach and joint verifier.
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

  manipulationCapability(targetId, action, partName = null) {
    const no = reason => ({ available:false, reason });
    if (!['push','drag','rotate','slide','rotateJoint'].includes(action)) return no('ACTION_UNSUPPORTED');
    if (!this.store.has(targetId)) return no('OBJECT_NOT_FOUND');
    if (!this.physics.hasCapability('rigid-body') || !this.physics.hasCapability('collision') || !this.physics.hasCapability('scene-query')) return no('PHYSICS_CAPABILITY_UNAVAILABLE');
    const record = this.store.get(targetId);
    if(record.manifest.source?.kind==='compiled' && assetAdmission(record.manifest).layers.runtime.status!=='ready') return no('RUNTIME_VERIFICATION_REQUIRED');
    if (this.isHeld(targetId)) return no('OBJECT_ALREADY_HELD');
    if (this.physicalTasks.has(targetId) || [...this.articulationTasks.values()].some(task => task.id === targetId)) return no('ACTION_IN_PROGRESS');
    const jointAction = ['slide','rotateJoint'].includes(action);
    const body = this.physics.manipulationBody(targetId, jointAction ? partName : undefined);
    if (!body.registered || !body.colliderCount) return no('TARGET_PHYSICS_UNAVAILABLE');
    if (body.body !== 'dynamic') return no('TARGET_NOT_DYNAMIC');
    if (action === 'rotate' && body.lockRotation.every(Boolean)) return no('ROTATION_LOCKED');
    if (['push','drag'].includes(action) && body.lockTranslation[0] && body.lockTranslation[2]) return no('TRANSLATION_LOCKED');
    if (jointAction) {
      const joint = record.manifest.parts?.[partName]?.joint;
      if (!body.joint || !this.physics.hasCapability('joints')) return no('PHYSICAL_JOINT_UNAVAILABLE');
      if (joint?.type !== (action === 'slide' ? 'prismatic' : 'revolute')) return no('JOINT_TYPE_MISMATCH');
    } else if (Object.keys(record.manifest.parts || {}).length) return no('ARTICULATED_TARGET_UNSUPPORTED');
    return { available:true };
  }

  /** Contact proxy within the existing Agent reach model; no pose or velocity assignment. */
  async manipulate(actorId, targetId, action, args = {}) {
    const blocked = reason => ({ status:'physical-action-blocked', actorId, targetId, action, verified:false, physicsVerified:false, reason });
    if (!this.store.has(actorId)) return blocked('ACTOR_NOT_FOUND');
    if (this.store.get(actorId).manifest.type !== 'agent') return blocked('ACTOR_NOT_AGENT');
    if (this.heldByAgent(actorId)) return blocked('HANDS_FULL');
    const capability = this.manipulationCapability(targetId, action, args.part);
    if (!capability.available) return blocked(capability.reason);
    const epoch = this.manipulationEpoch;
    const linear = ['push','drag'].includes(action);
    const direction = linear ? new THREE.Vector3(...args.direction).normalize() : null;
    const validSide = position => {
      if (!linear) return true;
      const center = this.spatial.getBounds(targetId).center;
      const side = (center[0]-position[0])*direction.x + (center[2]-position[2])*direction.z;
      return action === 'push' ? side > .05 : side < -.05;
    };
    const jointAim = () => args.part ? this.physics.manipulationBody(targetId,args.part,{contacts:true}).contactCandidates[0]?.center : null;
    const pose = await this.findInteractionPose(actorId, targetId, { candidateFilter:validSide, aimPoint:jointAim() });
    if (epoch !== this.manipulationEpoch) return blocked('ACTION_CANCELLED');
    if (!pose) return blocked('NO_INTERACTION_POSE');
    const approach = await this.navigateToPose(actorId, pose, {});
    if (epoch !== this.manipulationEpoch) return blocked('ACTION_CANCELLED');
    if (approach && approach.status !== 'arrived') return blocked('APPROACH_FAILED');
    const accessReason = () => {
      if (!this.store.has(actorId) || !this.store.has(targetId)) return 'OBJECT_REMOVED';
      if (this.isHeld(targetId)) return 'OBJECT_ALREADY_HELD';
      if (this.heldByAgent(actorId)) return 'HANDS_FULL';
      if (!this.physics.getPosition(actorId)) return 'ACTOR_PHYSICS_UNAVAILABLE';
      const contacts = this.physics.articulationContacts(targetId, args.part || '$root');
      if (contacts.some(contact => contact.minDistance < -.03)) return 'COLLISION_PENETRATION';
      const reach = this.interactionStatus(actorId, targetId, {aimPoint:jointAim()});
      return !reach.interactable ? reach.inRange ? 'OCCLUDED' : 'OUT_OF_REACH' : null;
    };
    const unavailable = accessReason();
    if (unavailable) return blocked(unavailable);
    if (['slide','rotateJoint'].includes(action)) {
      const state = this.physics.getArticulationState(targetId, args.part);
      if (!state) return blocked('JOINT_STATE_UNAVAILABLE');
      const target = args.target ?? state.coordinate + (args.distance ?? args.angle);
      if (state.limits && (target < state.limits[0] || target > state.limits[1])) return blocked('JOINT_LIMIT_EXCEEDED');
      // Only real solver joints were admitted above; transform-pose fallback is forbidden.
      if (!this.physics.setArticulationTarget(targetId, args.part, target)) return blocked('JOINT_MOTOR_UNAVAILABLE');
      // Old semantic labels must not survive an arbitrary numeric joint command.
      const record = this.store.get(targetId);
      if (record.state.parts) delete record.state.parts[args.part];
      if (record.state.partTargets) delete record.state.partTargets[args.part];
      const pending = this.waitForArticulationCompletion(targetId, args.part, action, target, { timeout:8 });
      const task = this.articulationTasks.get(`${targetId}:${args.part}`);
      if (task) { task.guard = accessReason; task.physicalOperation = true; }
      const completion = await pending;
      if (completion.status !== 'action-completed') this.physics.holdArticulationCurrent(targetId, args.part);
      const verified = completion.status === 'action-completed' && completion.targetReached && completion.settled;
      return { ...completion, actorId, targetId, action, verified, physicsVerified:verified, evidenceKind:'joint-motor', initialCoordinate:state.coordinate,
        contactEvidence:this.physics.articulationContacts(targetId,args.part) };
    }
    if (linear && !validSide(this.physics.getPosition(actorId))) return blocked('CONTACT_DIRECTION_UNREACHABLE');
    return new Promise(resolve => {
      const record = this.store.get(targetId);
      const task = { actorId, targetId, action, args, direction, accessReason, resolve,
        initialPosition:new THREE.Vector3(...this.physics.getPosition(targetId)), initialRotation:record.object.quaternion.clone(),
        axis:action === 'rotate' ? new THREE.Vector3(...args.axis).normalize() : null,
        mass:this.physics.manipulationBody(targetId).mass || 1, elapsed:0, stable:0, appliedSteps:0, maxEffort:0,
        samples:[], progress:0, error:linear ? args.distance : Math.abs(args.angle) };
      const size = this.spatial.getBounds(targetId).size;
      task.inertia = task.mass*(size[0]**2+size[1]**2+size[2]**2)/18;
      task.timer = setTimeout(() => this.finishPhysicalTask(task, 'SIMULATION_NOT_ADVANCING'), 12000);
      task.timer.unref?.();
      this.physicalTasks.set(targetId, task);
    });
  }

  finishPhysicalTask(task, reason = null) {
    if (this.physicalTasks.get(task.targetId) !== task) return;
    clearTimeout(task.timer); this.physicalTasks.delete(task.targetId);
    const verified = !reason && task.appliedSteps > 0;
    const contactEvidence = this.physics.articulationContacts(task.targetId, '$root');
    const report = { status:verified ? 'physical-action-completed' : 'physical-action-unverified', reason,
      actorId:task.actorId, targetId:task.targetId, action:task.action, verified, physicsVerified:verified,
      targetReached:verified, settled:verified, evidenceKind:task.action === 'rotate' ? 'rigid-body-torque' : 'rigid-body-force',
      initialPosition:task.initialPosition.toArray(), finalPosition:this.physics.getPosition(task.targetId),
      progress:task.progress, error:task.error, elapsed:task.elapsed, appliedSteps:task.appliedSteps,
      maxEffort:task.maxEffort, contactPoint:task.contactPoint || null, contactEvidence };
    report.initialRotation = task.initialRotation.toArray();
    report.finalRotation = this.store.has(task.targetId) ? this.store.get(task.targetId).object.quaternion.toArray() : null;
    report.graspVerified = false;
    this.notifyObjectTransform(task.targetId, 'interaction.physical');
    this.events.emit('interaction', report); task.resolve(report);
  }

  updatePhysicalTasks(dt) {
    for (const task of this.physicalTasks.values()) {
      task.elapsed += dt;
      const reason = task.accessReason();
      if (reason) { this.finishPhysicalTask(task, reason); continue; }
      const position = new THREE.Vector3(...this.physics.getPosition(task.targetId));
      const motion = this.physics.getMotion(task.targetId);
      const rotate = task.action === 'rotate';
      let effort, applied, speed, deviated;
      if (rotate) {
        const rotation = this.store.get(task.targetId).object.quaternion.clone().multiply(task.initialRotation.clone().invert()).normalize();
        task.progress = 2*Math.atan2(rotation.x*task.axis.x + rotation.y*task.axis.y + rotation.z*task.axis.z, rotation.w);
        task.progress = Math.atan2(Math.sin(task.progress), Math.cos(task.progress));
        task.error = Math.atan2(Math.sin(task.args.angle-task.progress), Math.cos(task.args.angle-task.progress));
        const velocity = new THREE.Vector3(...motion.angularVelocity);
        speed = velocity.length();
        const desired = Math.abs(task.error) < .05 ? 0 : THREE.MathUtils.clamp(task.error*2, -.6, .6);
        effort = THREE.MathUtils.clamp(task.inertia*(desired-velocity.dot(task.axis))*8, -task.args.maxTorque, task.args.maxTorque);
        const expected = new THREE.Quaternion().setFromAxisAngle(task.axis, task.progress).multiply(task.initialRotation);
        deviated = position.distanceTo(task.initialPosition) > .15 || expected.angleTo(this.store.get(task.targetId).object.quaternion) > .15;
        applied = () => this.physics.applyTorque(task.targetId, task.axis.clone().multiplyScalar(effort).toArray());
      } else {
        const delta = position.clone().sub(task.initialPosition);
        task.progress = delta.dot(task.direction); task.error = task.args.distance-task.progress;
        const velocity = new THREE.Vector3(...motion.linearVelocity);
        speed = velocity.length();
        const desired = Math.abs(task.error) < .04 ? 0 : THREE.MathUtils.clamp(task.error*2, -.45, .45);
        const friction = desired === 0 ? 0 : 9.81*.8*Math.sign(desired);
        effort = THREE.MathUtils.clamp(task.mass*(10*(desired-velocity.dot(task.direction))+friction), -task.args.maxForce, task.args.maxForce);
        deviated = delta.clone().addScaledVector(task.direction, -task.progress).length() > .15;
        const sign = task.action === 'push' ? -1 : 1;
        const contacts = this.physics.manipulationBody(task.targetId, undefined, {contacts:true}).contactCandidates.map(candidate => {
          const origin = new THREE.Vector3(...candidate.center).addScaledVector(task.direction,sign*(candidate.radius+.05));
          return this.physics.raycast(origin.toArray(),candidate.center,{excludeId:task.actorId});
        }).filter(hit => hit?.id === task.targetId);
        if (!contacts.length) { this.finishPhysicalTask(task,'CONTACT_POINT_UNAVAILABLE'); continue; }
        task.contactPoint = contacts[0].point;
        applied = () => this.physics.applyForce(task.targetId, task.direction.clone().multiplyScalar(effort).toArray(), { point:task.contactPoint });
      }
      const reached = Math.abs(task.error) <= .05 && speed < .08;
      task.stable = reached ? task.stable+dt : 0;
      if (deviated) { this.finishPhysicalTask(task, 'MOTION_CONSTRAINT_VIOLATED'); continue; }
      if (this.physics.articulationContacts(task.targetId, '$root').some(contact => contact.minDistance < -.03)) { this.finishPhysicalTask(task, 'COLLISION_PENETRATION'); continue; }
      if (task.stable >= .25) { this.finishPhysicalTask(task); continue; }
      task.samples.push({ time:task.elapsed, progress:task.progress });
      while (task.samples.length > 2 && task.samples[1].time < task.elapsed-1.5) task.samples.shift();
      if (!reached && task.elapsed >= 1.6 && Math.abs(task.progress-task.samples[0].progress) < .005) { this.finishPhysicalTask(task, 'STALL'); continue; }
      if (task.elapsed >= 8) { this.finishPhysicalTask(task, 'TIMEOUT'); continue; }
      if (!applied()) { this.finishPhysicalTask(task, 'FORCE_APPLICATION_FAILED'); continue; }
      task.appliedSteps++; task.maxEffort = Math.max(task.maxEffort, Math.abs(effort));
    }
  }

  findPartForAction(...args) { return this.articulationRuntime.findPartForAction(...args); }

  setArticulationAction(...args) { return this.articulationRuntime.execute(...args); }

  update(dt) {
    this.updatePlacementSettles(dt);
    this.updateArticulationTasks(dt);
    this.carry.update();
    this.updatePhysicalTasks(dt);
  }
}
