import { describe,expect,it } from 'vitest';
import { RapierPhysicsBackend } from '../world/runtime/physics/RapierPhysicsBackend.js';
import { JoltPhysicsBackend } from '../world/runtime/physics/JoltPhysicsBackend.js';

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
