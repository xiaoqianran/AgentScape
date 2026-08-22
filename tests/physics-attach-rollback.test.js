import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';

it('removes temporary rigid bodies when attachment fails mid-construction', async () => {
  const physics = new PhysicsSystem();
  await physics.init();
  const object = new THREE.Group();
  const manifest = {
    physics: {
      body: 'fixed',
      colliders: [{ shape:'convexHull', vertices:[0,0,0, 0,0,0, 0,0,0, 0,0,0] }]
    }
  };

  expect(() => physics.attach('bad', manifest, object)).toThrow();
  expect(physics.entries.has('bad')).toBe(false);
  expect(physics.world.bodies.len()).toBe(0);
  physics.dispose();
});
