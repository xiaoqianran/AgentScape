import * as THREE from 'three';
import { Errors } from '../../errors.js';

export class CarryRuntime {
  constructor({ store, physics, spatial, events, assertSupports }) {
    this.store = store;
    this.physics = physics;
    this.spatial = spatial;
    this.events = events;
    this.assertSupports = assertSupports;
    this.humanHeldId = null;
    this.agentHeld = new Map();
    this.humanViewPosition = new THREE.Vector3();
    this.humanViewRotation = new THREE.Quaternion();
    this.humanViewValid = false;
    this.humanHeldTarget = new THREE.Vector3();
  }

  setHumanViewPose(viewPose = null) {
    if (viewPose?.position?.length === 3 && viewPose?.rotation?.length === 4) {
      this.humanViewPosition.fromArray(viewPose.position);
      this.humanViewRotation.fromArray(viewPose.rotation).normalize();
      this.humanViewValid = true;
      return true;
    }
    this.humanViewValid = false;
    return false;
  }

  isHeld(id) { return Boolean(this.store.has(id) && this.store.get(id).state?.heldBy); }

  heldByAgent(actorId) { return this.agentHeld.get(actorId) || null; }

  holdAnchor(actorId) {
    const record = this.store.get(actorId);
    if (record.manifest.type !== 'agent') throw Errors.carryUnavailable(actorId, actorId, 'ACTOR_NOT_AGENT');
    const anchor = record.manifest.embodiment?.holdAnchor;
    if (!anchor?.translation) throw Errors.carryUnavailable(actorId, actorId, 'HOLD_ANCHOR_UNAVAILABLE');
    return anchor;
  }

  carryStandOff(actorId, heldId, anchor = this.holdAnchor(actorId)) {
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
      const check = this.physics.checkBodyMotion(heldId,pose.position,pose.rotation,{excludeIds:[actorId]});
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

  releaseHeld(id, reason = null, {silent=false} = {}) {
    if (!this.store.has(id)) return { released:false, heldBy:null };
    const record = this.store.get(id);
    const heldBy = record.state?.heldBy;
    if (!heldBy) return { released:false, heldBy:null };
    if (heldBy.kind === 'human' && this.humanHeldId === id) this.humanHeldId = null;
    if (heldBy.kind === 'agent' && this.agentHeld.get(heldBy.id) === id) this.agentHeld.delete(heldBy.id);
    delete record.state.heldBy;
    this.physics.setHeld(id, false);
    if(!silent) this.events.emit('interaction', { action:'drop', id, heldBy, ...(reason ? {reason} : {}) });
    return { released:true, heldBy };
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

  transferPickupToAnchor(actorId,targetId,anchorPose,supportIds = []) {
    const originalPosition=this.physics.getPosition(targetId);
    const originalRotation=this.physics.getRotation(targetId);
    if (!originalPosition || !originalRotation) return {clear:false,reason:'CARRY_BODY_UNAVAILABLE',phases:[]};
    const size=this.spatial.getBounds(targetId).size;
    const liftY=originalPosition[1]+Math.max(.12,Math.min(.28,(size[1] || .32)*.55));
    const phases=[];
    const rollback=(reason)=>{
      this.physics.setHeldPose(targetId,originalPosition,originalRotation);
      this.physics.setHeld(targetId,false);
      return {clear:false,reason,phases,originalPosition:[...originalPosition]};
    };

    this.physics.setHeld(targetId,true);
    const lift=[originalPosition[0],liftY,originalPosition[2]];
    const liftSweep=this.physics.checkBodyMotion(targetId,lift,originalRotation,{excludeIds:[actorId,...supportIds]});
    const liftPose=liftSweep.clear ? this.physics.checkBodyPose(targetId,lift,originalRotation,{excludeIds:[actorId]}) : liftSweep;
    phases.push({phase:'lift',point:[...lift],clear:Boolean(liftSweep.clear && liftPose.clear),sweep:liftSweep,pose:liftPose});
    if (!liftSweep.clear || !liftPose.clear) return rollback('PICKUP_LIFT_BLOCKED');
    this.physics.setHeldPose(targetId,lift,originalRotation);

    const horizontal=[anchorPose.position[0],liftY,anchorPose.position[2]];
    const horizontalCheck=this.physics.checkBodyMotion(targetId,horizontal,anchorPose.rotation,{excludeIds:[actorId]});
    phases.push({phase:'horizontal',point:[...horizontal],...horizontalCheck});
    if (!horizontalCheck.clear) return rollback('PICKUP_HORIZONTAL_BLOCKED');
    this.physics.setHeldPose(targetId,horizontal,anchorPose.rotation);

    const anchorCheck=this.physics.checkBodyMotion(targetId,anchorPose.position,anchorPose.rotation,{excludeIds:[actorId]});
    phases.push({phase:'anchor',point:[...anchorPose.position],...anchorCheck});
    if (!anchorCheck.clear) return rollback('PICKUP_ANCHOR_BLOCKED');
    this.physics.setHeldPose(targetId,anchorPose.position,anchorPose.rotation);
    return {clear:true,mode:'lift-horizontal-anchor',supportIds:[...supportIds],phases};
  }

  transferHeldToRelease(actorId, heldId, release) {
    const originalPosition=this.physics.getPosition(heldId);
    const rotation=this.physics.getRotation(heldId);
    if (!originalPosition || !rotation) return {clear:false,reason:'HELD_BODY_UNAVAILABLE',transfer:[]};
    const point=Array.isArray(release) ? release : release.toArray();
    const size=this.spatial.getBounds(heldId).size;
    const liftY=Math.max(originalPosition[1],point[1]+size[1]+.08);
    const transferPoints=[
      [originalPosition[0],liftY,originalPosition[2]],
      [point[0],liftY,point[2]],
      [...point]
    ];
    const transfer=[];
    for (const target of transferPoints) {
      const check=this.physics.checkBodyMotion(heldId,target,rotation,{excludeIds:[actorId]});
      transfer.push({point:[...target],...check});
      if (!check.clear) {
        this.physics.setHeldPose(heldId,originalPosition,rotation);
        return {clear:false,reason:'TRANSFER_BLOCKED',originalPosition,rotation,transfer};
      }
      this.physics.setHeldPose(heldId,target,rotation);
    }
    return {clear:true,originalPosition,rotation,transfer,release:[...point]};
  }

  carryStatus(actorId) {
    const id = this.heldByAgent(actorId);
    if (!id) return { status:'empty', actorId };
    const record = this.store.get(id);
    return { status:'held', actorId, targetId:id, heldBy:structuredClone(record.state.heldBy), position:this.physics.getPosition(id), attachment:'kinematic-anchor', graspVerified:false };
  }

  update() {
    if (this.humanHeldId && this.humanViewValid) {
      this.humanHeldTarget.set(0,0,-1.6).applyQuaternion(this.humanViewRotation).add(this.humanViewPosition);
      this.physics.setHeldTarget(this.humanHeldId, this.humanHeldTarget);
    }
    for (const [actorId, targetId] of this.agentHeld) {
      if (!this.store.has(actorId) || !this.store.has(targetId)) continue;
      const pose = this.physics.anchorPose(actorId, this.holdAnchor(actorId));
      if (pose) this.physics.setHeldTarget(targetId, pose.position, pose.rotation);
    }
  }
}
