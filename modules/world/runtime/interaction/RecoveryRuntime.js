import * as THREE from 'three';

export class RecoveryRuntime {
  constructor({ store, physics, spatial, navigation = null, locomotion = null, approach, carry, articulation, interactionDistance = 1.5, waypointTolerance = .18 }) {
    this.store = store;
    this.physics = physics;
    this.spatial = spatial;
    this.navigation = navigation;
    this.locomotion = locomotion;
    this.approach = approach;
    this.carry = carry;
    this.articulation = articulation;
    this.interactionDistance = interactionDistance;
    this.waypointTolerance = waypointTolerance;
    this.held = new Map();
  }

  markHeld(actorId, { blockerId, targetId, partName, action }) {
    if (this.carry.heldByAgent(actorId)!==blockerId) return false;
    this.held.set(actorId,{blockerId,targetId,partName:partName || null,action:action || null});
    return true;
  }

  status(actorId) {
    const value=this.held.get(actorId);
    return value ? structuredClone(value) : null;
  }

  clear(actorId) { return this.held.delete(actorId); }
  clearAll() { this.held.clear(); }

  clearRelated(id) {
    for (const [actorId,recovery] of [...this.held]) {
      if (actorId===id || recovery.blockerId===id || recovery.targetId===id) this.held.delete(actorId);
    }
  }

  cleanupReleaseCandidates(actorId,targetId,partName,action,heldId,{clearance=.05,sweepMargin=.35}={}) {
    const sweep=this.articulation.actionSweepBounds(targetId,action,partName);
    if (!sweep.checked) return {sweep,candidates:[]};
    const bounds=this.spatial.getBounds(heldId);
    const bodyPosition=this.physics.getPosition(heldId);
    if (!bodyPosition) return {sweep,candidates:[]};
    const halfX=bounds.size[0]/2,halfZ=bounds.size[2]/2;
    const centerOffset=[bounds.center[0]-bodyPosition[0],bounds.center[1]-bodyPosition[1],bounds.center[2]-bodyPosition[2]];
    const rootToBottom=bodyPosition[1]-bounds.min[1];
    const center=sweep.box.getCenter(new THREE.Vector3());
    const left=sweep.box.min.x-sweepMargin-halfX,right=sweep.box.max.x+sweepMargin+halfX;
    const back=sweep.box.min.z-sweepMargin-halfZ,front=sweep.box.max.z+sweepMargin+halfZ;
    const centers=[
      [left,center.z],[right,center.z],[center.x,back],[center.x,front],
      [left,back],[right,back],[left,front],[right,front]
    ];
    const topY=Math.max(sweep.box.max.y,bounds.max[1])+4;
    const lowY=Math.min(sweep.box.min.y,bounds.min[1])-24;
    const sweepGuard=sweep.box.clone().expandByScalar(sweepMargin*.5);
    const candidates=[];
    for (const [cx,cz] of centers) {
      const rootX=cx-centerOffset[0], rootZ=cz-centerOffset[2];
      const hit=this.physics.raycast([rootX,topY,rootZ],[rootX,lowY,rootZ],{excludeIds:[actorId,heldId,targetId]});
      if (!hit?.environment) continue;
      const release=[rootX,hit.point[1]+rootToBottom+clearance,rootZ];
      const min=new THREE.Vector3(bounds.min[0]-bodyPosition[0]+release[0],bounds.min[1]-bodyPosition[1]+release[1],bounds.min[2]-bodyPosition[2]+release[2]);
      const max=new THREE.Vector3(bounds.max[0]-bodyPosition[0]+release[0],bounds.max[1]-bodyPosition[1]+release[1],bounds.max[2]-bodyPosition[2]+release[2]);
      const box=new THREE.Box3(min,max);
      if (sweepGuard.intersectsBox(box)) continue;
      candidates.push({release,support:{environment:true,point:[...hit.point],distance:hit.distance},box});
    }
    return {sweep,candidates};
  }

  async findCleanupPlan(actorId,targetId,{partName=null,action=null,blockerId=null,clearance=.05,sweepMargin=.35}={}) {
    const provenance=this.getProvenance ? this.getProvenance(actorId) : this.status(actorId);
    const heldId=this.carry.heldByAgent(actorId);
    if (!provenance || !heldId || provenance.blockerId!==heldId || (blockerId && blockerId!==heldId)) return {status:'cleanup-unavailable',reason:'NO_RECOVERY_HELD_BLOCKER',actorId,targetId,blockerId:blockerId || heldId || null};
    if (provenance.targetId!==targetId || (partName && provenance.partName && provenance.partName!==partName)) return {status:'cleanup-unavailable',reason:'RECOVERY_CONTEXT_MISMATCH',actorId,targetId,blockerId:heldId};
    const resolvedAction=action || provenance.action;
    const resolvedPart=partName || provenance.partName;
    if (!resolvedAction) return {status:'cleanup-unavailable',reason:'ORIGINAL_ACTION_UNAVAILABLE',actorId,targetId,blockerId:heldId};
    if (!this.navigation || !this.locomotion) return {status:'cleanup-unavailable',reason:'NAVIGATION_UNAVAILABLE',actorId,targetId,blockerId:heldId};
    const source=this.cleanupReleaseCandidates(actorId,targetId,resolvedPart,resolvedAction,heldId,{clearance,sweepMargin});
    if (!source.sweep.checked) return {status:'cleanup-unavailable',reason:'ACTION_SWEEP_UNAVAILABLE',actorId,targetId,blockerId:heldId,sweep:{checked:false,reason:source.sweep.reason,partName:source.sweep.partName}};
    const actorPosition=this.physics.getPosition(actorId);
    if (!actorPosition) return {status:'cleanup-unavailable',reason:'ACTOR_PHYSICS_UNAVAILABLE',actorId,targetId,partName:source.sweep.partName,action:resolvedAction,blockerId:heldId};
    const anchor=this.carry.holdAnchor(actorId);
    const metrics=this.approach.actorMetrics(actorId);
    const standOff=Math.max(metrics.radius+.18,this.carry.carryStandOff(actorId,heldId)+.12);
    const plans=[];
    for (const candidate of source.candidates) {
      const release=new THREE.Vector3(...candidate.release);
      const stancePositions=[[...actorPosition]];
      for (let i=0;i<8;i++) {
        const angle=i*Math.PI/4;
        stancePositions.push([release.x+Math.cos(angle)*standOff,actorPosition[1],release.z+Math.sin(angle)*standOff]);
      }
      for (let index=0;index<stancePositions.length;index++) {
        let position=stancePositions[index],routeCost=0,route=null,status='current-pose';
        if (index>0) {
          route=await this.navigation.findPath(actorPosition,position);
          if (!route.reachable || !route.end?.snapped) continue;
          position=route.end.snapped; routeCost=route.cost; status='approach-pose';
        }
        if (source.sweep.box.intersectsBox(this.approach.actorBoxAt(actorId,position))) continue;
        const dx=release.x-position[0],dz=release.z-position[2];
        const yaw=Math.hypot(dx,dz)<1e-8?0:Math.atan2(-dx,-dz);
        const predicted=this.carry.holdPoseAt(position,yaw,anchor);
        const releaseDistance=new THREE.Vector3(...predicted.position).distanceTo(release);
        if (releaseDistance>this.interactionDistance-this.waypointTolerance) continue;
        const endpointClear=this.physics.checkBodyPose(heldId,candidate.release,predicted.rotation,{excludeIds:[actorId]});
        if (!endpointClear.clear) continue;
        plans.push({
          status:'cleanup-proposed',actorId,targetId,partName:source.sweep.partName,action:resolvedAction,blockerId:heldId,
          pose:{status,position:[...position],routeCost,waypointCount:route?.path?.length || 1},
          release:candidate.release.map((value)=>Number(value.toFixed(4))),support:candidate.support,
          actionSweep:{checked:true,partName:source.sweep.partName,bounds:source.sweep.bounds},
          preflight:{sweepClear:true,endpointClear:true,releaseDistance:Number(releaseDistance.toFixed(4))}
        });
      }
    }
    plans.sort((a,b)=>(a.pose.routeCost??Infinity)-(b.pose.routeCost??Infinity) || a.preflight.releaseDistance-b.preflight.releaseDistance || a.release.join(',').localeCompare(b.release.join(',')));
    return plans[0] || {status:'cleanup-unavailable',reason:'NO_SAFE_CLEANUP_SPACE',actorId,targetId,partName:source.sweep.partName,action:resolvedAction,blockerId:heldId};
  }
}
