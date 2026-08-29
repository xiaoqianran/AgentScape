import { describe,expect,it } from 'vitest';
import { JoltPhysicsBackend } from '../../world/runtime/physics/JoltPhysicsBackend.js';
import { PhysicsSystem } from '../../world/runtime/systems/PhysicsSystem.js';
import {
  createConformanceWorld,declaredCapabilityMethodGaps,expectCollisionRoundTrip,expectSemanticBodyRoundTrip
} from '../helpers/physicsBackendConformance.js';
import { compileWorldPhysicsRequirements,admitWorldPhysics } from '../../world/compiler/WorldPhysicsAdmission.js';

describe('JoltPhysicsBackend',()=>{
  it('formally declares the implemented rigid, collision, query and articulation slice',()=>{
    const backend=new JoltPhysicsBackend();
    expect(backend.capabilities).toEqual(['rigid-body','collision','scene-query','articulated-body','joints','character-controller']);
    expect(backend.supportsExecutionMode('render-only')).toBe(false);
    expect(new PhysicsSystem({backend}).profile()).toMatchObject({
      backendExecutionModes:['realtime','validation-only'],
      runtimeExecutionModes:['render-only'],
      executionModes:['realtime','validation-only','render-only']
    });
    expect(backend.hasCapability('joints')).toBe(true);
    expect(backend.hasCapability('character-controller')).toBe(true);
    expect(declaredCapabilityMethodGaps(backend)).toEqual([]);
  });

  it('passes the shared rigid-body and collision semantic contract',async()=>{
    const {backend,world,dispose}=await createConformanceWorld(()=>new JoltPhysicsBackend());
    try {
      expectSemanticBodyRoundTrip(backend,world);
      expectCollisionRoundTrip(backend,world);
    } finally { dispose(); }
  });

  it('preserves collider identity through Jolt compound sub-shapes',async()=>{
    const backend=new JoltPhysicsBackend(); await backend.init(); const world=backend.createWorld();
    try {
      const body=backend.createBody(world,{type:'fixed'});
      const colliders=backend.createColliders(world,body,[
        {shape:'box',halfExtents:[.3,.3,.3],translation:[-1,0,0]},
        {shape:'box',halfExtents:[.3,.3,.3],translation:[1,0,0]}
      ]);
      expect(colliders).toHaveLength(2);
      const left=backend.raycast(world,[-1,2,0],[0,-1,0],4);
      const right=backend.raycast(world,[1,2,0],[0,-1,0],4);
      expect(left?.collider).toBe(colliders[0]);
      expect(right?.collider).toBe(colliders[1]);
      expect(backend.colliderSnapshot(colliders[1])).toMatchObject({position:{x:1,y:0,z:0},shape:{kind:'box'}});
    } finally { backend.dispose(world); }
  });

  it('executes intersections, shape cast, contacts and penetration queries semantically',async()=>{
    const backend=new JoltPhysicsBackend(); await backend.init(); const world=backend.createWorld();
    try {
      const targetBody=backend.createBody(world,{type:'fixed',position:[0,0,0]});
      const [target]=backend.createColliders(world,targetBody,[{shape:'box',halfExtents:[.5,.5,.5]}]);
      const sourceBody=backend.createBody(world,{type:'fixed',position:[-2,0,0]});
      const [source]=backend.createColliders(world,sourceBody,[{shape:'box',halfExtents:[.25,.25,.25]}]);

      const query=backend.createQueryShape({shape:'box',halfExtents:[.2,.2,.2]});
      try {
        const hits=[];
        backend.intersectionsWithShape(world,[0,0,0],[0,0,0,1],query,(collider)=>{hits.push(collider);return true;});
        expect(hits).toContain(target);

        const cast=backend.castCollider(world,source,[4,0,0],{excludeBody:sourceBody});
        expect(cast?.collider).toBe(target);
        expect(cast?.timeOfImpact).toBeGreaterThan(0);
        expect(cast?.timeOfImpact).toBeLessThan(1);

        expect(backend.shapesIntersect(query,[0,0,0],[0,0,0,1],query,[.1,0,0],[0,0,0,1])).toBe(true);
        expect(backend.shapesIntersect(query,[0,0,0],[0,0,0,1],query,[4,0,0],[0,0,0,1])).toBe(false);
      } finally { backend.disposeQueryShape(query); }

      backend.setBodyPose(sourceBody,{position:[0,0,0]});
      const contact=backend.contactPairs(world,source).find((pair)=>pair.other===target);
      expect(contact).toMatchObject({
        evidenceKind:'geometric-contact',impulseAvailable:false,totalImpulse:null,
        contactCount:1,activeContactCount:1
      });
      expect(backend.penetrations(world,source).some((hit)=>hit.other===target&&hit.distance<0)).toBe(true);
    } finally { backend.dispose(world); }
  });

  it('simulates gravity through the same backend-neutral body contract',async()=>{
    const backend=new JoltPhysicsBackend(); await backend.init(); const world=backend.createWorld();
    try {
      const floor=backend.createBody(world,{type:'fixed',position:[0,-.5,0]});
      backend.createColliders(world,floor,[{shape:'box',halfExtents:[4,.5,4]}]);
      const box=backend.createBody(world,{type:'dynamic',position:[0,3,0]});
      backend.createColliders(world,box,[{shape:'box',halfExtents:[.5,.5,.5]}],{mass:2,friction:.5});
      for(let i=0;i<240;i++) backend.step(world,1/60);
      expect(backend.bodyPose(box).position[1]).toBeGreaterThan(.45);
      expect(backend.bodyPose(box).position[1]).toBeLessThan(.56);
      expect(backend.bodyMotion(box).linearSpeed).toBeLessThan(.05);
    } finally { backend.dispose(world); }
  });


  it('supports every collider shape in the current backend-neutral manifest vocabulary',async()=>{
    const backend=new JoltPhysicsBackend(); await backend.init(); const world=backend.createWorld();
    try {
      const specs=[
        {shape:'box',halfExtents:[.2,.3,.4]},
        {shape:'cylinder',halfHeight:.3,radius:.2},
        {shape:'capsule',halfHeight:.3,radius:.2},
        {shape:'convexHull',vertices:[0,0,0, 1,0,0, 0,1,0, 0,0,1]}
      ];
      for(const spec of specs){
        const query=backend.createQueryShape(spec);
        expect(query.nativeShape).toBeTruthy();
        backend.disposeQueryShape(query);
      }
      const body=backend.createBody(world,{type:'fixed'});
      expect(backend.createColliders(world,body,specs.map((spec,index)=>({...spec,translation:[index*2,0,0]})))).toHaveLength(4);
    } finally { backend.dispose(world); }
  });

  it('admits rigid worlds and rejects capabilities outside the formal Jolt slice',()=>{
    const backend=new JoltPhysicsBackend();
    const profile=new PhysicsSystem({backend}).profile();
    const resolvedAssets=[
      {id:'rigid_01',assetRef:{assetId:'crate'}},
      {id:'door_01',assetRef:{assetId:'door'}},
      {id:'actor_01',assetRef:{assetId:'actor'}},
      {id:'preview_01',assetRef:{assetId:'preview'}}
    ];
    const getManifest=(id)=>id==='door'?{parts:{door:{joint:{type:'revolute'}}}}:{};

    const rigid=compileWorldPhysicsRequirements({entities:[{id:'rigid_01',assetRef:{assetId:'crate'},physicsRequirement:{bodyClass:'rigid',requiredCapabilities:['collision','scene-query']}}]});
    expect(admitWorldPhysics(rigid,{profile,resolvedAssets,getManifest}).status).toBe('ready');

    const articulated=compileWorldPhysicsRequirements({entities:[
      {id:'door_01',assetRef:{assetId:'door'},physicsRequirement:{bodyClass:'articulated'}}
    ]});
    expect(admitWorldPhysics(articulated,{profile,resolvedAssets,getManifest}).status).toBe('ready');

    const character=compileWorldPhysicsRequirements({entities:[
      {id:'actor_01',assetRef:{assetId:'actor'},physicsRequirement:{bodyClass:'character'}}
    ]});
    expect(admitWorldPhysics(character,{profile,resolvedAssets,getManifest}).status).toBe('ready');

    const mixed=compileWorldPhysicsRequirements({entities:[
      {id:'rigid_01',assetRef:{assetId:'crate'},physicsRequirement:{bodyClass:'rigid'}},
      {id:'preview_01',assetRef:{assetId:'preview'},physicsRequirement:{bodyClass:'transform'}}
    ]});
    expect(admitWorldPhysics(mixed,{profile,resolvedAssets,getManifest})).toMatchObject({
      status:'ready',issues:[],backend:{
        backendExecutionModes:['realtime','validation-only'],
        runtimeExecutionModes:['render-only'],
        executionModes:['realtime','validation-only','render-only']
      }
    });
  });
});
