export const PHYSICS_BACKEND_CAPABILITIES = Object.freeze([
  'rigid-body','articulated-body','character-controller','collision','joints','scene-query'
]);

const missing=(identity,method)=>{ throw new Error(`Physics backend ${identity} ${method}() must be implemented`); };

export class PhysicsBackend {
  constructor(identity, capabilities = [], { executionModes=['realtime'], qualities={} } = {}) {
    if (!identity) throw new TypeError('PhysicsBackend identity is required');
    this.identity = identity;
    this.capabilities = Object.freeze([...new Set(capabilities)]);
    this.executionModes = Object.freeze([...new Set(executionModes)]);
    this.qualities = Object.freeze({ realtime:qualities.realtime===true, deterministic:qualities.deterministic===true });
  }
  hasCapability(capability) { return this.capabilities.includes(capability); }
  supportsExecutionMode(mode) { return this.executionModes.includes(mode); }
  async init() { missing(this.identity,'init'); }
  createWorld() { missing(this.identity,'createWorld'); }
  step() { missing(this.identity,'step'); }
  dispose() { missing(this.identity,'dispose'); }

  // Deep runtime contract. Handles returned here are opaque to PhysicsSystem.
  createBody() { missing(this.identity,'createBody'); }
  removeBody() { missing(this.identity,'removeBody'); }
  createColliders() { missing(this.identity,'createColliders'); }
  colliders() { missing(this.identity,'colliders'); }
  bodyKey() { missing(this.identity,'bodyKey'); }
  colliderKey() { missing(this.identity,'colliderKey'); }
  colliderParent() { missing(this.identity,'colliderParent'); }
  colliderSnapshot() { missing(this.identity,'colliderSnapshot'); }
  bodyType() { missing(this.identity,'bodyType'); }
  setBodyType() { missing(this.identity,'setBodyType'); }
  bodyPose() { missing(this.identity,'bodyPose'); }
  setBodyPose() { missing(this.identity,'setBodyPose'); }
  translateBody() { missing(this.identity,'translateBody'); }
  clearBodyMotion() { missing(this.identity,'clearBodyMotion'); }
  bodyMotion() { missing(this.identity,'bodyMotion'); }
  wakeBody() { missing(this.identity,'wakeBody'); }
  createJoint() { missing(this.identity,'createJoint'); }
  setJointTarget() { missing(this.identity,'setJointTarget'); }

  createCharacterController() { missing(this.identity,'createCharacterController'); }
  removeCharacterController() { missing(this.identity,'removeCharacterController'); }
  cancelCharacterMovement() { missing(this.identity,'cancelCharacterMovement'); }
  moveCharacter() { missing(this.identity,'moveCharacter'); }

  syncSceneQueries() { missing(this.identity,'syncSceneQueries'); }
  createQueryShape() { missing(this.identity,'createQueryShape'); }
  disposeQueryShape() { missing(this.identity,'disposeQueryShape'); }
  intersectionsWithShape() { missing(this.identity,'intersectionsWithShape'); }
  castCollider() { missing(this.identity,'castCollider'); }
  raycast() { missing(this.identity,'raycast'); }
  contactPairs() { missing(this.identity,'contactPairs'); }
  penetrations() { missing(this.identity,'penetrations'); }
  shapesIntersect() { missing(this.identity,'shapesIntersect'); }
  evidenceGeometry(kind) { return `${this.identity}-${kind}`; }


}

export class TransformPhysicsBackend extends PhysicsBackend {
  constructor({ identity='transform' } = {}) {
    super(identity, [], {
      executionModes:['render-only'],
      qualities:{realtime:true,deterministic:true}
    });
  }
  async init() { return this; }
  createWorld() { return null; }
  step() { return false; }
  dispose() {}
}
