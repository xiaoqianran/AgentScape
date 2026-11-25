import * as THREE from 'three';
import { Errors } from '../../errors.js';

export const DEFAULT_INTERACTION_DISTANCE = 1.5;
export const INTERACTION_APPROACH_MARGIN = 0.18;
export const ACTION_INTERACTION_CORRECTION_TOLERANCE = 0.05;

export class InteractionApproach {
  constructor({ store, physics, spatial, navigation = null, locomotion = null, actionSweepBounds, targetBounds, targetAimPoints }) {
    this.store = store;
    this.physics = physics;
    this.spatial = spatial;
    this.navigation = navigation;
    this.locomotion = locomotion;
    this.resolveActionSweep = actionSweepBounds;
    this.targetBounds=targetBounds||((id)=>this.spatial.getBounds(id));
    this.targetAimPoints=targetAimPoints||(()=>null);
  }

  setNavigation(navigation) { this.navigation = navigation; }
  setLocomotion(locomotion) { this.locomotion = locomotion; }

  actionSweepBounds(...args) {
    return this.resolveActionSweep?.(...args) || { checked:false, reason:'ACTION_SWEEP_UNAVAILABLE' };
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

  interactionStatusAt(actorId, targetId, position, { maxDistance = DEFAULT_INTERACTION_DISTANCE, ignoreIds = [], aimPoint = null, aimPart = null, allowClearEndpoint = false } = {}) {
    const metrics = this.actorMetrics(actorId);
    const bounds = this.targetBounds(targetId);
    const dx = Math.max(bounds.min[0] - position[0], 0, position[0] - bounds.max[0]);
    const dz = Math.max(bounds.min[2] - position[2], 0, position[2] - bounds.max[2]);
    let distance = Math.hypot(dx, dz);
    const eye = [position[0], position[1] + metrics.eyeHeight, position[2]];
    // A compound body's center may be empty; use actual collider hit points.
    const nativePoints=this.targetAimPoints(targetId);
    const candidates=aimPoint?[aimPoint]:nativePoints?.length?nativePoints:[bounds.center];
    const ranked=[...candidates].sort((a,b)=>Math.hypot(...a.map((n,i)=>n-eye[i]))-Math.hypot(...b.map((n,i)=>n-eye[i])));
    let aim=[...ranked[0]],hit=null,visible=false;
    for(const point of ranked){
      aim=[...point];hit=this.physics.raycast(eye,aim,{excludeId:actorId,excludeIds:ignoreIds});
      visible=(hit?.id===targetId&&(!aimPart||hit.part===aimPart))||(allowClearEndpoint&&!hit);
      if(visible)break;
    }
    if(nativePoints&&visible&&hit?.point)
      distance=Math.hypot(hit.point[0]-position[0],hit.point[2]-position[2]);
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

  async findInteractionPose(actorId, targetId, { maxDistance = DEFAULT_INTERACTION_DISTANCE, clearance = 0.12, action = null, partName = null, ignoreIds = [], standOff = 0, stanceBounds = null, candidateFilter = null, aimPoint = null, aimPart = null, allowClearEndpoint = false } = {}) {
    if (!this.navigation) throw Errors.interactionUnavailable(actorId, targetId, 'NAVIGATION_UNAVAILABLE');
    const current = this.physics.getPosition(actorId);
    if (!current) throw Errors.interactionUnavailable(actorId, targetId, 'ACTOR_PHYSICS_UNAVAILABLE');
    const sweep = action ? this.actionSweepBounds(targetId, action, partName) : null;
    if (action && !sweep.checked) throw Errors.interactionUnavailable(actorId, targetId, 'ACTION_SWEEP_UNAVAILABLE', { sweep:{ checked:false, reason:sweep.reason, partName:sweep.partName } });
    const clearOfSweep = (position) => !sweep || !sweep.box.intersectsBox(this.actorBoxAt(actorId, position));
    const now = this.interactionStatusAt(actorId, targetId, current, { maxDistance, ignoreIds, aimPoint, aimPart, allowClearEndpoint });
    if (now.interactable && clearOfSweep(current) && (!candidateFilter || candidateFilter(current))) return { status:'current-pose', position:[...current], routeCost:0, distance:now.distance, lineOfSight:now.lineOfSight, ...(sweep ? { actionSweep:{checked:true,clear:true,partName:sweep.partName} } : {}) };

    const metrics = this.actorMetrics(actorId);
    const bounds = stanceBounds || this.targetBounds(targetId);
    const offset = Math.max(metrics.radius,standOff) + clearance;
    const [cx,,cz] = bounds.center;
    // The target may be on another connected floor. Prefer the current
    // elevation, then try bounded target-derived heights if no pose is found.
    const candidatesAt = y => [
      [bounds.min[0] - offset, y, cz], [bounds.max[0] + offset, y, cz],
      [cx, y, bounds.min[2] - offset], [cx, y, bounds.max[2] + offset],
      [bounds.min[0] - offset, y, bounds.min[2] - offset],
      [bounds.max[0] + offset, y, bounds.min[2] - offset],
      [bounds.min[0] - offset, y, bounds.max[2] + offset],
      [bounds.max[0] + offset, y, bounds.max[2] + offset]
    ];

    const valid = [];
    const heights=[current[1],bounds.min[1],bounds.min[1]-Math.min(.9,metrics.eyeHeight*.6)]
      .filter((height,i,all)=>Number.isFinite(height)&&all.slice(0,i).every(previous=>Math.abs(height-previous)>.1));
    for (const height of heights) {
      for (const candidate of candidatesAt(height)) {
        const route = await this.navigation.findPath(current, candidate);
        if (!route.reachable || !route.end?.snapped) continue;
        const position = route.end.snapped;
        const status = this.interactionStatusAt(actorId, targetId, position, { maxDistance, ignoreIds, aimPoint, aimPart, allowClearEndpoint });
        if (!status.interactable || !clearOfSweep(position) || (candidateFilter && !candidateFilter(position))) continue;
        valid.push({ status:'approach-pose', position, routeCost:route.cost, distance:status.distance, waypointCount:route.path.length, lineOfSight:status.lineOfSight, ...(sweep ? { actionSweep:{checked:true,clear:true,partName:sweep.partName} } : {}) });
      }
      if(valid.length)break;
    }
    valid.sort((a, b) => (a.routeCost ?? Infinity) - (b.routeCost ?? Infinity));
    return valid[0] || null;
  }

  async navigateToPose(actorId, pose, { speed } = {}) {
    if (pose.status === 'current-pose') return null;
    return this.locomotion.navigate(actorId, pose.position, { speed });
  }

  async correctToPose(actorId, pose, { speed, force = false } = {}) {
    if (pose.status === 'current-pose') return null;
    const actual = this.physics.getPosition(actorId);
    const remaining = actual ? Math.hypot(actual[0]-pose.position[0], actual[2]-pose.position[2]) : Infinity;
    if (!force && remaining <= ACTION_INTERACTION_CORRECTION_TOLERANCE) return null;
    return this.locomotion.navigate(actorId, pose.position, { speed, waypointTolerance:ACTION_INTERACTION_CORRECTION_TOLERANCE });
  }
}
