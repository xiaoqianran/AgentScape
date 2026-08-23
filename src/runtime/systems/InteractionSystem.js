import * as THREE from 'three';
import { Errors } from '../../core/errors.js';

export const DEFAULT_INTERACTION_DISTANCE = 1.5;

export class InteractionSystem {
  constructor({ store, physics, spatial, navigation = null, locomotion = null, events }) {
    this.store = store;
    this.physics = physics;
    this.spatial = spatial;
    this.navigation = navigation;
    this.locomotion = locomotion;
    this.events = events;
    this.heldId = null;
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
    this.assertSupports(id, 'pickup');
    if (this.heldId && this.heldId !== id) this.drop(this.heldId);
    this.heldId = id;
    this.physics.setHeld(id, true);
    this.events.emit('interaction', { action: 'pickup', id });
  }

  drop(id = this.heldId) {
    if (!id) return;
    this.assertSupports(id, 'drop');
    this.physics.setHeld(id, false);
    if (this.heldId === id) this.heldId = null;
    this.events.emit('interaction', { action: 'drop', id });
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

    const parentName = part.parent || '$root';
    const parentFrame = parentName === '$root' ? record.object : record.object.getObjectByName(record.manifest.parts?.[parentName]?.node);
    if (!parentFrame) return { checked:false, reason:'PARENT_FRAME_UNAVAILABLE', partName:name };
    record.object.updateWorldMatrix(true, true);
    const parentWorldRotation = new THREE.Quaternion();
    const nodeParentWorldRotation = new THREE.Quaternion();
    parentFrame.getWorldQuaternion(parentWorldRotation);
    node.parent.getWorldQuaternion(nodeParentWorldRotation);
    const axis = new THREE.Vector3(...part.joint.axis).normalize().applyQuaternion(parentWorldRotation).applyQuaternion(nodeParentWorldRotation.invert()).normalize();
    if (!Number.isFinite(axis.lengthSq()) || axis.lengthSq() < .99) return { checked:false, reason:'JOINT_AXIS_INVALID', partName:name };

    const restPosition = new THREE.Vector3(...rest.position);
    const restRotation = new THREE.Quaternion(...rest.rotation);
    const restInverse = restRotation.clone().invert();
    let currentCoordinate;
    if (part.joint.type === 'prismatic') {
      currentCoordinate = node.position.clone().sub(restPosition).dot(axis);
    } else {
      const delta = node.quaternion.clone().multiply(restInverse).normalize();
      const angle = 2 * Math.atan2(delta.x * axis.x + delta.y * axis.y + delta.z * axis.z, delta.w);
      currentCoordinate = Math.atan2(Math.sin(angle), Math.cos(angle));
    }
    const target = part.targets[action];
    if (!Number.isFinite(currentCoordinate) || !Number.isFinite(target)) return { checked:false, reason:'JOINT_COORDINATE_INVALID', partName:name };

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

  interactionStatusAt(actorId, targetId, position, { maxDistance = DEFAULT_INTERACTION_DISTANCE } = {}) {
    const metrics = this.actorMetrics(actorId);
    const bounds = this.spatial.getBounds(targetId);
    const dx = Math.max(bounds.min[0] - position[0], 0, position[0] - bounds.max[0]);
    const dz = Math.max(bounds.min[2] - position[2], 0, position[2] - bounds.max[2]);
    const distance = Math.hypot(dx, dz);
    const eye = [position[0], position[1] + metrics.eyeHeight, position[2]];
    const aim = [...bounds.center];
    const hit = this.physics.raycast(eye, aim, { excludeId:actorId });
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

  async findInteractionPose(actorId, targetId, { maxDistance = DEFAULT_INTERACTION_DISTANCE, clearance = 0.12, action = null, partName = null } = {}) {
    if (!this.navigation) throw Errors.interactionUnavailable(actorId, targetId, 'NAVIGATION_UNAVAILABLE');
    const current = this.physics.getPosition(actorId);
    if (!current) throw Errors.interactionUnavailable(actorId, targetId, 'ACTOR_PHYSICS_UNAVAILABLE');
    const sweep = action ? this.actionSweepBounds(targetId, action, partName) : null;
    if (action && !sweep.checked) throw Errors.interactionUnavailable(actorId, targetId, 'ACTION_SWEEP_UNAVAILABLE', { sweep:{ checked:false, reason:sweep.reason, partName:sweep.partName } });
    const clearOfSweep = (position) => !sweep || !sweep.box.intersectsBox(this.actorBoxAt(actorId, position));
    const now = this.interactionStatusAt(actorId, targetId, current, { maxDistance });
    if (now.interactable && clearOfSweep(current)) return { status:'current-pose', position:[...current], routeCost:0, distance:now.distance, lineOfSight:now.lineOfSight, ...(sweep ? { actionSweep:{checked:true,clear:true,partName:sweep.partName} } : {}) };

    const metrics = this.actorMetrics(actorId);
    const bounds = this.spatial.getBounds(targetId);
    const offset = metrics.radius + clearance;
    const [cx,,cz] = bounds.center;
    const y = bounds.min[1];
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
      const status = this.interactionStatusAt(actorId, targetId, position, { maxDistance });
      if (!status.interactable || !clearOfSweep(position)) continue;
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
      if (locomotion.status !== 'arrived') throw Errors.interactionUnavailable(actorId, targetId, 'APPROACH_FAILED', { locomotion });
    }

    const reach = this.interactionStatus(actorId, targetId, { maxDistance });
    if (!reach.interactable) {
      const reason = reach.inRange ? 'LINE_OF_SIGHT_BLOCKED' : 'OUT_OF_RANGE';
      throw Errors.interactionUnavailable(actorId, targetId, reason, { reach });
    }
    const finalSweep = this.actionSweepBounds(targetId, action, partName);
    const actualPosition = this.physics.getPosition(actorId);
    if (!finalSweep.checked) throw Errors.interactionUnavailable(actorId, targetId, 'ACTION_SWEEP_UNAVAILABLE', { sweep:{ checked:false, reason:finalSweep.reason, partName:finalSweep.partName } });
    if (!actualPosition || finalSweep.box.intersectsBox(this.actorBoxAt(actorId, actualPosition))) {
      throw Errors.interactionUnavailable(actorId, targetId, 'AGENT_BLOCKS_ACTION_SWEEP', { sweep:{ checked:true, partName:finalSweep.partName } });
    }
    const center = this.spatial.getBounds(targetId).center;
    const actor = this.physics.getPosition(actorId);
    if (actor) this.physics.faceCharacter(actorId, [center[0] - actor[0], 0, center[2] - actor[2]]);
    const interaction = this.setArticulationAction(targetId, action, { partName });
    return { status:'interaction-requested', actorId, targetId, action, pose, locomotion, reach, actionSweep:{checked:true,clear:true,partName:finalSweep.partName}, interaction };
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
    record.state.parts ||= {};
    record.state.parts[name] = action;
    this.events.emit('interaction', { action, id, part: name, target: part.targets[action] });
    return { id, part: name, action, target: part.targets[action], requested:true };
  }

  update(_dt, camera) {
    if (!this.heldId) return;
    const target = new THREE.Vector3(0, 0, -1.6).applyQuaternion(camera.quaternion).add(camera.position);
    this.physics.setHeldTarget(this.heldId, target);
  }
}
