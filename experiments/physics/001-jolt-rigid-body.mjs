import { performance } from 'node:perf_hooks';
import initJolt from 'jolt-physics';

const timings={};
const timed=async(name,fn)=>{
  const started=performance.now();
  try { return await fn(); }
  finally { timings[name]=Number((performance.now()-started).toFixed(3)); }
};

const totalStarted=performance.now();
const Jolt=await timed('initWasmMs',()=>initJolt());
const LAYER=0;
let jolt=null;
let floor=null;
let box=null;

const destroy=(value)=>{ if(value) Jolt.destroy(value); };
const bodyIdNumber=(body)=>body.GetID().GetIndexAndSequenceNumber();
const positionOf=(body)=>{
  const p=body.GetPosition();
  return [p.GetX(),p.GetY(),p.GetZ()];
};

try {
  jolt=await timed('createWorldMs',()=>{
    const objectFilter=new Jolt.ObjectLayerPairFilterTable(1);
    objectFilter.EnableCollision(LAYER,LAYER);

    const broadPhaseLayer=new Jolt.BroadPhaseLayer(0);
    const broadPhaseInterface=new Jolt.BroadPhaseLayerInterfaceTable(1,1);
    broadPhaseInterface.MapObjectToBroadPhaseLayer(LAYER,broadPhaseLayer);
    destroy(broadPhaseLayer);

    const broadPhaseFilter=new Jolt.ObjectVsBroadPhaseLayerFilterTable(broadPhaseInterface,1,objectFilter,1);
    const settings=new Jolt.JoltSettings();
    settings.mObjectLayerPairFilter=objectFilter;
    settings.mBroadPhaseLayerInterface=broadPhaseInterface;
    settings.mObjectVsBroadPhaseLayerFilter=broadPhaseFilter;
    const instance=new Jolt.JoltInterface(settings);
    destroy(settings);
    const gravity=new Jolt.Vec3(0,-9.81,0);
    instance.GetPhysicsSystem().SetGravity(gravity);
    destroy(gravity);
    return instance;
  });

  const physicsSystem=jolt.GetPhysicsSystem();
  const bodyInterface=physicsSystem.GetBodyInterface();

  const createBox=({position,halfExtents,motionType})=>{
    const half=new Jolt.Vec3(...halfExtents);
    const shape=new Jolt.BoxShape(half,.05,null);
    destroy(half);
    const pos=new Jolt.RVec3(...position);
    const rot=new Jolt.Quat(0,0,0,1);
    const settings=new Jolt.BodyCreationSettings(shape,pos,rot,motionType,LAYER);
    destroy(pos); destroy(rot);
    const body=bodyInterface.CreateBody(settings);
    destroy(settings);
    bodyInterface.AddBody(body.GetID(),Jolt.EActivation_Activate);
    return body;
  };

  await timed('createBodiesMs',()=>{
    floor=createBox({position:[0,-.5,0],halfExtents:[4,.5,4],motionType:Jolt.EMotionType_Static});
    box=createBox({position:[0,3,0],halfExtents:[.5,.5,.5],motionType:Jolt.EMotionType_Dynamic});
  });

  const initialPosition=positionOf(box);
  await timed('step240Ms',()=>{
    for(let i=0;i<240;i++) jolt.Step(1/60,1);
  });
  const finalPosition=positionOf(box);

  const contactEvidence=await timed('contactQueryMs',()=>{
    const scale=new Jolt.Vec3(1,1,1);
    const baseOffset=new Jolt.RVec3(0,0,0);
    const settings=new Jolt.CollideShapeSettings();
    settings.mMaxSeparationDistance=.05;
    const bpFilter=new Jolt.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(),LAYER);
    const objectFilter=new Jolt.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(),LAYER);
    const bodyFilter=new Jolt.IgnoreSingleBodyFilter(box.GetID());
    const shapeFilter=new Jolt.ShapeFilter();
    const collector=new Jolt.CollideShapeClosestHitCollisionCollector();
    try {
      physicsSystem.GetNarrowPhaseQuery().CollideShape(
        box.GetShape(),scale,box.GetCenterOfMassTransform(),settings,baseOffset,collector,
        bpFilter,objectFilter,bodyFilter,shapeFilter
      );
      return collector.HadHit() ? {
        hit:true,
        bodyId:collector.mHit.mBodyID2.GetIndexAndSequenceNumber(),
        penetrationDepth:collector.mHit.mPenetrationDepth
      } : {hit:false,bodyId:null,penetrationDepth:null};
    } finally {
      destroy(collector); destroy(shapeFilter); destroy(bodyFilter); destroy(objectFilter); destroy(bpFilter); destroy(settings); destroy(baseOffset); destroy(scale);
    }
  });

  const raycast=await timed('raycastMs',()=>{
    const ray=new Jolt.RRayCast();
    ray.mOrigin.Set(0,5,0);
    ray.mDirection.Set(0,-10,0);
    const settings=new Jolt.RayCastSettings();
    const bpFilter=new Jolt.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(),LAYER);
    const objectFilter=new Jolt.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(),LAYER);
    const bodyFilter=new Jolt.BodyFilter();
    const shapeFilter=new Jolt.ShapeFilter();
    const collector=new Jolt.CastRayClosestHitCollisionCollector();
    try {
      physicsSystem.GetNarrowPhaseQuery().CastRay(ray,settings,collector,bpFilter,objectFilter,bodyFilter,shapeFilter);
      return {
        hit:collector.HadHit(),
        fraction:collector.HadHit()?collector.mHit.mFraction:null,
        bodyId:collector.HadHit()?collector.mHit.mBodyID.GetIndexAndSequenceNumber():null
      };
    } finally {
      destroy(collector); destroy(shapeFilter); destroy(bodyFilter); destroy(objectFilter); destroy(bpFilter); destroy(settings); destroy(ray);
    }
  });

  const checks={
    fell:finalPosition[1] < initialPosition[1]-1,
    settledOnFloor:finalPosition[1] > .45 && finalPosition[1] < .56,
    contactWithFloor:contactEvidence.hit===true && contactEvidence.bodyId===bodyIdNumber(floor),
    raycastHit:raycast.hit===true,
    raycastHitBox:raycast.bodyId===bodyIdNumber(box)
  };
  timings.totalMs=Number((performance.now()-totalStarted).toFixed(3));
  const result={
    experiment:'jolt-rigid-body-minimal',engine:'jolt',initialPosition,finalPosition,contactEvidence,raycast,checks,timings
  };
  console.log(JSON.stringify(result,null,2));
  if(Object.values(checks).some((value)=>value!==true)) process.exitCode=1;
} finally {
  if(jolt){
    const bodyInterface=jolt.GetPhysicsSystem().GetBodyInterface();
    for(const body of [box,floor]){
      if(!body) continue;
      const id=body.GetID();
      bodyInterface.RemoveBody(id);
      bodyInterface.DestroyBody(id);
    }
    destroy(jolt);
  }
}
