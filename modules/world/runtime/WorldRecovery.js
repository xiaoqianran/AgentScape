const clone = (value) => value == null ? value : structuredClone(value);

export class WorldRecovery {
  constructor(runtime) {
    this.runtime = runtime;
  }

  hasObject(id) {
    return Boolean(id && this.runtime.store?.has(id));
  }

  manifest(id) {
    if (!this.hasObject(id)) return null;
    return clone(this.runtime.store.get(id).manifest || null);
  }

  contacts(targetId, partName) {
    return clone(this.runtime.physics?.articulationContacts?.(targetId, partName) || []);
  }

  bounds(id) {
    const value = this.runtime.spatial?.getBounds?.(id);
    if (!value?.min || !value?.max) return null;
    return { min:[...value.min], max:[...value.max] };
  }

  articulationStatus(id, partName = null) {
    return clone(this.runtime.interactions?.articulationStatus?.(id, partName) || null);
  }

  actionSweepBounds(id, action, partName, samples) {
    return clone(this.runtime.interactions?.actionSweepBounds?.(id, action, partName, samples) || null);
  }

  async findInteractionPose(actorId, targetId, options) {
    return clone(await this.runtime.interactions?.findInteractionPose?.(actorId, targetId, options));
  }

  hasPairCounterfactual() {
    return typeof this.runtime.physics?.articulationPairCounterfactual === 'function';
  }

  pairCounterfactual(...args) {
    return clone(this.runtime.physics?.articulationPairCounterfactual?.(...args) || null);
  }

  hasWorldCounterfactual() {
    return typeof this.runtime.physics?.articulationWorldCounterfactual === 'function';
  }

  worldCounterfactual(...args) {
    return clone(this.runtime.physics?.articulationWorldCounterfactual?.(...args) || null);
  }

  hasCounterfactualConvergence() {
    return typeof this.runtime.physics?.articulationPairCounterfactualConvergence === 'function';
  }

  counterfactualConvergence(...args) {
    return clone(this.runtime.physics?.articulationPairCounterfactualConvergence?.(...args) || null);
  }

  assertCarryable(actorId, targetId) {
    return this.runtime.interactions.assertAgentCarryable(actorId, targetId);
  }

  async findPickupPlan(actorId, targetId) {
    return clone(await this.runtime.interactions.findPickupPlan(actorId, targetId));
  }

  heldStatus(actorId) {
    return clone(this.runtime.interactions.recoveryHeldStatus?.(actorId) || null);
  }

  async findCleanupPlan(actorId, targetId, options) {
    return clone(await this.runtime.interactions.findRecoveryCleanupPlan(actorId, targetId, options));
  }
}
