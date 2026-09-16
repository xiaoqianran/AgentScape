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

      physics.setMotion('ball_01',{linearVelocity:[0,0,0],angularVelocity:[0,0,0]});
      expect(physics.applyForce('ball_01',[6,0,0])).toBe(true);
      expect(physics.applyTorque('ball_01',[0,3,0])).toBe(true);
      expect(physics.setCcd('ball_01',true)).toBe(true);
      expect(physics.setSensor('ball_01',true)).toBe(true);
      expect(physics.setSensor('ball_01',false)).toBe(true);
      physics.backend.step(physics.world,1/60);
      expect(physics.getMotion('ball_01').linearVelocity[0]).toBeGreaterThan(0);
      expect(Math.abs(physics.getMotion('ball_01').angularVelocity[1])).toBeGreaterThan(0);
    } finally { physics.dispose(); }
  });

  it('supports sleep/wake and creation-time axis locks',async()=>{
    const physics=createPhysics();
    await physics.init();
    try {
      const object=new THREE.Object3D();
      physics.addObject('locked',{...manifest,physics:{...manifest.physics,canSleep:true,lockTranslation:[true,false,false],lockRotation:[false,true,false]}},object);
      expect(physics.sleep('locked')).toBe(true);
      expect(physics.getMotion('locked').sleeping).toBe(true);
      expect(physics.wake('locked')).toBe(true);
      expect(physics.getMotion('locked').sleeping).toBe(false);
      physics.applyImpulse('locked',[4,4,0]);
      physics.applyTorque('locked',[0,4,4]);
      physics.backend.step(physics.world,1/60);
      const motion=physics.getMotion('locked');
      expect(Math.abs(motion.linearVelocity[0])).toBeLessThan(1e-4);
      expect(motion.linearVelocity[1]).toBeGreaterThan(.1);
      expect(Math.abs(motion.angularVelocity[1])).toBeLessThan(1e-4);
      expect(Math.abs(motion.angularVelocity[2])).toBeGreaterThan(.01);
    } finally { physics.dispose(); }
  });
});
