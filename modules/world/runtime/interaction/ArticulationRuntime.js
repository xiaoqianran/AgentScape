import * as THREE from 'three';
import { Errors } from '../../errors.js';
import { getInteractionContract } from './InteractionContract.js';

export class ArticulationRuntime {
  constructor({ store, physics, events, assertSupports }) {
    this.store = store;
    this.physics = physics;
    this.events = events;
    this.assertSupports = assertSupports;
    this.tasks = new Map();
    this.results = new Map();
  }

  key(id, partName) { return `${id}:${partName}`; }

  findPartForAction(record, action, partName = null) {
    const parts = Object.entries(record.manifest.parts || {}).filter(([name, part]) =>
      (!partName || name === partName) && part.actions?.includes(action) && Number.isFinite(part.targets?.[action])
    );
    if (parts.length !== 1) throw Errors.actionUnsupported(record.id, partName ? `${action}:${partName}` : action);
    return parts[0];
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
    const live = this.physics.getArticulationState(targetId,name,{target});
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
    return { checked:true, partName:name, action, currentCoordinate, target, bounds:{ min:swept.min.toArray(), max:swept.max.toArray() }, box:swept };
  }

  finish(task, result) {
    const key = this.key(task.id, task.partName);
    if (this.tasks.get(key) !== task) return;
    this.tasks.delete(key);
    const report = { ...result, id:task.id, partName:task.partName, action:task.action, target:task.target };
    this.results.set(key, report);
    this.events.emit('interaction', { ...report, action:'articulation-completion', articulationAction:report.action });
    task.resolve(report);
  }

  wait(id, partName, action, target, { timeout = 4, stableDuration = .18, stallWindow = .5, stallTolerance = .004 } = {}) {
    const key = this.key(id, partName);
    const existing = this.tasks.get(key);
    if (existing && existing.action === action && Math.abs(existing.target-target) <= 1e-9) return existing.promise;
    if (existing) this.finish(existing, { status:'action-unverified', reason:'SUPERSEDED', targetReached:false, settled:false, elapsed:Number(existing.elapsed.toFixed(3)) });
    const state = this.physics.getArticulationState(id, partName, { target });
    if (!state) return Promise.resolve({ status:'action-unverified', reason:'JOINT_STATE_UNAVAILABLE', id, partName, action, target, targetReached:false, settled:false, elapsed:0 });
    let resolveTask;
    const task = { id, partName, action, target, timeout, stableDuration, stallWindow, stallTolerance, elapsed:0, stable:0, initialCoordinate:state.coordinate, samples:[{ time:0, coordinate:state.coordinate }], resolve:null, promise:null };
    task.promise = new Promise((resolve) => { resolveTask = resolve; });
    task.resolve = resolveTask;
    this.tasks.set(key, task);
    return task.promise;
  }

  promoteCompletion(report) {
    if (report?.status !== 'action-completed' || !report.targetReached || !this.store.has(report.id)) return false;
    const record = this.store.get(report.id);
    if (record.state.partTargets?.[report.partName] !== report.action) return false;
    record.state.parts ||= {};
    record.state.parts[report.partName] = report.action;
    delete record.state.partTargets[report.partName];
    if (!Object.keys(record.state.partTargets).length) delete record.state.partTargets;
    return true;
  }

  finalizeAttempt(report) {
    if (!report || !['action-failed','action-unverified'].includes(report.status) || !this.store.has(report.id)) return false;
    const record = this.store.get(report.id);
    if (record.state.partTargets?.[report.partName] !== report.action) return false;
    this.physics.holdArticulationCurrent?.(report.id,report.partName);
    delete record.state.partTargets[report.partName];
    if (!Object.keys(record.state.partTargets).length) delete record.state.partTargets;
    return true;
  }

  status(id, partName = null) {
    const record = this.store.get(id);
    const entries = Object.entries(record.manifest.parts || {}).filter(([name,part]) =>
      (!partName || name === partName) && part.joint && part.physics && Object.keys(part.targets || {}).length
    );
    if (!entries.length) throw Errors.actionUnsupported(id, partName ? `status:${partName}` : 'articulation-status');
    const parts = entries.map(([name,part]) => {
      const key = this.key(id,name);
      const pending = this.tasks.get(key);
      const last = this.results.get(key) || null;
      const requestedAction = record.state.partTargets?.[name] || null;
      const verifiedAction = record.state.parts?.[name] || null;
      const targetAction = pending?.action || requestedAction || verifiedAction;
      const target = targetAction && Number.isFinite(part.targets?.[targetAction]) ? part.targets[targetAction] : null;
      const live = this.physics.getArticulationState(id,name,{target});
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

  failureAttribution(id, partName) {
    const contacts=(this.physics.articulationContacts?.(id,partName) || []).filter((item)=>item.external);
    const blockerMap=new Map();
    for (const item of contacts) {
      const target=item.target || {};
      if (!['object','environment'].includes(target.kind)) continue;
      const key=target.kind==='object' ? `object:${target.objectId}:${target.partName || '$root'}` : `environment:${target.environmentId}:${target.colliderIndex ?? -1}`;
      if (!blockerMap.has(key)) blockerMap.set(key,structuredClone(target));
    }
    return { status:contacts.length ? 'contact-evidence' : 'unattributed', evidence:'current-contact-at-failure', contactEvidence:contacts, blockerCandidates:[...blockerMap.values()] };
  }

  execute(id, action, { partName = null } = {}) {
    const record = this.assertSupports(id, action);
    const [name, part] = this.findPartForAction(record, action, partName);
    const contract = getInteractionContract(record.manifest, name, action);
    if (contract.effects[0]?.kind !== 'set-articulation-target' || contract.verifierTarget.target !== part.targets[action]) throw Errors.actionUnsupported(id, action);
    if (!this.physics.setArticulationTarget(id, name, part.targets[action])) throw Errors.actionUnsupported(id, action);
    record.state.partTargets ||= {};
    record.state.partTargets[name] = action;
    this.results.delete(this.key(id,name));
    this.wait(id,name,action,part.targets[action]);
    this.events.emit('interaction', { action, id, part:name, target:part.targets[action] });
    return { id, part:name, action, capability:contract.capability, target:part.targets[action], requested:true, interactionContractId:contract.id, verifierTarget:structuredClone(contract.verifierTarget) };
  }

  update(dt) {
    const wrap = (jointType, value) => jointType === 'revolute' ? Math.atan2(Math.sin(value), Math.cos(value)) : value;
    for (const task of [...this.tasks.values()]) {
      task.elapsed += dt;
      const state = this.physics.getArticulationState(task.id, task.partName, { target:task.target });
      if (!state || !Number.isFinite(state.coordinate) || !Number.isFinite(state.error)) {
        this.finish(task, { status:'action-unverified', reason:'JOINT_STATE_UNAVAILABLE', targetReached:false, settled:false, elapsed:Number(task.elapsed.toFixed(3)) });
        continue;
      }
      const limits = state.limits;
      if (limits?.length === 2 && (state.coordinate < limits[0]-state.tolerance || state.coordinate > limits[1]+state.tolerance)) {
        this.finish(task, { status:'action-failed', reason:'LIMIT_VIOLATION', targetReached:false, settled:false, coordinate:state.coordinate, error:state.error, tolerance:state.tolerance, limits, elapsed:Number(task.elapsed.toFixed(3)) });
        continue;
      }
      const reached = state.error <= state.tolerance;
      task.stable = reached ? task.stable + dt : 0;
      task.samples.push({ time:task.elapsed, coordinate:state.coordinate });
      const cutoff = task.elapsed - task.stallWindow;
      while (task.samples.length > 2 && task.samples[1].time <= cutoff) task.samples.shift();
      const oldest = task.samples[0];
      const recentMovement = Math.abs(wrap(state.jointType, state.coordinate-oldest.coordinate));
      const observedWindow = task.elapsed-oldest.time;
      const stableCutoff = task.elapsed-task.stableDuration;
      const stableReference = task.samples.find((sample) => sample.time >= stableCutoff) || oldest;
      const settleMovement = Math.abs(wrap(state.jointType, state.coordinate-stableReference.coordinate));
      const settleTolerance = state.tolerance*.25;
      const progress = Math.abs(wrap(state.jointType, task.initialCoordinate-task.target)) - state.error;
      if (task.stable >= task.stableDuration && settleMovement <= settleTolerance) {
        this.finish(task, { status:'action-completed', targetReached:true, settled:true, coordinate:state.coordinate, error:state.error, tolerance:state.tolerance, settleMovement:Number(settleMovement.toFixed(6)), settleTolerance:Number(settleTolerance.toFixed(6)), progress:Number(progress.toFixed(6)), elapsed:Number(task.elapsed.toFixed(3)), coordinateReference:state.coordinateReference });
        continue;
      }
      if (!reached && task.elapsed >= task.stallWindow && observedWindow >= task.stallWindow*.8 && recentMovement < task.stallTolerance) {
        const attribution = this.failureAttribution(task.id, task.partName);
        this.finish(task, { status:'action-failed', reason:'STALL', targetReached:false, settled:false, coordinate:state.coordinate, error:state.error, tolerance:state.tolerance, recentMovement:Number(recentMovement.toFixed(6)), stallWindow:task.stallWindow, progress:Number(progress.toFixed(6)), elapsed:Number(task.elapsed.toFixed(3)), coordinateReference:state.coordinateReference, attribution });
        continue;
      }
      if (task.elapsed >= task.timeout) {
        this.finish(task, { status:'action-unverified', reason:'TIMEOUT', targetReached:false, settled:false, coordinate:state.coordinate, error:state.error, tolerance:state.tolerance, recentMovement:Number(recentMovement.toFixed(6)), progress:Number(progress.toFixed(6)), elapsed:Number(task.elapsed.toFixed(3)), coordinateReference:state.coordinateReference });
      }
    }
  }
}
