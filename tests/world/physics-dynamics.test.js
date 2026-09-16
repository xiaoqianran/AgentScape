import { describe,expect,it } from 'vitest';
import * as THREE from 'three';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { createJoltPhysicsSystem } from '../helpers/createJoltPhysicsSystem.js';

const manifest={
  id:'ball',source:{kind:'builtin'},
  physics:{
    body:'dynamic',mass:1,friction:.4,restitution:.5,
    linearDamping:.1,angularDamping:.2,gravityScale:0,
    colliders:[{shape:'box',halfExtents:[.5,.5,.5]}]
  }
};

describe.each([['rapier',createRapierPhysicsSystem],['jolt',createJoltPhysicsSystem]])('%s PhysicsSystem dynamics API',(_name,createPhysics)=>{
  it('exposes object-id motion, impulse, material and dynamics commands',async()=>{
    const physics=createPhysics();
    await physics.init();
    try {
      const object=new THREE.Object3D();
      physics.addObject('ball_01',manifest,object);
      expect(physics.setMotion('ball_01',{linearVelocity:[1,0,0]})).toBe(true);
      expect(physics.getMotion('ball_01').linearVelocity[0]).toBeCloseTo(1,5);
      expect(physics.setMaterial('ball_01',{friction:.7,restitution:.25})).toBe(true);
      expect(physics.setDynamics('ball_01',{linearDamping:.3,angularDamping:.4,gravityScale:0})).toBe(true);
      physics.setMotion('ball_01',{linearVelocity:[0,0,0],angularVelocity:[0,0,0]});
      expect(physics.applyImpulse('ball_01',[1,0,0])).toBe(true);
      expect(physics.getMotion('ball_01').linearVelocity[0]).toBeGreaterThan(.5);
    } finally { physics.dispose(); }
  });
});
