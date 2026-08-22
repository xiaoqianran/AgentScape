import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';
import { ObjectStore } from '../src/runtime/ObjectStore.js';

const manifest = {
  id: 'cabinet', type: 'cabinet', source: { kind: 'builtin' }, actions: ['open', 'close', 'move'],
  physics: { body: 'fixed', colliders: [{ shape: 'box', halfExtents: [.85, 1, .32], translation: [0, 1, -.04] }] },
  parts: {
    door: {
      node: 'doorHinge', actions: ['open', 'close'], targets: { open:-1.35, close:0 },
      physics: { body: 'dynamic', mass: 8, colliders: [{ shape: 'box', halfExtents: [.81, .95, .04], translation: [.81, 0, 0] }] },
      joint: { type: 'revolute', axis: [0, 1, 0], limits: [-1.35, 0], parentAnchor: [-.82, 1, .39], childAnchor: [0, 0, 0], motor: { stiffness: 45, damping: 9 } }
    }
  }
};

describe('PhysicsSystem articulation', () => {
  it('drives a revolute part toward the requested target', async () => {
    const physics = new PhysicsSystem();
    await physics.init();
    const root = new THREE.Group();
    const hinge = new THREE.Group();
    hinge.name = 'doorHinge';
    hinge.position.set(-.82, 1, .39);
    root.add(hinge);
    root.updateMatrixWorld(true);

    const store = new ObjectStore();
    store.add('cabinet_01', { id: 'cabinet_01', assetId: 'cabinet', object: root, manifest, state: {} });
    physics.attach('cabinet_01', manifest, root);
    expect(physics.setArticulationTarget('cabinet_01', 'door', -1)).toBe(true);

    for (let i = 0; i < 180; i++) physics.step(1 / 60, store);
    expect(Math.abs(hinge.rotation.y)).toBeGreaterThan(.2);
    expect(hinge.rotation.y).toBeGreaterThan(-1.4);
    expect(hinge.rotation.y).toBeLessThan(.1);
  });
});
