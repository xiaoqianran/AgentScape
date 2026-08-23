import * as THREE from 'three';
import { expect, it } from 'vitest';
import { ObjectStore } from '../src/runtime/ObjectStore.js';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';

it('uses Environment Pack colliders as real fixed Rapier geometry', async () => {
  const physics = new PhysicsSystem();
  await physics.init();
  physics.addEnvironment([
    { shape:'box', halfExtents:[3,.1,3], translation:[0,-.1,0] },
    { shape:'box', halfExtents:[.1,1,1], translation:[0,1,0] }
  ]);

  const object = new THREE.Group();
  object.position.set(-1, .5, 0);
  object.updateMatrixWorld(true);
  const manifest={physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.2,.2,.2]}]}};
  const store=new ObjectStore();
  store.add('probe',{id:'probe',assetId:'probe',object,manifest,state:{}});
  const entry=physics.attach('probe',manifest,object);
  entry.body.setLinvel({x:2,y:0,z:0},true);
  for(let i=0;i<120;i++) physics.step(1/60,store);

  expect(object.position.y).toBeGreaterThanOrEqual(.18);
  expect(object.position.x).toBeLessThan(-.15);
  physics.dispose();
});

it('applies quaternion rotation to Environment Pack colliders', async () => {
  const physics=new PhysicsSystem();
  await physics.init();
  const angle=Math.PI/2;
  physics.addEnvironment([{shape:'box',halfExtents:[2,1,.1],translation:[0,1,0],rotation:[0,Math.sin(angle/2),0,Math.cos(angle/2)]}]);
  const rotations=[];
  physics.world.forEachCollider((collider)=>rotations.push(collider.rotation()));
  expect(rotations).toHaveLength(1);
  expect(Math.abs(rotations[0].y)).toBeGreaterThan(.7);
  expect(Math.abs(rotations[0].w)).toBeGreaterThan(.7);
  physics.dispose();
});
