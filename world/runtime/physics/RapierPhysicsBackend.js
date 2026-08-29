import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_BACKEND_CAPABILITIES, PhysicsBackend } from './PhysicsBackend.js';

const v3=(value=[0,0,0])=>Array.isArray(value)
  ? {x:value[0],y:value[1],z:value[2]}
  : {x:value.x,y:value.y,z:value.z};
const q4=(value=[0,0,0,1])=>Array.isArray(value)
  ? {x:value[0],y:value[1],z:value[2],w:value[3]}
  : {x:value.x,y:value.y,z:value.z,w:value.w};
const array3=(value)=>[value.x,value.y,value.z];
const array4=(value)=>[value.x,value.y,value.z,value.w];


const createBodyDesc=(type,position)=>{
  const desc=type==='dynamic' ? RAPIER.RigidBodyDesc.dynamic()
    : type==='kinematic' ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.fixed();
  if(position) {
    const p=v3(position);
    desc.setTranslation(p.x,p.y,p.z);
  }
  return desc;
};

const createColliderDesc=(spec)=>{
  let desc;
  if(spec.shape==='box') desc=RAPIER.ColliderDesc.cuboid(...spec.halfExtents);
  else if(spec.shape==='cylinder') desc=RAPIER.ColliderDesc.cylinder(spec.halfHeight,spec.radius);
  else if(spec.shape==='capsule') desc=RAPIER.ColliderDesc.capsule(spec.halfHeight,spec.radius);
  else if(spec.shape==='convexHull') desc=RAPIER.ColliderDesc.convexHull(new Float32Array(spec.vertices));
  else return null;
  if(!desc) throw new Error('Rapier rejected a degenerate convex hull collider');
  return desc;
};

const createJoint=(world,part,parentBody,childBody)=>{
  const vec=(a=[0,0,0])=>({x:a[0],y:a[1],z:a[2]});
  const data=part.joint.type==='revolute'
    ? RAPIER.JointData.revolute(vec(part.joint.parentAnchor),vec(part.joint.childAnchor),vec(part.joint.axis))
    : RAPIER.JointData.prismatic(vec(part.joint.parentAnchor),vec(part.joint.childAnchor),vec(part.joint.axis));
  const joint=world.createImpulseJoint(data,parentBody,childBody,true);
  joint.setContactsEnabled(false);
  if(part.joint.limits) joint.setLimits(part.joint.limits[0],part.joint.limits[1]);
  return joint;
};

const createQueryShape=(spec)=>{
  if(spec.shape==='box') return new RAPIER.Cuboid(...spec.halfExtents);
  if(spec.shape==='cylinder') return new RAPIER.Cylinder(spec.halfHeight,spec.radius);
  if(spec.shape==='capsule') return new RAPIER.Capsule(spec.halfHeight,spec.radius);
  if(spec.shape==='convexHull') return new RAPIER.ConvexPolyhedron(new Float32Array(spec.vertices));
  return null;
};

const describeShape=(shape)=>{
  if(!shape) return {kind:'unknown'};
  if(shape.type===RAPIER.ShapeType.Cuboid) return {
    kind:'box', halfExtents:v3(shape.halfExtents), borderRadius:Number(shape.borderRadius)||0
  };
  if(shape.type===RAPIER.ShapeType.Cylinder) return {
    kind:'cylinder', halfHeight:shape.halfHeight, radius:shape.radius, borderRadius:Number(shape.borderRadius)||0
  };
  if(shape.type===RAPIER.ShapeType.Capsule) return {
    kind:'capsule', halfHeight:shape.halfHeight, radius:shape.radius, borderRadius:Number(shape.borderRadius)||0
  };
  if(shape.type===RAPIER.ShapeType.ConvexPolyhedron) return {
    kind:'convexHull', vertices:Array.from(shape.vertices || []), borderRadius:Number(shape.borderRadius)||0
  };
  return {kind:'unknown',type:shape.type};
};

export class RapierPhysicsBackend extends PhysicsBackend {
  constructor({ gravity={x:0,y:-9.81,z:0} } = {}) {
    super('rapier', PHYSICS_BACKEND_CAPABILITIES, {
      executionModes:['realtime','validation-only'],
      qualities:{realtime:true,deterministic:true}
    });
    this.gravity=gravity;
  }

  async init() { await RAPIER.init(); return this; }
  createWorld() { return new RAPIER.World(this.gravity); }
  step(world, dt) { world.timestep=dt; world.step(); }
  dispose(world) { world?.free?.(); }

  createBody(world,{type='fixed',position=null,rotation=null}={}) {
    const body=world.createRigidBody(createBodyDesc(type,position));
    if(rotation) body.setRotation(q4(rotation),true);
    return body;
  }
  removeBody(world,body) { if(body) world.removeRigidBody(body); }
  createColliders(world,body,specs=[],{mass,friction}={}) {
    const colliderMass=mass!=null && specs.length ? mass/specs.length : null;
    const created=[];
    for(const spec of specs) {
      const desc=createColliderDesc(spec);
      if(!desc) continue;
      if(spec.translation) desc.setTranslation(...spec.translation);
      if(spec.rotation) desc.setRotation(q4(spec.rotation));
      if(colliderMass!=null) desc.setMass(colliderMass);
      if(friction!=null) desc.setFriction(friction);
      created.push(world.createCollider(desc,body));
    }
    return created;
  }
  colliders(body) {
    if(!body) return [];
    return Array.from({length:body.numColliders()},(_,index)=>body.collider(index));
  }
  bodyKey(body) { return body?.handle ?? null; }
  colliderKey(collider) { return collider?.handle ?? null; }
  colliderParent(collider) { return collider?.parent?.() || null; }
  colliderSnapshot(collider) {
    if(!collider) return null;
    const position=collider.translation();
    const rotation=collider.rotation();
    return {
      ref:collider,
      key:this.colliderKey(collider),
      parent:this.colliderParent(collider),
      position:v3(position),
      rotation:q4(rotation),
      shape:describeShape(collider.shape),
      shapeRef:collider.shape
    };
  }
  bodyType(body) { return body?.isKinematic?.() ? 'kinematic' : body?.isDynamic?.() ? 'dynamic' : 'fixed'; }
  setBodyType(body,type) {
    if(type==='kinematic') body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased,true);
    else if(type==='dynamic') body.setBodyType(RAPIER.RigidBodyType.Dynamic,true);
    else body.setBodyType(RAPIER.RigidBodyType.Fixed,true);
    return true;
  }
  bodyPose(body,{next=false}={}) {
    if(!body) return null;
    const position=next && body.nextTranslation ? body.nextTranslation() : body.translation();
    const rotation=next && body.nextRotation ? body.nextRotation() : body.rotation();
    return {position:array3(position),rotation:array4(rotation)};
  }
  setBodyPose(body,{position=null,rotation=null,next=false,wake=true}={}) {
    if(!body) return false;
    if(next) {
      if(position) body.setNextKinematicTranslation(v3(position));
      if(rotation) body.setNextKinematicRotation(q4(rotation));
    } else {
      if(position) body.setTranslation(v3(position),wake);
      if(rotation) body.setRotation(q4(rotation),wake);
    }
    return true;
  }
  translateBody(body,delta,{clearLinearVelocity=true,wake=true}={}) {
    const pose=this.bodyPose(body);
    if(!pose) return false;
    this.setBodyPose(body,{position:[pose.position[0]+delta[0],pose.position[1]+delta[1],pose.position[2]+delta[2]],wake});
    if(clearLinearVelocity) body.setLinvel?.({x:0,y:0,z:0},wake);
    if(wake) body.wakeUp?.();
    return true;
  }
  clearBodyMotion(body,{wake=false}={}) {
    if(!body) return false;
    body.setLinvel?.({x:0,y:0,z:0},wake);
    body.setAngvel?.({x:0,y:0,z:0},wake);
    if(wake) body.wakeUp?.();
    return true;
  }
  bodyMotion(body) {
    if(!body) return null;
    const linear=body.linvel(),angular=body.angvel();
    return {
      sleeping:body.isSleeping(),
      linearVelocity:array3(linear),
      angularVelocity:array3(angular),
      linearSpeed:Math.hypot(linear.x,linear.y,linear.z),
      angularSpeed:Math.hypot(angular.x,angular.y,angular.z)
    };
  }
  wakeBody(body) { body?.wakeUp?.(); return Boolean(body); }

  createJoint(world,part,parentBody,childBody) { return createJoint(world,part,parentBody,childBody); }
  setJointTarget(joint,target,{stiffness=40,damping=8}={}) {
    if(!joint) return false;
    joint.configureMotorPosition(target,stiffness,damping);
    return true;
  }

  createCharacterController(world,{
    offset=.02,autostepHeight=.3,autostepMinWidth=.2,snapToGround=.3,
    maxSlopeClimbAngle=Math.PI/4,minSlopeSlideAngle=Math.PI/6
  }={}) {
    const controller=world.createCharacterController(offset);
    controller.enableAutostep(autostepHeight,autostepMinWidth,false);
    controller.enableSnapToGround(snapToGround);
    controller.setMaxSlopeClimbAngle(maxSlopeClimbAngle);
    controller.setMinSlopeSlideAngle(minSlopeSlideAngle);
    controller.setApplyImpulsesToDynamicBodies(false);
    return controller;
  }
  removeCharacterController(world,controller) { if(world&&controller) world.removeCharacterController(controller); }
  cancelCharacterMovement(body) {
    const pose=this.bodyPose(body);
    if(!pose) return false;
    return this.setBodyPose(body,{...pose,next:true});
  }
  moveCharacter(controller,body,desiredTranslation,{predicate=null}={}) {
    if(!controller || this.bodyType(body)!=='kinematic') {
      return {success:false,code:'CHARACTER_BODY_UNAVAILABLE',movement:[0,0,0],grounded:false,collisions:[]};
    }
    const colliders=this.colliders(body);
    if(colliders.length!==1) {
      return {success:false,code:'CHARACTER_BODY_UNAVAILABLE',movement:[0,0,0],grounded:false,collisions:[]};
    }
    controller.computeColliderMovement(colliders[0],v3(desiredTranslation),undefined,undefined,predicate || undefined);
    const movement=controller.computedMovement();
    const pose=this.bodyPose(body);
    this.setBodyPose(body,{
      position:[pose.position[0]+movement.x,pose.position[1]+movement.y,pose.position[2]+movement.z],
      next:true
    });
    const collisions=[];
    for(let index=0;index<controller.numComputedCollisions();index++) {
      const hit=controller.computedCollision(index);
      if(!hit?.collider) continue;
      collisions.push({collider:hit.collider,colliderKey:this.colliderKey(hit.collider),toi:hit.toi,normal:[hit.normal1.x,hit.normal1.y,hit.normal1.z]});
    }
    return {success:true,movement:array3(movement),grounded:controller.computedGrounded(),collisions};
  }

  syncSceneQueries(world) {
    if(!world) return;
    if(typeof world.updateSceneQueries==='function') world.updateSceneQueries();
    else world.propagateModifiedBodyPositionsToColliders?.();
  }
  createQueryShape(spec) { return createQueryShape(spec); }
  disposeQueryShape(shape) { shape?.free?.(); }
  intersectionsWithShape(world,position,rotation,shape,callback,{
    excludeCollider=null,excludeBody=null,predicate=null
  }={}) {
    this.syncSceneQueries(world);
    let active=true;
    world?.forEachCollider((other)=>{
      if(!active || other.isEnabled?.()===false) return;
      if(excludeCollider && this.colliderKey(other)===this.colliderKey(excludeCollider)) return;
      const parent=this.colliderParent(other);
      if(excludeBody && this.bodyKey(parent)===this.bodyKey(excludeBody)) return;
      if(predicate && !predicate(other)) return;
      if(!other.intersectsShape(shape,v3(position),q4(rotation))) return;
      active=callback(other)!==false;
    });
  }
  castCollider(world,source,velocity,{
    excludeCollider=null,excludeBody=null,predicate=null,targetDistance=0,maxToi=1,stopAtPenetration=false
  }={}) {
    this.syncSceneQueries(world);
    let best=null;
    const zero={x:0,y:0,z:0};
    world?.forEachCollider((other)=>{
      if(other.isEnabled?.()===false) return;
      if(this.colliderKey(other)===this.colliderKey(source)) return;
      if(excludeCollider && this.colliderKey(other)===this.colliderKey(excludeCollider)) return;
      const parent=this.colliderParent(other);
      if(excludeBody && this.bodyKey(parent)===this.bodyKey(excludeBody)) return;
      if(predicate && !predicate(other)) return;
      const hit=source.castCollider(v3(velocity),other,zero,targetDistance,maxToi,stopAtPenetration);
      if(!hit) return;
      if(!best || hit.time_of_impact<best.timeOfImpact) best={collider:other,timeOfImpact:hit.time_of_impact};
    });
    return best;
  }
  raycast(world,origin,direction,maxDistance,{solid=true,predicate=null}={}) {
    this.syncSceneQueries(world);
    const ray=new RAPIER.Ray(v3(origin),v3(direction));
    let best=null;
    world?.forEachCollider((collider)=>{
      if(collider.isEnabled?.()===false) return;
      if(predicate && !predicate(collider)) return;
      const toi=collider.castRay(ray,maxDistance,solid);
      if(!Number.isFinite(toi) || toi<0) return;
      if(!best || toi<best.timeOfImpact) best={collider,timeOfImpact:toi};
    });
    return best;
  }
  contactPairs(world,source) {
    const pairs=[];
    world.contactPairsWith(source,(other)=>{
      let manifoldCount=0,contactCount=0,activeContactCount=0,minDistance=Infinity,totalImpulse=0,normal=null;
      world.contactPair(source,other,(manifold,flipped)=>{
        manifoldCount+=1;
        const rawNormal=manifold.normal();
        normal=flipped ? [-rawNormal.x,-rawNormal.y,-rawNormal.z] : [rawNormal.x,rawNormal.y,rawNormal.z];
        for(let index=0;index<manifold.numContacts();index++) {
          const distance=manifold.contactDist(index);
          const impulse=Math.abs(manifold.contactImpulse(index)||0);
          contactCount+=1;
          if(distance<=1e-6 || impulse>1e-8) activeContactCount+=1;
          minDistance=Math.min(minDistance,distance);
          totalImpulse+=impulse;
        }
      });
      if(manifoldCount && activeContactCount) pairs.push({
        other,manifoldCount,contactCount,activeContactCount,
        minDistance:Number.isFinite(minDistance)?minDistance:null,totalImpulse,normal,
        evidenceKind:'solver-contact',impulseAvailable:true
      });
    });
    return pairs;
  }
  penetrations(world,source) {
    const sourceSnapshot=this.colliderSnapshot(source);
    const sourceBody=sourceSnapshot?.parent;
    if(!sourceSnapshot) return [];
    const hits=[];
    this.intersectionsWithShape(world,sourceSnapshot.position,sourceSnapshot.rotation,sourceSnapshot.shapeRef,(other)=>{
      const otherBody=this.colliderParent(other);
      if(!otherBody || this.bodyKey(otherBody)===this.bodyKey(sourceBody)) return true;
      const contact=source.contactCollider(other,0);
      if(contact && contact.distance<0) hits.push({other,distance:contact.distance});
      return true;
    },{excludeCollider:source});
    return hits;
  }
  shapesIntersect(leftShape,leftPosition,leftRotation,rightShape,rightPosition,rightRotation) {
    return leftShape.intersectsShape(v3(leftPosition),q4(leftRotation),rightShape,v3(rightPosition),q4(rightRotation));
  }

}
