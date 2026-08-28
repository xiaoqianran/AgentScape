import { describe,expect,it } from 'vitest';
import { PhysicsBackend,TransformPhysicsBackend } from '../src/runtime/physics/PhysicsBackend.js';
import { RapierPhysicsBackend } from '../src/runtime/physics/RapierPhysicsBackend.js';
import {
  createConformanceWorld,declaredCapabilityMethodGaps,expectCollisionRoundTrip,expectSemanticBodyRoundTrip
} from './helpers/physicsBackendConformance.js';

class LyingBackend extends PhysicsBackend {
  constructor(){ super('lying',['rigid-body']); }
  async init(){ return this; }
  createWorld(){ return {}; }
  step(){}
  dispose(){}
}

describe('PhysicsBackend conformance',()=>{
  it('rejects capability declarations that still inherit the throwing base implementation',()=>{
    expect(declaredCapabilityMethodGaps(new LyingBackend())).toContainEqual({capability:'rigid-body',method:'createBody'});
    expect(declaredCapabilityMethodGaps(new RapierPhysicsBackend())).toEqual([]);
    expect(declaredCapabilityMethodGaps(new TransformPhysicsBackend())).toEqual([]);
  });

  it('executes the Rapier lifecycle and rigid-body semantic contract',async()=>{
    const {backend,world,dispose}=await createConformanceWorld(()=>new RapierPhysicsBackend());
    try {
      expectSemanticBodyRoundTrip(backend,world);
      backend.step(world,1/60);
    } finally { dispose(); }
  });

  it('executes collision snapshots and scene queries through backend-neutral semantics',async()=>{
    const {backend,world,dispose}=await createConformanceWorld(()=>new RapierPhysicsBackend());
    try {
      expectCollisionRoundTrip(backend,world);
      backend.syncSceneQueries(world);
      const hit=backend.raycast(world,[-2,0,0],[1,0,0],5);
      expect(hit).toMatchObject({timeOfImpact:expect.any(Number),collider:expect.anything()});
      const shape=backend.createQueryShape({shape:'capsule',halfHeight:.25,radius:.2});
      try {
        let intersections=0;
        backend.intersectionsWithShape(world,[0,0,0],[0,0,0,1],shape,()=>{ intersections+=1; return true; });
        expect(intersections).toBeGreaterThan(0);
      } finally { backend.disposeQueryShape(shape); }
    } finally { dispose(); }
  });

  it('executes articulation and character-controller contracts when declared',async()=>{
    const {backend,world,dispose}=await createConformanceWorld(()=>new RapierPhysicsBackend());
    try {
      const parent=backend.createBody(world,{type:'fixed',position:[0,0,0]});
      const child=backend.createBody(world,{type:'dynamic',position:[0,1,0]});
      const joint=backend.createJoint(world,{joint:{type:'revolute',parentAnchor:[0,0,0],childAnchor:[0,-1,0],axis:[0,0,1],limits:[-1,1]}},parent,child);
      expect(backend.setJointTarget(joint,.25,{stiffness:20,damping:4})).toBe(true);

      const actor=backend.createBody(world,{type:'kinematic',position:[2,1,0]});
      backend.createColliders(world,actor,[{shape:'capsule',halfHeight:.4,radius:.25}]);
      const controller=backend.createCharacterController(world);
      try {
        expect(backend.moveCharacter(controller,actor,[.1,0,0])).toMatchObject({success:true,movement:expect.any(Array),grounded:expect.any(Boolean)});
      } finally { backend.removeCharacterController(world,controller); }
    } finally { dispose(); }
  });
});
