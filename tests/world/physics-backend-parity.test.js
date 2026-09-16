import { describe,expect,it } from 'vitest';
import { RapierPhysicsBackend } from '../../modules/physics/RapierPhysicsBackend.js';
import { JoltPhysicsBackend } from '../../modules/physics/JoltPhysicsBackend.js';

const BACKENDS=[
  ['rapier',()=>new RapierPhysicsBackend({gravity:{x:0,y:0,z:0}})],
  ['jolt',()=>new JoltPhysicsBackend({gravity:{x:0,y:0,z:0}})]
];

const withWorld=async(createBackend,run)=>{
  const backend=createBackend();
  await backend.init();
  const world=backend.createWorld();
  try { return await run(backend,world); }
  finally { backend.dispose(world); }
};

const closeTo=(actual,expected,tolerance=1e-4)=>expect(Math.abs(actual-expected)).toBeLessThanOrEqual(tolerance);

describe.each(BACKENDS)('%s backend-neutral parity',(_name,createBackend)=>{
  it('keeps raycast, shape cast and penetration units consistent',async()=>{
    await withWorld(createBackend,(backend,world)=>{
      const targetBody=backend.createBody(world,{type:'fixed',position:[0,0,0]});
      const [target]=backend.createColliders(world,targetBody,[{shape:'box',halfExtents:[.5,.5,.5]}]);
      backend.syncSceneQueries(world);

      const ray=backend.raycast(world,[-2,0,0],[1,0,0],5);
      expect(ray?.collider).toBe(target);
      closeTo(ray.timeOfImpact,1.5);

      const sourceBody=backend.createBody(world,{type:'fixed',position:[-2,0,0]});
      const [source]=backend.createColliders(world,sourceBody,[{shape:'box',halfExtents:[.25,.25,.25]}]);
      backend.syncSceneQueries(world);
      const cast=backend.castCollider(world,source,[4,0,0],{excludeBody:sourceBody});
      expect(cast?.collider).toBe(target);
      closeTo(cast.timeOfImpact,.3125);

      backend.setBodyPose(sourceBody,{position:[0,0,0]});
      backend.syncSceneQueries(world);
      const penetration=backend.penetrations(world,source).find((entry)=>entry.other===target);
      expect(penetration).toBeTruthy();
      closeTo(penetration.distance,-.75,1e-3);
    });
  });

  it('keeps basic dynamics commands backend-neutral',async()=>{
    await withWorld(createBackend,(backend,world)=>{
      const body=backend.createBody(world,{type:'dynamic',position:[0,0,0]});
      backend.createColliders(world,body,[{shape:'box',halfExtents:[.5,.5,.5]}],{mass:1,friction:.4,restitution:.25});

      expect(backend.setBodyMotion(body,{linearVelocity:[1,2,3],angularVelocity:[0,.5,0]})).toBe(true);
      const motion=backend.bodyMotion(body);
      motion.linearVelocity.forEach((value,index)=>closeTo(value,[1,2,3][index],1e-4));
      motion.angularVelocity.forEach((value,index)=>closeTo(value,[0,.5,0][index],1e-4));

      expect(backend.setBodyMaterial(body,{friction:.6,restitution:.5})).toBe(true);
      expect(backend.setBodyDynamics(body,{linearDamping:.1,angularDamping:.2,gravityScale:0})).toBe(true);
      backend.setBodyMotion(body,{linearVelocity:[0,0,0],angularVelocity:[0,0,0]});
      expect(backend.applyImpulse(body,[1,0,0])).toBe(true);
      expect(backend.bodyMotion(body).linearVelocity[0]).toBeGreaterThan(.5);

      backend.setBodyMotion(body,{linearVelocity:[0,0,0],angularVelocity:[0,0,0]});
      expect(backend.applyForce(body,[6,0,0])).toBe(true);
      expect(backend.applyTorque(body,[0,3,0])).toBe(true);
      backend.step(world,1/60);
      const afterForce=backend.bodyMotion(body);
      expect(afterForce.linearVelocity[0]).toBeGreaterThan(0);
      expect(Math.abs(afterForce.angularVelocity[1])).toBeGreaterThan(0);
      backend.step(world,1/60);
      const afterSecondStep=backend.bodyMotion(body);
      expect(afterSecondStep.linearVelocity[0]).toBeLessThanOrEqual(afterForce.linearVelocity[0]+1e-3);
      expect(Math.abs(afterSecondStep.angularVelocity[1])).toBeLessThanOrEqual(Math.abs(afterForce.angularVelocity[1])+1e-3);
      expect(backend.setBodyCcd(body,true)).toBe(true);
      expect(backend.setBodySensor(body,true)).toBe(true);
      expect(backend.setBodySensor(body,false)).toBe(true);
    });
  });

  it('enforces mutual membership/filter collision permission',async()=>{
    const run=async(allowed)=>withWorld(createBackend,(backend,world)=>{
      const actor=backend.createBody(world,{type:'dynamic',position:[0,0,0]});
      backend.createColliders(world,actor,[{shape:'box',halfExtents:[.25,.25,.25]}],{mass:1});
      const wall=backend.createBody(world,{type:'fixed',position:[1,0,0]});
      backend.createColliders(world,wall,[{shape:'box',halfExtents:[.1,1,1]}]);
      backend.setBodyCollisionFilter(actor,{membership:1,filter:2});
      backend.setBodyCollisionFilter(wall,{membership:2,filter:allowed?1:4});
      backend.setBodyMotion(actor,{linearVelocity:[2,0,0],angularVelocity:[0,0,0]});
      for(let i=0;i<60;i++) backend.step(world,1/60);
      return backend.bodyPose(actor).position[0];
    });
    const blocked=await run(true);
    const passed=await run(false);
    expect(blocked).toBeLessThan(.8);
    expect(passed).toBeGreaterThan(1.2);
  });

  it('supports a fixed joint without exposing motor semantics',async()=>{
    await withWorld(createBackend,(backend,world)=>{
      const parent=backend.createBody(world,{type:'fixed',position:[0,0,0],rotation:[0,0,0,1]});
      const child=backend.createBody(world,{type:'dynamic',position:[1,0,0],rotation:[0,0,0,1]});
      backend.createColliders(world,parent,[{shape:'box',halfExtents:[.2,.2,.2]}]);
      backend.createColliders(world,child,[{shape:'box',halfExtents:[.2,.2,.2]}],{mass:1});
      const joint=backend.createJoint(world,{joint:{type:'fixed',parentAnchor:[1,0,0],childAnchor:[0,0,0]}},parent,child);
      expect(joint).toBeTruthy();
      expect(backend.setJointTarget(joint,1)).toBe(false);
      backend.applyImpulse(child,[0,4,0]);
      for(let i=0;i<10;i++) backend.step(world,1/60);
      const pose=backend.bodyPose(child);
      expect(Math.abs(pose.position[0]-1)).toBeLessThan(.05);
      expect(Math.abs(pose.position[1])).toBeLessThan(.1);
    });
  });

  it('preserves an existing relative orientation with a fixed joint',async()=>{
    await withWorld(createBackend,(backend,world)=>{
      const sy=Math.sin(Math.PI/8),cy=Math.cos(Math.PI/8);
      const sz=Math.sin(-Math.PI/10),cz=Math.cos(-Math.PI/10);
      const parent=backend.createBody(world,{type:'fixed',position:[0,0,0],rotation:[0,sy,0,cy]});
      const child=backend.createBody(world,{type:'dynamic',position:[1,0,0],rotation:[0,0,sz,cz]});
      backend.createColliders(world,parent,[{shape:'box',halfExtents:[.2,.2,.2]}]);
      backend.createColliders(world,child,[{shape:'box',halfExtents:[.2,.2,.2]}],{mass:1});
      const before=backend.bodyPose(child).rotation;
      backend.createJoint(world,{joint:{type:'fixed',parentAnchor:[0,0,0],childAnchor:[0,0,0]}},parent,child);
      for(let i=0;i<10;i++) backend.step(world,1/60);
      const after=backend.bodyPose(child).rotation;
      const dot=Math.abs(before[0]*after[0]+before[1]*after[1]+before[2]*after[2]+before[3]*after[3]);
      expect(dot).toBeGreaterThan(.999);
    });
  });

  it('preserves pending kinematic movement and wall-blocking semantics',async()=>{
    await withWorld(createBackend,(backend,world)=>{
      const floor=backend.createBody(world,{type:'fixed',position:[0,-.1,0]});
      backend.createColliders(world,floor,[{shape:'box',halfExtents:[4,.1,3]}]);
      const wall=backend.createBody(world,{type:'fixed',position:[1,1,0]});
      backend.createColliders(world,wall,[{shape:'box',halfExtents:[.1,1,1]}]);
      const actor=backend.createBody(world,{type:'kinematic',position:[0,0,0]});
      backend.createColliders(world,actor,[{shape:'capsule',halfHeight:.53,radius:.32,translation:[0,.85,0]}]);
      backend.syncSceneQueries(world);

      const controller=backend.createCharacterController(world);
      try {
        const free=backend.moveCharacter(controller,actor,[.25,-.01,0]);
        expect(free.success).toBe(true);
        closeTo(free.movement[0],.25,1e-3);
        closeTo(backend.bodyPose(actor).position[0],0,1e-6);
        closeTo(backend.bodyPose(actor,{next:true}).position[0],.25,1e-3);

        backend.step(world,1/60);
        backend.syncSceneQueries(world);
        closeTo(backend.bodyPose(actor).position[0],.25,1e-3);

        const blocked=backend.moveCharacter(controller,actor,[1,-.01,0]);
        expect(blocked.success).toBe(true);
        expect(blocked.grounded).toBe(true);
        expect(blocked.collisions.length).toBeGreaterThan(0);
        expect(blocked.movement[0]).toBeGreaterThan(.25);
        expect(blocked.movement[0]).toBeLessThan(.4);
      } finally { backend.removeCharacterController(world,controller); }
    });
  });

  it('exposes contact evidence without conflating backend-specific evidence strength',async()=>{
    await withWorld(createBackend,(backend,world)=>{
      const targetBody=backend.createBody(world,{type:'fixed',position:[0,0,0]});
      const [target]=backend.createColliders(world,targetBody,[{shape:'box',halfExtents:[.5,.5,.5]}]);
      const sourceBody=backend.createBody(world,{type:'dynamic',position:[0,0,0]});
      const [source]=backend.createColliders(world,sourceBody,[{shape:'box',halfExtents:[.25,.25,.25]}]);
      backend.syncSceneQueries(world);
      backend.step(world,1/60);
      backend.syncSceneQueries(world);

      const contact=backend.contactPairs(world,source).find((entry)=>entry.other===target);
      expect(contact).toBeTruthy();
      expect(contact.minDistance).toBeLessThanOrEqual(0);
      expect(contact.contactCount).toBeGreaterThan(0);
      expect(contact.activeContactCount).toBeGreaterThan(0);

      if(backend.identity==='rapier'){
        expect(contact).toMatchObject({evidenceKind:'solver-contact',impulseAvailable:true});
        expect(Number.isFinite(contact.totalImpulse)).toBe(true);
      } else {
        expect(contact).toMatchObject({evidenceKind:'geometric-contact',impulseAvailable:false,totalImpulse:null});
      }
    });
  });
});
