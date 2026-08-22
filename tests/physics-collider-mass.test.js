import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';

it('treats manifest mass as rigid-body total mass instead of duplicating it per collider', async () => {
  const physics=new PhysicsSystem(); await physics.init();
  const object=new THREE.Group(); object.updateMatrixWorld(true);
  const manifest={physics:{body:'dynamic',mass:4,colliders:[
    {shape:'box',halfExtents:[.5,.5,.5],translation:[-1,0,0]},
    {shape:'box',halfExtents:[.5,.5,.5],translation:[1,0,0]}
  ]}};
  const entry=physics.attach('x',manifest,object);
  expect(entry.body.numColliders()).toBe(2);
  expect(entry.body.collider(0).mass()).toBeCloseTo(2,6);
  expect(entry.body.collider(1).mass()).toBeCloseTo(2,6);
  expect(entry.body.mass()).toBeCloseTo(4,6);
  physics.dispose();
});
