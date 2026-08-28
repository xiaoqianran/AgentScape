import * as THREE from "three";
import { Errors } from "../../core/errors.js";

export class SettleTaskRuntime {
  constructor({ getStore, getPhysics, getSpatial, getEvents, heldByAgent, actionSweepBounds }) {
    this.getStore = getStore;
    this.getPhysics = getPhysics;
    this.getSpatial = getSpatial;
    this.getEvents = getEvents;
    this.heldByAgent = heldByAgent;
    this.actionSweepBounds = actionSweepBounds;
    this.tasks = new Map();
  }

  waitForObjectSettle(objectId, { kind="place", targetId=null, surfaceId=null, actorId=null, partName=null, action=null, timeout=4, stableDuration=.35, linearSpeed=.04, angularSpeed=.12 } = {}) {
    if (this.tasks.has(objectId)) throw Errors.placeUnavailable(actorId || "runtime", targetId || objectId, "SETTLE_ALREADY_ACTIVE", { objectId });
    return new Promise((resolve) => this.tasks.set(objectId, {
      kind, objectId, targetId, surfaceId, actorId, partName, action, timeout, stableDuration, linearSpeed, angularSpeed, elapsed:0, stable:0, resolve
    }));
  }

  waitForPlacementSettle(objectId, targetId, surfaceId, { timeout=4, stableDuration=.35, linearSpeed=.04, angularSpeed=.12 } = {}) {
    return this.waitForObjectSettle(objectId, {kind:"place", targetId, surfaceId, timeout, stableDuration, linearSpeed, angularSpeed});
  }

  waitForRecoveryCleanupSettle(actorId, objectId, targetId, partName, action, options = {}) {
    return this.waitForObjectSettle(objectId, {kind:"recovery-cleanup", actorId, targetId, partName, action, ...options});
  }

  placementResult(task, motion, { settled, reason=null } = {}) {
    const support = this.getSpatial().supportStatus(task.objectId, task.targetId, { surfaceId:task.surfaceId });
    if (!settled) return {
      status:"place-unverified", reason:reason || "SETTLE_TIMEOUT", supportVerified:false, support, settled:false,
      elapsed:Number(task.elapsed.toFixed(3)), motion
    };
    return {
      status:support.on ? "placed" : "place-failed", ...(support.on ? {} : {reason:"SUPPORT_NOT_REACHED"}),
      supportVerified:support.on, support, settled:true, elapsed:Number(task.elapsed.toFixed(3)), motion
    };
  }

  dropResult(task, motion, { settled, reason=null } = {}) {
    const held = this.getStore().has(task.objectId) ? this.getStore().get(task.objectId).state?.heldBy : null;
    const released = !held && this.heldByAgent(task.actorId) !== task.objectId;
    const position = this.getPhysics().getPosition(task.objectId);
    if (!settled) return {
      status:reason === "BODY_UNAVAILABLE" ? "drop-failed" : "drop-unverified", reason:reason || "SETTLE_TIMEOUT",
      actorId:task.actorId, targetId:task.objectId, released, settled:false, stillHeld:!released,
      position:position ? [...position] : null, elapsed:Number(task.elapsed.toFixed(3)), motion
    };
    if (!released) return {
      status:"drop-failed", reason:"STILL_HELD", actorId:task.actorId, targetId:task.objectId,
      released:false, settled:true, stillHeld:true, position:position ? [...position] : null,
      elapsed:Number(task.elapsed.toFixed(3)), motion
    };
    return {
      status:"dropped", actorId:task.actorId, targetId:task.objectId, released:true, settled:true, stillHeld:false,
      position:position ? [...position] : null, elapsed:Number(task.elapsed.toFixed(3)), motion
    };
  }

  recoveryCleanupResult(task, motion, { settled, reason=null } = {}) {
    const held = this.getStore().has(task.objectId) ? this.getStore().get(task.objectId).state?.heldBy : null;
    const sweep = this.getStore().has(task.targetId) ? this.actionSweepBounds(task.targetId, task.action, task.partName) : {checked:false, reason:"TARGET_UNAVAILABLE"};
    const bounds = this.getStore().has(task.objectId) ? this.getSpatial().getBounds(task.objectId) : null;
    const box = bounds ? new THREE.Box3(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max)) : null;
    const sweepClear = Boolean(sweep.checked && box && !sweep.box.intersectsBox(box));
    const contacts = sweep.checked ? (this.getPhysics().articulationContacts?.(task.targetId, sweep.partName) || []) : [];
    const contactClear = !contacts.some((contact) => contact.external && contact.target?.kind === "object" && contact.target.objectId === task.objectId);
    const released = !held && this.heldByAgent(task.actorId) !== task.objectId;
    const verified = Boolean(settled && released && sweepClear && contactClear);
    let failureReason = reason;
    if (!failureReason && !released) failureReason = "STILL_HELD";
    else if (!failureReason && !sweep.checked) failureReason = "ACTION_SWEEP_UNAVAILABLE";
    else if (!failureReason && !sweepClear) failureReason = "ACTION_SWEEP_OCCUPIED";
    else if (!failureReason && !contactClear) failureReason = "CONTACT_STILL_ACTIVE";
    return {
      status:verified ? "recovery-cleaned" : (settled ? "recovery-cleanup-failed" : "recovery-cleanup-unverified"),
      ...(verified ? {} : {reason:failureReason || "RECOVERY_CLEANUP_UNVERIFIED"}),
      actorId:task.actorId, targetId:task.targetId, blockerId:task.objectId, partName:sweep.partName || task.partName, action:task.action,
      released, settled:Boolean(settled), sweepClear, contactClear,
      actionSweep:sweep.checked ? {checked:true, partName:sweep.partName, bounds:sweep.bounds} : {checked:false, reason:sweep.reason, partName:sweep.partName || task.partName},
      elapsed:Number(task.elapsed.toFixed(3)), motion
    };
  }

  finish(task, result) {
    if (!this.tasks.has(task.objectId)) return;
    this.tasks.delete(task.objectId);
    const eventAction = task.kind === "recovery-cleanup" ? "recovery-cleanup" : task.kind === "drop" ? "drop" : "place";
    this.getEvents().emit("interaction", {action:eventAction, id:task.objectId, targetId:task.targetId, ...result});
    task.resolve(result);
  }

  resultFor(task, motion, { settled, reason=null } = {}) {
    if (task.kind === "recovery-cleanup") return this.recoveryCleanupResult(task, motion, { settled, reason });
    if (task.kind === "drop") return this.dropResult(task, motion, { settled, reason });
    if (reason === "BODY_UNAVAILABLE") return {status:"place-failed", reason, supportVerified:false, elapsed:Number(task.elapsed.toFixed(3))};
    if (reason === "OBJECT_REMOVED" || (reason && !settled && motion === null)) {
      return {status:"place-unverified", reason, supportVerified:false, settled:false, elapsed:Number(task.elapsed.toFixed(3))};
    }
    return this.placementResult(task, motion, { settled, reason });
  }

  update(dt) {
    for (const task of [...this.tasks.values()]) {
      task.elapsed += dt;
      const motionState = this.getPhysics().bodyMotionState(task.objectId);
      if (!motionState) {
        this.finish(task, this.resultFor(task, null, {settled:false, reason:"BODY_UNAVAILABLE"}));
        continue;
      }
      const motion = {sleeping:motionState.sleeping, linearSpeed:Number(motionState.linearSpeed.toFixed(4)), angularSpeed:Number(motionState.angularSpeed.toFixed(4))};
      const slow = motionState.sleeping || (motionState.linearSpeed <= task.linearSpeed && motionState.angularSpeed <= task.angularSpeed);
      task.stable = slow ? task.stable + dt : 0;
      if (task.stable >= task.stableDuration) {
        this.finish(task, this.resultFor(task, motion, { settled:true }));
        continue;
      }
      if (task.elapsed >= task.timeout) {
        this.finish(task, this.resultFor(task, motion, {settled:false, reason:"SETTLE_TIMEOUT"}));
      }
    }
  }

  beforeRemove(id) {
    for (const task of [...this.tasks.values()]) if (task.objectId === id || task.targetId === id) {
      this.finish(task, this.resultFor(task, null, {settled:false, reason:"OBJECT_REMOVED"}));
    }
  }

  cancelAll(reason = "RUNTIME_DISPOSED") {
    for (const task of [...this.tasks.values()]) {
      this.finish(task, this.resultFor(task, null, {settled:false, reason}));
    }
  }
}
