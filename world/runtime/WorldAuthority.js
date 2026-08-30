const clone = (value) => value == null ? value : structuredClone(value);

export function captureWorldAuthority(runtime) {
  return {
    currentWorldRevision:clone(runtime.currentWorldRevision) || null,
    currentBehaviorBundle:clone(runtime.currentBehaviorBundle) || null,
    currentPhysicsRequirements:clone(runtime.currentPhysicsRequirements) || null,
    lastAcceptanceBundle:clone(runtime.lastAcceptanceBundle) || null,
    restoredAcceptanceEvidence:clone(runtime.restoredAcceptanceEvidence) || null,
    interactionEvidence:runtime.interactionEvidence instanceof Map
      ? [...runtime.interactionEvidence.entries()].map(([key,value]) => [key,clone(value)])
      : null
  };
}

export function restoreWorldAuthority(runtime, authority = {}) {
  runtime.currentWorldRevision = clone(authority.currentWorldRevision) || null;
  runtime.currentBehaviorBundle = clone(authority.currentBehaviorBundle) || null;
  runtime.currentPhysicsRequirements = clone(authority.currentPhysicsRequirements) || null;
  runtime.lastAcceptanceBundle = clone(authority.lastAcceptanceBundle) || null;
  runtime.restoredAcceptanceEvidence = clone(authority.restoredAcceptanceEvidence) || null;
  if (authority.interactionEvidence === null) delete runtime.interactionEvidence;
  else runtime.interactionEvidence = new Map((authority.interactionEvidence || []).map(([key,value]) => [key,clone(value)]));
  runtime.loadRuleGraph?.(authority.currentBehaviorBundle?.ruleGraph || []);
}

export function commitWorldAuthority(runtime, {
  worldIR,
  behaviorBundle,
  physicsRequirements,
  acceptanceBundle = null
} = {}) {
  runtime.currentWorldRevision = worldIR
    ? { revision:clone(worldIR.revision), provenance:clone(worldIR.provenance) }
    : null;
  runtime.currentBehaviorBundle = clone(behaviorBundle) || null;
  runtime.currentPhysicsRequirements = clone(physicsRequirements) || null;
  runtime.lastAcceptanceBundle = clone(acceptanceBundle) || null;
  runtime.restoredAcceptanceEvidence = null;
  runtime.loadRuleGraph?.(behaviorBundle?.ruleGraph || []);
}
