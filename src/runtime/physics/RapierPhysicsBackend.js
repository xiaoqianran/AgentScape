import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_BACKEND_CAPABILITIES, PhysicsBackend } from './PhysicsBackend.js';

export class RapierPhysicsBackend extends PhysicsBackend {
  constructor({ gravity={x:0,y:-9.81,z:0} } = {}) {
    super('rapier', PHYSICS_BACKEND_CAPABILITIES);
    this.gravity=gravity;
  }
  async init() { await RAPIER.init(); return this; }
  createWorld() { return new RAPIER.World(this.gravity); }
  step(world, dt) { world.timestep=dt; world.step(); }
  dispose(world) { world?.free?.(); }
  createBodyDesc(type, position) {
    const desc=type==='dynamic' ? RAPIER.RigidBodyDesc.dynamic() : type==='kinematic' ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed();
    return position ? desc.setTranslation(position.x,position.y,position.z) : desc;
  }
  createFixedBodyDesc() { return RAPIER.RigidBodyDesc.fixed(); }
  createColliderDesc(spec) {
    let desc;
    if(spec.shape==='box') desc=RAPIER.ColliderDesc.cuboid(...spec.halfExtents);
    else if(spec.shape==='cylinder') desc=RAPIER.ColliderDesc.cylinder(spec.halfHeight,spec.radius);
    else if(spec.shape==='capsule') desc=RAPIER.ColliderDesc.capsule(spec.halfHeight,spec.radius);
    else if(spec.shape==='convexHull') desc=RAPIER.ColliderDesc.convexHull(new Float32Array(spec.vertices));
    else return null;
    if(!desc) throw new Error('Rapier rejected a degenerate convex hull collider');
    return desc;
  }
  createImpulseJoint(world, part, parentBody, childBody) {
    const vec = (a=[0,0,0]) => ({x:a[0],y:a[1],z:a[2]});
    const data = part.joint.type==='revolute'
      ? RAPIER.JointData.revolute(vec(part.joint.parentAnchor),vec(part.joint.childAnchor),vec(part.joint.axis))
      : RAPIER.JointData.prismatic(vec(part.joint.parentAnchor),vec(part.joint.childAnchor),vec(part.joint.axis));
    const joint=world.createImpulseJoint(data,parentBody,childBody,true);
    joint.setContactsEnabled(false);
    if(part.joint.limits) joint.setLimits(part.joint.limits[0],part.joint.limits[1]);
    return joint;
  }
  createShape(spec) {
    if(spec.shape==='box') return new RAPIER.Cuboid(...spec.halfExtents);
    if(spec.shape==='cylinder') return new RAPIER.Cylinder(spec.halfHeight,spec.radius);
    if(spec.shape==='capsule') return new RAPIER.Capsule(spec.halfHeight,spec.radius);
    if(spec.shape==='convexHull') return new RAPIER.ConvexPolyhedron(new Float32Array(spec.vertices));
    return null;
  }
  createRay(origin,direction) { return new RAPIER.Ray(origin,direction); }
  isShapeType(shape,type) {
    const map={Cuboid:RAPIER.ShapeType.Cuboid,Cylinder:RAPIER.ShapeType.Cylinder,ConvexPolyhedron:RAPIER.ShapeType.ConvexPolyhedron};
    return shape?.type===map[type];
  }
  setKinematicType(body) { body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true); }
  setDynamicType(body) { body.setBodyType(RAPIER.RigidBodyType.Dynamic,true); }
  captureBodyType(body) { return body.isKinematic?.() ? 'kinematic' : body.isDynamic?.() ? 'dynamic' : 'fixed'; }
  restoreBodyType(body,type) { if(type==='kinematic') this.setKinematicType(body); else if(type==='dynamic') this.setDynamicType(body); else body.setBodyType(RAPIER.RigidBodyType.Fixed,true); }
}
