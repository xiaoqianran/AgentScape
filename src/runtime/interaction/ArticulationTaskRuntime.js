import { Errors } from "../../core/errors.js";

export class ArticulationTaskRuntime {
  constructor({ getStore, getPhysics, getEvents }) {
    this.getStore = getStore;
    this.getPhysics = getPhysics;
    this.getEvents = getEvents;
    this.tasks = new Map();
    this.results = new Map();
  }

  taskKey(id, partName) { return `${id}:${partName}`; }

  finish(task, result) {
    const key = this.taskKey(task.id, task.partName);
    if (this.tasks.get(key) !== task) return;
    this.tasks.delete(key);
    const report = { ...result, id:task.id, partName:task.partName, action:task.action, target:task.target };
    this.results.set(key, report);
    this.getEvents().emit("interaction", { ...report, action:"articulation-completion", articulationAction:report.action });
    task.resolve(report);
  }

  promoteCompletion(report) {
    if (report?.status !== "action-completed" || !report.targetReached || !this.getStore().has(report.id)) return false;
    const record = this.getStore().get(report.id);
    if (record.state.partTargets?.[report.partName] !== report.action) return false;
    record.state.parts ||= {};
    record.state.parts[report.partName] = report.action;
    delete record.state.partTargets[report.partName];
    if (!Object.keys(record.state.partTargets).length) delete record.state.partTargets;
    return true;
  }

  finalizeAttempt(report) {
    if (!report || !["action-failed", "action-unverified"].includes(report.status) || !this.getStore().has(report.id)) return false;
    const record = this.getStore().get(report.id);
    if (record.state.partTargets?.[report.partName] !== report.action) return false;
    this.getPhysics().holdArticulationCurrent?.(report.id, report.partName);
    delete record.state.partTargets[report.partName];
    if (!Object.keys(record.state.partTargets).length) delete record.state.partTargets;
    return true;
  }

  status(id, partName = null) {
    const record = this.getStore().get(id);
    const entries = Object.entries(record.manifest.parts || {}).filter(([name, part]) =>
      (!partName || name === partName) && part.joint && part.physics && Object.keys(part.targets || {}).length
    );
    if (!entries.length) throw Errors.actionUnsupported(id, partName ? `status:${partName}` : "articulation-status");
    const parts = entries.map(([name, part]) => {
      const key = this.taskKey(id, name);
      const pending = this.tasks.get(key);
      const last = this.results.get(key) || null;
      const requestedAction = record.state.partTargets?.[name] || null;
      const verifiedAction = record.state.parts?.[name] || null;
      const targetAction = pending?.action || requestedAction || verifiedAction;
      const target = targetAction && Number.isFinite(part.targets?.[targetAction]) ? part.targets[targetAction] : null;
      const live = this.getPhysics().articulationState(id, name, { target });
      return {
        partName:name,
        status:pending ? "moving" : (last?.status || (verifiedAction ? "verified-state" : "idle")),
        requestedAction, verifiedAction,
        ...(pending ? { pending:{action:pending.action, target:pending.target, elapsed:Number(pending.elapsed.toFixed(3))} } : {}),
        ...(last ? { last:structuredClone(last) } : {}),
        ...(live ? { live:{coordinate:live.coordinate, target:live.target, error:live.error, tolerance:live.tolerance, coordinateReference:live.coordinateReference} } : {})
      };
    });
    return { id, parts };
  }

  waitForCompletion(id, partName, action, target, {
    timeout = 4, stableDuration = .18, stallWindow = .5, stallTolerance = .004
  } = {}) {
    const key = this.taskKey(id, partName);
    const existing = this.tasks.get(key);
    if (existing && existing.action === action && Math.abs(existing.target - target) <= 1e-9) return existing.promise;
    if (existing) this.finish(existing, {status:"action-unverified", reason:"SUPERSEDED", targetReached:false, settled:false, elapsed:Number(existing.elapsed.toFixed(3))});
    const state = this.getPhysics().articulationState(id, partName, { target });
    if (!state) return Promise.resolve({status:"action-unverified", reason:"JOINT_STATE_UNAVAILABLE", id, partName, action, target, targetReached:false, settled:false, elapsed:0});
    let resolveTask;
    const task = {
      id, partName, action, target, timeout, stableDuration, stallWindow, stallTolerance,
      elapsed:0, stable:0, initialCoordinate:state.coordinate, samples:[{time:0, coordinate:state.coordinate}],
      resolve:null, promise:null
    };
    task.promise = new Promise((resolve) => { resolveTask = resolve; });
    task.resolve = resolveTask;
    this.tasks.set(key, task);
    return task.promise;
  }

  failureAttribution(id, partName) {
    const contacts = (this.getPhysics().articulationContacts?.(id, partName) || []).filter((item) => item.external);
    const blockerMap = new Map();
    for (const item of contacts) {
      const target = item.target || {};
      if (!["object", "environment"].includes(target.kind)) continue;
      const key = target.kind === "object"
        ? `object:${target.objectId}:${target.partName || "$root"}`
        : `environment:${target.environmentId}:${target.colliderIndex ?? -1}`;
      if (!blockerMap.has(key)) blockerMap.set(key, structuredClone(target));
    }
    return {
      status:contacts.length ? "contact-evidence" : "unattributed",
      evidence:"current-contact-at-failure",
      contactEvidence:contacts,
      blockerCandidates:[...blockerMap.values()]
    };
  }

  update(dt) {
    const wrap = (jointType, value) => jointType === "revolute" ? Math.atan2(Math.sin(value), Math.cos(value)) : value;
    for (const task of [...this.tasks.values()]) {
      task.elapsed += dt;
      const state = this.getPhysics().articulationState(task.id, task.partName, { target:task.target });
      if (!state || !Number.isFinite(state.coordinate) || !Number.isFinite(state.error)) {
        this.finish(task, {status:"action-unverified", reason:"JOINT_STATE_UNAVAILABLE", targetReached:false, settled:false, elapsed:Number(task.elapsed.toFixed(3))});
        continue;
      }
      const limits = state.limits;
      if (limits?.length === 2 && (state.coordinate < limits[0] - state.tolerance || state.coordinate > limits[1] + state.tolerance)) {
        this.finish(task, {status:"action-failed", reason:"LIMIT_VIOLATION", targetReached:false, settled:false, coordinate:state.coordinate, error:state.error, tolerance:state.tolerance, limits, elapsed:Number(task.elapsed.toFixed(3))});
        continue;
      }
      const reached = state.error <= state.tolerance;
      task.stable = reached ? task.stable + dt : 0;
      task.samples.push({time:task.elapsed, coordinate:state.coordinate});
      const cutoff = task.elapsed - task.stallWindow;
      while (task.samples.length > 2 && task.samples[1].time <= cutoff) task.samples.shift();
      const oldest = task.samples[0];
      const recentMovement = Math.abs(wrap(state.jointType, state.coordinate - oldest.coordinate));
      const observedWindow = task.elapsed - oldest.time;
      const stableCutoff = task.elapsed - task.stableDuration;
      const stableReference = task.samples.find((sample) => sample.time >= stableCutoff) || oldest;
      const settleMovement = Math.abs(wrap(state.jointType, state.coordinate - stableReference.coordinate));
      const settleTolerance = state.tolerance * .25;
      const progress = Math.abs(wrap(state.jointType, task.initialCoordinate - task.target)) - state.error;
      if (task.stable >= task.stableDuration && settleMovement <= settleTolerance) {
        this.finish(task, {status:"action-completed", targetReached:true, settled:true, coordinate:state.coordinate, error:state.error, tolerance:state.tolerance, settleMovement:Number(settleMovement.toFixed(6)), settleTolerance:Number(settleTolerance.toFixed(6)), progress:Number(progress.toFixed(6)), elapsed:Number(task.elapsed.toFixed(3)), coordinateReference:state.coordinateReference});
        continue;
      }
      if (!reached && task.elapsed >= task.stallWindow && observedWindow >= task.stallWindow * .8 && recentMovement < task.stallTolerance) {
        const attribution = this.failureAttribution(task.id, task.partName);
        this.finish(task, {status:"action-failed", reason:"STALL", targetReached:false, settled:false, coordinate:state.coordinate, error:state.error, tolerance:state.tolerance, recentMovement:Number(recentMovement.toFixed(6)), stallWindow:task.stallWindow, progress:Number(progress.toFixed(6)), elapsed:Number(task.elapsed.toFixed(3)), coordinateReference:state.coordinateReference, attribution});
        continue;
      }
      if (task.elapsed >= task.timeout) {
        this.finish(task, {status:"action-unverified", reason:"TIMEOUT", targetReached:false, settled:false, coordinate:state.coordinate, error:state.error, tolerance:state.tolerance, recentMovement:Number(recentMovement.toFixed(6)), progress:Number(progress.toFixed(6)), elapsed:Number(task.elapsed.toFixed(3)), coordinateReference:state.coordinateReference});
      }
    }
  }

  clearResult(id, partName) {
    this.results.delete(this.taskKey(id, partName));
  }

  beforeRemove(id) {
    for (const key of [...this.results.keys()]) if (key.startsWith(`${id}:`)) this.results.delete(key);
    for (const task of [...this.tasks.values()]) if (task.id === id) {
      this.finish(task, {status:"action-unverified", reason:"OBJECT_REMOVED", targetReached:false, settled:false, elapsed:Number(task.elapsed.toFixed(3))});
    }
  }

  cancelAll(reason = "RUNTIME_DISPOSED") {
    for (const task of [...this.tasks.values()]) {
      this.finish(task, {status:"action-unverified", reason, targetReached:false, settled:false, elapsed:Number(task.elapsed.toFixed(3))});
    }
  }
}
