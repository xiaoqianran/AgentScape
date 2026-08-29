import { PhysicsBackend } from './PhysicsBackend.js';

let joltModulePromise=null;
const loadJolt=()=>joltModulePromise ||= import('jolt-physics').then(({default:initJolt})=>initJolt());

const LAYER=0;
const UNIT=[1,1,1];
const ZERO=[0,0,0];
const IDENTITY=[0,0,0,1];

const cloneSpec=(spec)=>structuredClone(spec);
const tuple3=(value=ZERO)=>Array.isArray(value)?value:[value.x,value.y,value.z];
const tuple4=(value=IDENTITY)=>Array.isArray(value)?value:[value.x,value.y,value.z,value.w];
const array3=(value)=>[value.GetX(),value.GetY(),value.GetZ()];
const array4=(value)=>[value.GetX(),value.GetY(),value.GetZ(),value.GetW()];
const bodyIdNumber=(body)=>body.native.GetID().GetIndexAndSequenceNumber();
const nativeBodyIdNumber=(id)=>id.GetIndexAndSequenceNumber();

const quatMultiply=(a,b)=>[
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
  a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
  a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
  a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
];
const rotateVector=(q,v)=>{
  const [x,y,z,w]=q;
  const tx=2*(y*v[2]-z*v[1]);
  const ty=2*(z*v[0]-x*v[2]);
  const tz=2*(x*v[1]-y*v[0]);
  return [
    v[0]+w*tx+(y*tz-z*ty),
    v[1]+w*ty+(z*tx-x*tz),
    v[2]+w*tz+(x*ty-y*tx)
  ];
};
const worldPoseForCollider=(bodyPose,collider)=>{
  const localPosition=collider.spec.translation||ZERO;
  const localRotation=collider.spec.rotation||IDENTITY;
  const offset=rotateVector(bodyPose.rotation,localPosition);
  return {
    position:[bodyPose.position[0]+offset[0],bodyPose.position[1]+offset[1],bodyPose.position[2]+offset[2]],
    rotation:quatMultiply(bodyPose.rotation,localRotation)
  };
};

const shapeDescription=(spec)=>{
  if(spec.shape==='box') return {kind:'box',halfExtents:{x:spec.halfExtents[0],y:spec.halfExtents[1],z:spec.halfExtents[2]},borderRadius:0};
  if(spec.shape==='cylinder') return {kind:'cylinder',halfHeight:spec.halfHeight,radius:spec.radius,borderRadius:0};
  if(spec.shape==='capsule') return {kind:'capsule',halfHeight:spec.halfHeight,radius:spec.radius,borderRadius:0};
  if(spec.shape==='convexHull') return {kind:'convexHull',vertices:[...spec.vertices],borderRadius:0};
  return {kind:'unknown',type:spec.shape};
};

const motionType=(Jolt,type)=>type==='dynamic' ? Jolt.EMotionType_Dynamic
  : type==='kinematic' ? Jolt.EMotionType_Kinematic
    : Jolt.EMotionType_Static;
const semanticMotionType=(Jolt,type)=>type===Jolt.EMotionType_Dynamic ? 'dynamic'
  : type===Jolt.EMotionType_Kinematic ? 'kinematic'
    : 'fixed';

const activation=(Jolt,wake=true)=>wake ? Jolt.EActivation_Activate : Jolt.EActivation_DontActivate;

const pairKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
const normalized3=(value)=>{
  const [x,y,z]=tuple3(value); const length=Math.hypot(x,y,z);
  if(length<=1e-12) throw new TypeError('Joint axis must be non-zero');
  return [x/length,y/length,z/length];
};
const perpendicular3=(axis)=>{
  const [x,y,z]=normalized3(axis);
  const basis=Math.abs(x)<=Math.abs(y)&&Math.abs(x)<=Math.abs(z)?[1,0,0]:Math.abs(y)<=Math.abs(z)?[0,1,0]:[0,0,1];
  return normalized3([y*basis[2]-z*basis[1],z*basis[0]-x*basis[2],x*basis[1]-y*basis[0]]);
};

const withVec3=(Jolt,value,fn)=>{
  const v=new Jolt.Vec3(value[0],value[1],value[2]);
  try{return fn(v);}finally{Jolt.destroy(v);}
};
const withRVec3=(Jolt,value,fn)=>{
  const v=new Jolt.RVec3(value[0],value[1],value[2]);
  try{return fn(v);}finally{Jolt.destroy(v);}
};
const withQuat=(Jolt,value,fn)=>{
  const q=new Jolt.Quat(value[0],value[1],value[2],value[3]);
  try{return fn(q);}finally{Jolt.destroy(q);}
};

function createShapeSettings(Jolt,spec,userData=0){
  let settings;
  if(spec.shape==='box') {
    const half=new Jolt.Vec3(...spec.halfExtents);
    settings=new Jolt.BoxShapeSettings(half,0,null);
    Jolt.destroy(half);
  } else if(spec.shape==='cylinder') {
    settings=new Jolt.CylinderShapeSettings(spec.halfHeight,spec.radius,0,null);
  } else if(spec.shape==='capsule') {
    settings=new Jolt.CapsuleShapeSettings(spec.halfHeight,spec.radius,null);
  } else if(spec.shape==='convexHull') {
    settings=new Jolt.ConvexHullShapeSettings();
    const point=new Jolt.Vec3(0,0,0);
    try {
      for(let i=0;i<spec.vertices.length;i+=3){
        point.Set(spec.vertices[i],spec.vertices[i+1],spec.vertices[i+2]);
        settings.mPoints.push_back(point);
      }
    } finally { Jolt.destroy(point); }
  } else {
    throw new TypeError(`JoltPhysicsBackend unsupported collider shape: ${spec.shape}`);
  }
  settings.mUserData=userData;
  return settings;
}

function createOwnedShape(Jolt,spec,userData=0){
  const settings=createShapeSettings(Jolt,spec,userData);
  try {
    const result=settings.Create();
    try {
      if(!result.IsValid()) throw new Error(`Jolt rejected ${spec.shape} shape`);
      const shape=result.Get();
      shape.AddRef();
      result.Clear();
      return shape;
    } finally { Jolt.destroy(result); }
  } finally { Jolt.destroy(settings); }
}

function createBodyShape(Jolt,specs){
  if(!specs.length){ const shape=new Jolt.EmptyShape(); shape.AddRef(); return shape; }
  if(specs.length===1 && !specs[0].translation && !specs[0].rotation) return createOwnedShape(Jolt,specs[0],1);

  const compound=new Jolt.StaticCompoundShapeSettings();
  try {
    for(const [index,spec] of specs.entries()){
      const settings=createShapeSettings(Jolt,spec,index+1);
      const position=new Jolt.Vec3(...(spec.translation||ZERO));
      const rotation=new Jolt.Quat(...(spec.rotation||IDENTITY));
      try {
        compound.AddShapeShapeSettings(position,rotation,settings,index+1);
      } finally {
        Jolt.destroy(position);
        Jolt.destroy(rotation);
      }
      // Compound owns the child settings after AddShapeShapeSettings.
    }
    const result=compound.Create();
    try {
      if(!result.IsValid()) throw new Error('Jolt rejected compound collider shape');
      const shape=result.Get();
      shape.AddRef();
      result.Clear();
      return shape;
    } finally { Jolt.destroy(result); }
  } finally { Jolt.destroy(compound); }
}

const destroyOwnedShape=(shape)=>shape?.Release?.();

function createTransform(Jolt,position,rotation){
  const p=new Jolt.RVec3(...tuple3(position));
  const q=new Jolt.Quat(...tuple4(rotation));
  try { return Jolt.RMat44.prototype.sRotationTranslation(q,p); }
  finally { Jolt.destroy(q); Jolt.destroy(p); }
}

function createQueryFilters(Jolt,world){
  return {
    broadPhase:new Jolt.DefaultBroadPhaseLayerFilter(world.jolt.GetObjectVsBroadPhaseLayerFilter(),LAYER),
    object:new Jolt.DefaultObjectLayerFilter(world.jolt.GetObjectLayerPairFilter(),LAYER),
    body:new Jolt.BodyFilter(),
    shape:new Jolt.ShapeFilter()
  };
}
function destroyQueryFilters(Jolt,filters){
  Jolt.destroy(filters.shape); Jolt.destroy(filters.body); Jolt.destroy(filters.object); Jolt.destroy(filters.broadPhase);
}

export class JoltPhysicsBackend extends PhysicsBackend {
  constructor({gravity={x:0,y:-9.81,z:0}}={}){
    super('jolt',['rigid-body','collision','scene-query','articulated-body','joints','character-controller'],{
      executionModes:['realtime','validation-only'],
      qualities:{realtime:true,deterministic:true}
    });
    this.gravity=gravity;
    this.Jolt=null;
  }

  async init(){ this.Jolt=await loadJolt(); return this; }

  createWorld(){
    if(!this.Jolt) throw new Error('JoltPhysicsBackend.init() must complete before createWorld()');
    const Jolt=this.Jolt;
    const objectFilter=new Jolt.ObjectLayerPairFilterTable(1);
    objectFilter.EnableCollision(LAYER,LAYER);
    const broadPhaseLayer=new Jolt.BroadPhaseLayer(0);
    const broadPhaseInterface=new Jolt.BroadPhaseLayerInterfaceTable(1,1);
    broadPhaseInterface.MapObjectToBroadPhaseLayer(LAYER,broadPhaseLayer);
    Jolt.destroy(broadPhaseLayer);
    const broadPhaseFilter=new Jolt.ObjectVsBroadPhaseLayerFilterTable(broadPhaseInterface,1,objectFilter,1);
    const settings=new Jolt.JoltSettings();
    settings.mObjectLayerPairFilter=objectFilter;
    settings.mBroadPhaseLayerInterface=broadPhaseInterface;
    settings.mObjectVsBroadPhaseLayerFilter=broadPhaseFilter;
    const jolt=new Jolt.JoltInterface(settings);
    Jolt.destroy(settings);
    const physicsSystem=jolt.GetPhysicsSystem();
    const gravity=new Jolt.Vec3(this.gravity.x,this.gravity.y,this.gravity.z);
    physicsSystem.SetGravity(gravity);
    Jolt.destroy(gravity);
    return {
      jolt,physicsSystem,bodyInterface:physicsSystem.GetBodyInterface(),
      bodies:new Map(),colliders:new Map(),joints:new Map(),
      nextColliderKey:1,nextJointKey:1,nextSubGroupId:1,disabledJointPairs:new Map(),
      jointFilter:null,jointFilterCapacity:0
    };
  }

  step(world,dt){
    for(const body of world.bodies.values()){
      if(!body.nextPose) continue;
      const pose=body.nextPose;
      body.nextPose=null;
      this.setBodyPose(body,{position:pose.position,rotation:pose.rotation,next:false,wake:true});
    }
    world.jolt.Step(dt,1);
  }

  debugSnapshot(world,{nativeGeometry=true}={}){
    return {
      backend:this.identity,
      // The production Jolt build does not expose its optional DebugRenderer.
      // Normalized body/collider/joint state is supplied by PhysicsSystem.
      nativeGeometry:null,
      metrics:{ bodyCount:world?.bodies?.size ?? 0, colliderCount:world?.colliders?.size ?? 0, jointCount:world?.joints?.size ?? 0 },
      nativeGeometryAvailable:false,
      nativeGeometryRequested:Boolean(nativeGeometry)
    };
  }

  dispose(world){
    if(!world) return;
    for(const joint of [...world.joints.values()]) this._removeJoint(world,joint);
    for(const body of [...world.bodies.values()]) this.removeBody(world,body);
    this.Jolt.destroy(world.jolt);
    world.bodies.clear(); world.colliders.clear(); world.joints.clear(); world.disabledJointPairs.clear();
    world.jointFilter=null; world.jointFilterCapacity=0;
  }

  createBody(world,{type='fixed',position=ZERO,rotation=IDENTITY}={}){
    const Jolt=this.Jolt;
    const empty=new Jolt.EmptyShape();
    const p=new Jolt.RVec3(...position);
    const q=new Jolt.Quat(...rotation);
    const settings=new Jolt.BodyCreationSettings(empty,p,q,motionType(Jolt,type),LAYER);
    const subGroupId=world.nextSubGroupId++;
    Jolt.destroy(p); Jolt.destroy(q);
    const native=world.bodyInterface.CreateBody(settings);
    Jolt.destroy(settings);
    world.bodyInterface.AddBody(native.GetID(),activation(Jolt,type!=='fixed'));
    const body={kind:'jolt-body',world,native,key:native.GetID().GetIndexAndSequenceNumber(),subGroupId,colliders:[],nextPose:null};
    world.bodies.set(body.key,body);
    if(world.jointFilter){
      this._ensureJointFilter(world,subGroupId+1);
      this._assignJointCollisionGroup(world,body);
    }
    return body;
  }

  removeBody(world,body){
    if(!body || !world.bodies.has(body.key)) return;
    for(const joint of [...world.joints.values()]) if(joint.parentBody===body||joint.childBody===body) this._removeJoint(world,joint);
    for(const collider of body.colliders) {
      destroyOwnedShape(collider.nativeShape);
      world.colliders.delete(collider.key);
    }
    const id=body.native.GetID();
    if(world.bodyInterface.IsAdded(id)) world.bodyInterface.RemoveBody(id);
    world.bodyInterface.DestroyBody(id);
    body.colliders.length=0;
    world.bodies.delete(body.key);
  }

  createColliders(world,body,specs=[],{mass,friction}={}){
    const Jolt=this.Jolt;
    const semantic=specs.map((spec,index)=>{
      const record={
        kind:'jolt-collider',body,index,key:world.nextColliderKey++,spec:cloneSpec(spec),
        nativeShape:createOwnedShape(Jolt,spec,index+1)
      };
      return record;
    });
    let bodyShape;
    try { bodyShape=createBodyShape(Jolt,specs); }
    catch(error){ for(const collider of semantic) destroyOwnedShape(collider.nativeShape); throw error; }

    try {
      world.bodyInterface.SetShape(body.native.GetID(),bodyShape,true,activation(Jolt,true));
    } finally { destroyOwnedShape(bodyShape); }

    for(const old of body.colliders){ destroyOwnedShape(old.nativeShape); world.colliders.delete(old.key); }
    body.colliders=semantic;
    for(const collider of semantic) world.colliders.set(collider.key,collider);

    if(friction!=null) world.bodyInterface.SetFriction(body.native.GetID(),friction);
    if(mass!=null && mass>0 && this.bodyType(body)==='dynamic') body.native.GetMotionProperties()?.ScaleToMass(mass);
    return [...semantic];
  }

  colliders(body){ return body ? [...body.colliders] : []; }
  bodyKey(body){ return body?.key ?? null; }
  colliderKey(collider){ return collider?.key ?? null; }
  colliderParent(collider){ return collider?.body ?? null; }

  colliderSnapshot(collider){
    if(!collider) return null;
    const pose=worldPoseForCollider(this.bodyPose(collider.body),collider);
    return {
      ref:collider,key:collider.key,parent:collider.body,
      position:{x:pose.position[0],y:pose.position[1],z:pose.position[2]},
      rotation:{x:pose.rotation[0],y:pose.rotation[1],z:pose.rotation[2],w:pose.rotation[3]},
      shape:shapeDescription(collider.spec),shapeRef:collider
    };
  }

  bodyType(body){ return semanticMotionType(this.Jolt,body.world.bodyInterface.GetMotionType(body.native.GetID())); }
  setBodyType(body,type){ body.world.bodyInterface.SetMotionType(body.native.GetID(),motionType(this.Jolt,type),activation(this.Jolt,true)); return true; }

  bodyPose(body,{next=false}={}){
    if(next && body.nextPose) return {position:[...body.nextPose.position],rotation:[...body.nextPose.rotation]};
    return {position:array3(body.native.GetPosition()),rotation:array4(body.native.GetRotation())};
  }

  setBodyPose(body,{position=null,rotation=null,next=false,wake=true}={}){
    if(!body) return false;
    const current=next&&body.nextPose ? body.nextPose : this.bodyPose(body);
    const target={position:position ? (Array.isArray(position)?[...position]:[position.x,position.y,position.z]) : [...current.position],
      rotation:rotation ? (Array.isArray(rotation)?[...rotation]:[rotation.x,rotation.y,rotation.z,rotation.w]) : [...current.rotation]};
    if(next){ body.nextPose=target; return true; }
    const Jolt=this.Jolt;
    const p=new Jolt.RVec3(...target.position);
    const q=new Jolt.Quat(...target.rotation);
    try { body.world.bodyInterface.SetPositionAndRotation(body.native.GetID(),p,q,activation(Jolt,wake)); }
    finally { Jolt.destroy(q); Jolt.destroy(p); }
    body.nextPose=null;
    return true;
  }

  translateBody(body,delta,{clearLinearVelocity=true,wake=true}={}){
    const pose=this.bodyPose(body);
    this.setBodyPose(body,{position:[pose.position[0]+delta[0],pose.position[1]+delta[1],pose.position[2]+delta[2]],wake});
    if(clearLinearVelocity) this.clearBodyMotion(body,{linear:true,angular:false,wake});
    return true;
  }

  clearBodyMotion(body,{wake=false,linear=true,angular=true}={}){
    const Jolt=this.Jolt;
    if(linear) withVec3(Jolt,ZERO,(v)=>body.world.bodyInterface.SetLinearVelocity(body.native.GetID(),v));
    if(angular) withVec3(Jolt,ZERO,(v)=>body.world.bodyInterface.SetAngularVelocity(body.native.GetID(),v));
    if(wake) this.wakeBody(body);
    return true;
  }

  bodyMotion(body){
    const linear=body.world.bodyInterface.GetLinearVelocity(body.native.GetID());
    const angular=body.world.bodyInterface.GetAngularVelocity(body.native.GetID());
    const lv=array3(linear),av=array3(angular);
    return {
      sleeping:!body.world.bodyInterface.IsActive(body.native.GetID()),
      linearVelocity:lv,angularVelocity:av,
      linearSpeed:Math.hypot(...lv),angularSpeed:Math.hypot(...av)
    };
  }
  wakeBody(body){ body?.world.bodyInterface.ActivateBody(body.native.GetID()); return Boolean(body); }

  _assignJointCollisionGroup(world,body){
    if(!world.jointFilter||!body) return;
    const group=new this.Jolt.CollisionGroup(world.jointFilter,1,body.subGroupId);
    try { world.bodyInterface.SetCollisionGroup(body.native.GetID(),group); }
    finally { this.Jolt.destroy(group); }
  }

  _ensureJointFilter(world,requiredCapacity){
    if(world.jointFilter&&world.jointFilterCapacity>=requiredCapacity) return;
    let capacity=Math.max(16,world.jointFilterCapacity||0);
    while(capacity<requiredCapacity) capacity*=2;
    const filter=new this.Jolt.GroupFilterTable(capacity);
    for(const key of world.disabledJointPairs.keys()){
      const [left,right]=key.split(':').map(Number);
      filter.DisableCollision(left,right);
    }
    world.jointFilter=filter;
    world.jointFilterCapacity=capacity;
    for(const body of world.bodies.values()) this._assignJointCollisionGroup(world,body);
  }

  _jointWorldFrame(parentBody,childBody,part){
    const parentPose=this.bodyPose(parentBody);
    const childPose=this.bodyPose(childBody);
    const parentAnchor=tuple3(part.joint.parentAnchor||ZERO);
    const childAnchor=tuple3(part.joint.childAnchor||ZERO);
    const parentOffset=rotateVector(parentPose.rotation,parentAnchor);
    const childOffset=rotateVector(childPose.rotation,childAnchor);
    const axis=normalized3(rotateVector(parentPose.rotation,part.joint.axis||[1,0,0]));
    return {
      parentPoint:[parentPose.position[0]+parentOffset[0],parentPose.position[1]+parentOffset[1],parentPose.position[2]+parentOffset[2]],
      childPoint:[childPose.position[0]+childOffset[0],childPose.position[1]+childOffset[1],childPose.position[2]+childOffset[2]],
      axis,normal:perpendicular3(axis)
    };
  }

  createJoint(world,part,parentBody,childBody){
    const Jolt=this.Jolt;
    const frame=this._jointWorldFrame(parentBody,childBody,part);
    let settings,native,type;
    if(part.joint.type==='revolute'){
      settings=new Jolt.HingeConstraintSettings(); type='revolute';
      settings.mSpace=Jolt.EConstraintSpace_WorldSpace;
      settings.mPoint1.Set(...frame.parentPoint); settings.mPoint2.Set(...frame.childPoint);
      settings.mHingeAxis1.Set(...frame.axis); settings.mHingeAxis2.Set(...frame.axis);
      settings.mNormalAxis1.Set(...frame.normal); settings.mNormalAxis2.Set(...frame.normal);
      if(part.joint.limits){ settings.mLimitsMin=part.joint.limits[0]; settings.mLimitsMax=part.joint.limits[1]; }
      native=Jolt.castObject(settings.Create(parentBody.native,childBody.native),Jolt.HingeConstraint);
    } else if(part.joint.type==='prismatic'){
      settings=new Jolt.SliderConstraintSettings(); type='prismatic';
      settings.mSpace=Jolt.EConstraintSpace_WorldSpace;
      settings.mAutoDetectPoint=false;
      settings.mPoint1.Set(...frame.parentPoint); settings.mPoint2.Set(...frame.childPoint);
      settings.mSliderAxis1.Set(...frame.axis); settings.mSliderAxis2.Set(...frame.axis);
      settings.mNormalAxis1.Set(...frame.normal); settings.mNormalAxis2.Set(...frame.normal);
      if(part.joint.limits){ settings.mLimitsMin=part.joint.limits[0]; settings.mLimitsMax=part.joint.limits[1]; }
      native=Jolt.castObject(settings.Create(parentBody.native,childBody.native),Jolt.SliderConstraint);
    } else {
      throw new TypeError(`JoltPhysicsBackend unsupported joint type: ${part.joint.type}`);
    }
    Jolt.destroy(settings);
    world.physicsSystem.AddConstraint(native);
    const joint={kind:'jolt-joint',key:world.nextJointKey++,type,native,parentBody,childBody,pair:pairKey(parentBody.subGroupId,childBody.subGroupId)};
    world.joints.set(joint.key,joint);
    const pairCount=world.disabledJointPairs.get(joint.pair)||0;
    world.disabledJointPairs.set(joint.pair,pairCount+1);
    this._ensureJointFilter(world,Math.max(parentBody.subGroupId,childBody.subGroupId)+1);
    if(pairCount===0) world.jointFilter.DisableCollision(parentBody.subGroupId,childBody.subGroupId);
    return joint;
  }

  _removeJoint(world,joint){
    if(!joint || !world.joints.has(joint.key)) return;
    // AddConstraint() owns the constraint reference. We never AddRef() here,
    // so RemoveConstraint() must be the only release path. Calling Release()
    // again corrupts Jolt ownership and can crash later during DestroyBody().
    world.physicsSystem.RemoveConstraint(joint.native);
    world.joints.delete(joint.key);
    const count=(world.disabledJointPairs.get(joint.pair)||1)-1;
    if(count<=0){
      world.disabledJointPairs.delete(joint.pair);
      world.jointFilter?.EnableCollision(joint.parentBody.subGroupId,joint.childBody.subGroupId);
    } else world.disabledJointPairs.set(joint.pair,count);
  }

  setJointTarget(joint,target,{stiffness=40,damping=8}={}){
    if(!joint) return false;
    const Jolt=this.Jolt;
    const motor=joint.native.GetMotorSettings();
    motor.mSpringSettings.mMode=Jolt.ESpringMode_StiffnessAndDamping;
    motor.mSpringSettings.mStiffness=stiffness;
    motor.mSpringSettings.mDamping=damping;
    joint.native.SetMotorState(Jolt.EMotorState_Position);
    if(joint.type==='revolute') joint.native.SetTargetAngle(target);
    else joint.native.SetTargetPosition(target);
    this.wakeBody(joint.parentBody); this.wakeBody(joint.childBody);
    return true;
  }

  createCharacterController(world,{
    offset=.02,autostepHeight=.3,autostepMinWidth=.2,snapToGround=.3,
    maxSlopeClimbAngle=Math.PI/4,minSlopeSlideAngle=Math.PI/6
  }={}){
    return {
      kind:'jolt-character-controller',world,
      offset,autostepHeight,autostepMinWidth,snapToGround,maxSlopeClimbAngle,minSlopeSlideAngle
    };
  }

  removeCharacterController(){ /* Stateless adapter: CharacterVirtual instances are per-move. */ }

  cancelCharacterMovement(body){
    const pose=this.bodyPose(body);
    if(!pose) return false;
    return this.setBodyPose(body,{...pose,next:true});
  }

  _characterSupportRadius(collider){
    const shape=collider?.spec;
    if(!shape) return .1;
    if(shape.shape==='capsule'||shape.shape==='cylinder') return Math.max(.01,shape.radius||.1);
    if(shape.shape==='box') return Math.max(.01,Math.min(shape.halfExtents?.[0]||.1,shape.halfExtents?.[2]||.1));
    if(shape.shape==='convexHull'&&shape.vertices?.length){
      let radius=Infinity;
      for(let i=0;i<shape.vertices.length;i+=3) radius=Math.min(radius,Math.hypot(shape.vertices[i],shape.vertices[i+2]));
      return Number.isFinite(radius)&&radius>1e-3?radius:.1;
    }
    return .1;
  }

  moveCharacter(controller,body,desiredTranslation,{predicate=null}={}){
    if(!controller||controller.world!==body?.world||this.bodyType(body)!=='kinematic'){
      return {success:false,code:'CHARACTER_BODY_UNAVAILABLE',movement:[0,0,0],grounded:false,collisions:[]};
    }
    const colliders=this.colliders(body);
    if(colliders.length!==1){
      return {success:false,code:'CHARACTER_BODY_UNAVAILABLE',movement:[0,0,0],grounded:false,collisions:[]};
    }

    const Jolt=this.Jolt,world=body.world,pose=this.bodyPose(body);
    const settings=new Jolt.CharacterVirtualSettings();
    settings.mMass=1000;
    settings.mMaxSlopeAngle=controller.maxSlopeClimbAngle;
    settings.mMaxStrength=100;
    settings.mShape=body.native.GetShape();
    settings.mCharacterPadding=controller.offset;
    settings.mPredictiveContactDistance=Math.max(.05,controller.offset*2);
    const up=new Jolt.Vec3(0,1,0);
    const supportingVolume=new Jolt.Plane(up,-this._characterSupportRadius(colliders[0]));
    settings.mSupportingVolume=supportingVolume;
    const position=new Jolt.RVec3(...pose.position);
    const rotation=new Jolt.Quat(...pose.rotation);
    const character=new Jolt.CharacterVirtual(settings,position,rotation,world.physicsSystem);
    Jolt.destroy(rotation); Jolt.destroy(position); Jolt.destroy(supportingVolume); Jolt.destroy(up); Jolt.destroy(settings);

    const update=new Jolt.ExtendedUpdateSettings();
    update.mStickToFloorStepDown.Set(0,-controller.snapToGround,0);
    update.mWalkStairsStepUp.Set(0,controller.autostepHeight,0);
    update.mWalkStairsMinStepForward=controller.autostepMinWidth;
    update.mWalkStairsStepForwardTest=Math.max(.05,controller.autostepMinWidth);
    update.mWalkStairsStepDownExtra.Set(0,-Math.min(controller.snapToGround,.1),0);

    const bpFilter=new Jolt.DefaultBroadPhaseLayerFilter(world.jolt.GetObjectVsBroadPhaseLayerFilter(),LAYER);
    const objectFilter=new Jolt.DefaultObjectLayerFilter(world.jolt.GetObjectLayerPairFilter(),LAYER);
    const bodyFilter=new Jolt.IgnoreMultipleBodiesFilter();
    bodyFilter.IgnoreBody(body.native.GetID());
    if(predicate){
      for(const otherBody of world.bodies.values()){
        if(otherBody===body||!otherBody.colliders.length) continue;
        if(otherBody.colliders.every((collider)=>!predicate(collider))) bodyFilter.IgnoreBody(otherBody.native.GetID());
      }
    }
    const shapeFilter=new Jolt.ShapeFilter();
    const zeroGravity=new Jolt.Vec3(0,0,0);
    const velocity=new Jolt.Vec3(...tuple3(desiredTranslation));
    character.SetLinearVelocity(velocity);
    Jolt.destroy(velocity);

    try {
      character.ExtendedUpdate(1,zeroGravity,update,bpFilter,objectFilter,bodyFilter,shapeFilter,world.jolt.GetTempAllocator());
      if(controller.snapToGround>0){
        const stepDown=new Jolt.Vec3(0,-controller.snapToGround,0);
        try { character.StickToFloor(stepDown,bpFilter,objectFilter,bodyFilter,shapeFilter,world.jolt.GetTempAllocator()); }
        finally { Jolt.destroy(stepDown); }
      }
      character.RefreshContacts(bpFilter,objectFilter,bodyFilter,shapeFilter,world.jolt.GetTempAllocator());
      const resultPosition=character.GetPosition();
      const next=[resultPosition.GetX(),resultPosition.GetY(),resultPosition.GetZ()];
      const movement=[next[0]-pose.position[0],next[1]-pose.position[1],next[2]-pose.position[2]];
      const collisions=[];
      const contacts=character.GetActiveContacts();
      for(let index=0;index<contacts.size();index++){
        const contact=contacts.at(index);
        const collider=this._colliderFromHit(world,contact.mBodyB,contact.mSubShapeIDB);
        if(!collider||collider.body===body||(predicate&&!predicate(collider))) continue;
        const normal=contact.mContactNormal;
        collisions.push({
          collider,colliderKey:this.colliderKey(collider),
          toi:Number.isFinite(contact.mFraction)?contact.mFraction:0,
          normal:[normal.GetX(),normal.GetY(),normal.GetZ()]
        });
      }
      this.setBodyPose(body,{position:next,rotation:pose.rotation,next:true});
      return {
        success:true,movement,
        grounded:character.GetGroundState()===Jolt.EGroundState_OnGround,
        collisions
      };
    } finally {
      Jolt.destroy(zeroGravity); Jolt.destroy(shapeFilter); Jolt.destroy(bodyFilter); Jolt.destroy(objectFilter); Jolt.destroy(bpFilter); Jolt.destroy(update); character.Release();
    }
  }

  syncSceneQueries(){ /* Jolt BodyInterface updates broadphase on pose/shape changes. */ }

  createQueryShape(spec){ return {kind:'jolt-query-shape',spec:cloneSpec(spec),nativeShape:createOwnedShape(this.Jolt,spec)}; }
  disposeQueryShape(shape){ if(shape?.kind==='jolt-query-shape'){ destroyOwnedShape(shape.nativeShape); shape.nativeShape=null; } }

  _nativeShape(ref){
    if(ref?.kind==='jolt-collider' || ref?.kind==='jolt-query-shape') return ref.nativeShape;
    throw new TypeError('JoltPhysicsBackend requires a Jolt semantic shape handle');
  }

  _colliderFromHit(world,bodyId,subShapeId){
    const body=world.bodies.get(nativeBodyIdNumber(bodyId));
    if(!body || !body.colliders.length) return null;
    if(body.colliders.length===1) return body.colliders[0];
    const userData=body.native.GetShape().GetSubShapeUserData(subShapeId);
    return body.colliders[userData-1] || null;
  }

  _allShapeHits(world,shapeRef,position,rotation,{maxSeparationDistance=0}={}){
    const Jolt=this.Jolt;
    const nativeShape=this._nativeShape(shapeRef);
    const scale=new Jolt.Vec3(...UNIT);
    const transform=createTransform(Jolt,position,rotation);
    const settings=new Jolt.CollideShapeSettings();
    settings.mMaxSeparationDistance=maxSeparationDistance;
    const baseOffset=new Jolt.RVec3(...ZERO);
    const collector=new Jolt.CollideShapeAllHitCollisionCollector();
    const filters=createQueryFilters(Jolt,world);
    try {
      world.physicsSystem.GetNarrowPhaseQuery().CollideShape(
        nativeShape,scale,transform,settings,baseOffset,collector,
        filters.broadPhase,filters.object,filters.body,filters.shape
      );
      const hits=[];
      if(collector.HadHit()){
        for(let i=0;i<collector.mHits.size();i++){
          const hit=collector.mHits.at(i);
          hits.push({
            collider:this._colliderFromHit(world,hit.mBodyID2,hit.mSubShapeID2),
            penetrationDepth:hit.mPenetrationDepth,
            normal:array3(hit.mPenetrationAxis)
          });
        }
      }
      return hits;
    } finally {
      destroyQueryFilters(Jolt,filters); Jolt.destroy(collector); Jolt.destroy(baseOffset); Jolt.destroy(settings); Jolt.destroy(transform); Jolt.destroy(scale);
    }
  }

  intersectionsWithShape(world,position,rotation,shape,callback,{excludeCollider=null,excludeBody=null,predicate=null}={}){
    const seen=new Set();
    for(const hit of this._allShapeHits(world,shape,position,rotation)){
      const collider=hit.collider;
      if(!collider || seen.has(collider.key)) continue;
      seen.add(collider.key);
      if(excludeCollider && collider.key===excludeCollider.key) continue;
      if(excludeBody && collider.body.key===excludeBody.key) continue;
      if(predicate && !predicate(collider)) continue;
      if(callback(collider)===false) break;
    }
  }

  castCollider(world,source,velocity,{excludeCollider=null,excludeBody=null,predicate=null,maxToi=1}={}){
    const Jolt=this.Jolt;
    const sourcePose=this.colliderSnapshot(source);
    const scale=new Jolt.Vec3(...UNIT);
    const transform=createTransform(Jolt,[sourcePose.position.x,sourcePose.position.y,sourcePose.position.z],sourcePose.rotation);
    const direction=new Jolt.Vec3(velocity[0],velocity[1],velocity[2]);
    const cast=new Jolt.RShapeCast(source.nativeShape,scale,transform,direction);
    const settings=new Jolt.ShapeCastSettings();
    const baseOffset=new Jolt.RVec3(...ZERO);
    const collector=new Jolt.CastShapeAllHitCollisionCollector();
    const filters=createQueryFilters(Jolt,world);
    try {
      world.physicsSystem.GetNarrowPhaseQuery().CastShape(cast,settings,baseOffset,collector,filters.broadPhase,filters.object,filters.body,filters.shape);
      let best=null;
      if(collector.HadHit()){
        for(let i=0;i<collector.mHits.size();i++){
          const hit=collector.mHits.at(i);
          if(hit.mFraction<0 || hit.mFraction>maxToi) continue;
          const collider=this._colliderFromHit(world,hit.mBodyID2,hit.mSubShapeID2);
          if(!collider || collider.key===source.key) continue;
          if(excludeCollider && collider.key===excludeCollider.key) continue;
          if(excludeBody && collider.body.key===excludeBody.key) continue;
          if(predicate && !predicate(collider)) continue;
          if(!best || hit.mFraction<best.timeOfImpact) best={collider,timeOfImpact:hit.mFraction};
        }
      }
      return best;
    } finally {
      destroyQueryFilters(Jolt,filters); Jolt.destroy(collector); Jolt.destroy(baseOffset); Jolt.destroy(settings); Jolt.destroy(cast); Jolt.destroy(direction); Jolt.destroy(transform); Jolt.destroy(scale);
    }
  }

  raycast(world,origin,direction,maxDistance,{predicate=null}={}){
    const Jolt=this.Jolt;
    const length=Math.hypot(direction[0],direction[1],direction[2]);
    if(length<=1e-12 || maxDistance<=0) return null;
    const ray=new Jolt.RRayCast();
    ray.mOrigin.Set(origin[0],origin[1],origin[2]);
    ray.mDirection.Set(direction[0]/length*maxDistance,direction[1]/length*maxDistance,direction[2]/length*maxDistance);
    const settings=new Jolt.RayCastSettings();
    const collector=new Jolt.CastRayAllHitCollisionCollector();
    const filters=createQueryFilters(Jolt,world);
    try {
      world.physicsSystem.GetNarrowPhaseQuery().CastRay(ray,settings,collector,filters.broadPhase,filters.object,filters.body,filters.shape);
      let best=null;
      if(collector.HadHit()){
        for(let i=0;i<collector.mHits.size();i++){
          const hit=collector.mHits.at(i);
          const collider=this._colliderFromHit(world,hit.mBodyID,hit.mSubShapeID2);
          if(!collider || (predicate && !predicate(collider))) continue;
          const toi=hit.mFraction*maxDistance;
          if(!best || toi<best.timeOfImpact) best={collider,timeOfImpact:toi};
        }
      }
      return best;
    } finally { destroyQueryFilters(Jolt,filters); Jolt.destroy(collector); Jolt.destroy(settings); Jolt.destroy(ray); }
  }

  contactPairs(world,source){
    const pose=this.colliderSnapshot(source);
    const hits=this._allShapeHits(world,source,[pose.position.x,pose.position.y,pose.position.z],pose.rotation,{maxSeparationDistance:1e-4});
    const byCollider=new Map();
    for(const hit of hits){
      const other=hit.collider;
      if(!other || other.body.key===source.body.key || other.key===source.key) continue;
      if(source.body.world.disabledJointPairs.has(pairKey(source.body.subGroupId,other.body.subGroupId))) continue;
      const previous=byCollider.get(other.key);
      if(!previous || hit.penetrationDepth>previous.penetrationDepth) byCollider.set(other.key,hit);
    }
    return [...byCollider.values()].map((hit)=>({
      other:hit.collider,manifoldCount:1,contactCount:1,activeContactCount:1,
      minDistance:hit.penetrationDepth>0 ? -hit.penetrationDepth : 0,totalImpulse:null,normal:hit.normal,
      evidenceKind:'geometric-contact',impulseAvailable:false
    }));
  }

  penetrations(world,source){
    const pose=this.colliderSnapshot(source);
    return this._allShapeHits(world,source,[pose.position.x,pose.position.y,pose.position.z],pose.rotation)
      .filter((hit)=>hit.collider && hit.collider.body.key!==source.body.key && hit.penetrationDepth>0)
      .map((hit)=>({other:hit.collider,distance:-hit.penetrationDepth}));
  }

  shapesIntersect(leftShape,leftPosition,leftRotation,rightShape,rightPosition,rightRotation){
    const Jolt=this.Jolt;
    const transformed=new Jolt.TransformedShape();
    transformed.set_mShape(this._nativeShape(rightShape));
    const rightPositionNative=new Jolt.RVec3(...rightPosition);
    const rightRotationNative=new Jolt.Quat(...(Array.isArray(rightRotation)?rightRotation:[rightRotation.x,rightRotation.y,rightRotation.z,rightRotation.w]));
    const scale=new Jolt.Vec3(...UNIT);
    transformed.SetWorldTransform(rightPositionNative,rightRotationNative,scale);
    const leftRotationArray=Array.isArray(leftRotation)?leftRotation:[leftRotation.x,leftRotation.y,leftRotation.z,leftRotation.w];
    const leftTransform=createTransform(Jolt,leftPosition,leftRotationArray);
    const settings=new Jolt.CollideShapeSettings();
    const baseOffset=new Jolt.RVec3(...ZERO);
    const collector=new Jolt.CollideShapeAnyHitCollisionCollector();
    const shapeFilter=new Jolt.ShapeFilter();
    try {
      transformed.CollideShape(this._nativeShape(leftShape),scale,leftTransform,settings,baseOffset,collector,shapeFilter);
      return collector.HadHit();
    } finally {
      Jolt.destroy(shapeFilter); Jolt.destroy(collector); Jolt.destroy(baseOffset); Jolt.destroy(settings); Jolt.destroy(leftTransform); Jolt.destroy(scale); Jolt.destroy(rightRotationNative); Jolt.destroy(rightPositionNative); Jolt.destroy(transformed);
    }
  }
}
