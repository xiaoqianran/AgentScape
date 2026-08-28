export const PHYSICS_BACKEND_CAPABILITIES = Object.freeze([
  'transform-state','articulation-pose','rigid-body','articulated-body','character-controller','collision','joints','scene-query','snapshot-restore','counterfactual-query'
]);

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
  async init() { throw new Error('PhysicsBackend.init() must be implemented'); }
  createWorld() { throw new Error('PhysicsBackend.createWorld() must be implemented'); }
  step() { throw new Error('PhysicsBackend.step() must be implemented'); }
  dispose() { throw new Error('PhysicsBackend.dispose() must be implemented'); }
  createBodyDesc() { throw new Error('PhysicsBackend.createBodyDesc() must be implemented'); }
  createFixedBodyDesc() { throw new Error('PhysicsBackend.createFixedBodyDesc() must be implemented'); }
  createColliderDesc() { throw new Error('PhysicsBackend.createColliderDesc() must be implemented'); }
  createImpulseJoint() { throw new Error('PhysicsBackend.createImpulseJoint() must be implemented'); }
  createShape() { throw new Error('PhysicsBackend.createShape() must be implemented'); }
  createRay() { throw new Error('PhysicsBackend.createRay() must be implemented'); }
  isShapeType() { throw new Error('PhysicsBackend.isShapeType() must be implemented'); }
  setKinematicType() { throw new Error('PhysicsBackend.setKinematicType() must be implemented'); }
  setDynamicType() { throw new Error('PhysicsBackend.setDynamicType() must be implemented'); }
  captureBodyType() { throw new Error('PhysicsBackend.captureBodyType() must be implemented'); }
  restoreBodyType() { throw new Error('PhysicsBackend.restoreBodyType() must be implemented'); }
}


export class TransformPhysicsBackend extends PhysicsBackend {
  constructor({ identity='transform' } = {}) {
    super(identity, ['transform-state','articulation-pose'], {
      executionModes:['render-only'],
      qualities:{realtime:true,deterministic:true}
    });
  }
  async init() { return this; }
  createWorld() { return null; }
  step() { return false; }
  dispose() {}
}
