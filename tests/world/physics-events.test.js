import { describe,expect,it } from 'vitest';
import * as THREE from 'three';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { createJoltPhysicsSystem } from '../helpers/createJoltPhysicsSystem.js';

const box=(physics={})=>({
  id:'box',source:{kind:'builtin'},
  physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.5,.5,.5]}],...physics}
});
const storeFor=(entries)=>new Map(entries.map(([id,object])=>[id,{id,object}]));

describe.each([['rapier',createRapierPhysicsSystem],['jolt',createJoltPhysicsSystem]])('%s semantic collision events',(_name,createPhysics)=>{
  it('emits sensor enter/exit without exposing native handles',async()=>{
    const physics=createPhysics();
    await physics.init();
    try {
      const sensor=new THREE.Object3D(), target=new THREE.Object3D();
      physics.addObject('sensor_01',box({sensor:true}),sensor);
      physics.addObject('target_01',box(),target);
      const store=storeFor([['sensor_01',sensor],['target_01',target]]);

      physics.step(1/60,store);
      expect(physics.getCollisionEvents()).toEqual([{
        type:'sensor-entered',
        a:expect.objectContaining({kind:'object'}),
        b:expect.objectContaining({kind:'object'})
      }]);

      physics.setPosition('target_01',[3,0,0]);
      physics.step(1/60,store);
      expect(physics.getCollisionEvents()).toEqual([{
        type:'sensor-exited',
        a:expect.objectContaining({kind:'object'}),
        b:expect.objectContaining({kind:'object'})
      }]);
    } finally { physics.dispose(); }
  });

  it('emits collision start/end only for watched solid bodies',async()=>{
    const physics=createPhysics();
    await physics.init();
    try {
      const watched=new THREE.Object3D(), target=new THREE.Object3D();
      physics.addObject('watched_01',box({body:'dynamic',gravityScale:0,collisionEvents:true}),watched);
      physics.addObject('target_01',box(),target);
      const store=storeFor([['watched_01',watched],['target_01',target]]);

      physics.step(1/60,store);
      expect(physics.getCollisionEvents().map((e)=>e.type)).toContain('collision-started');

      physics.setPosition('watched_01',[3,0,0]);
      physics.step(1/60,store);
      expect(physics.getCollisionEvents().map((e)=>e.type)).toContain('collision-ended');
    } finally { physics.dispose(); }
  });
});
