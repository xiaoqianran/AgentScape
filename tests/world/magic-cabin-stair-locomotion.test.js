import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createMagicCabin } from '../../modules/world/content/magicCabin.js';
import { cabinCanvasHost } from '../helpers/cabinCanvasHost.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { PhysicsSystem } from '../../modules/world/runtime/systems/PhysicsSystem.js';
import { LocomotionSystem } from '../../modules/world/runtime/systems/LocomotionSystem.js';
import { RapierPhysicsBackend } from '../../modules/physics/RapierPhysicsBackend.js';

const agentManifest = {
  id: 'agent',
  type: 'agent',
  source: { kind: 'builtin' },
  actions: ['navigate'],
  physics: {
    body: 'kinematic',
    navigationObstacle: false,
    colliders: [{ shape: 'capsule', halfHeight: 0.53, radius: 0.32, translation: [0, 0.85, 0] }]
  }
};

describe('magic cabin real KCC locomotion upstairs', () => {
  it('open door, findPath reachable, and LocomotionSystem physically walks onto 2F', async () => {
    const cabin = createMagicCabin(cabinCanvasHost());
    const store = new ObjectStore();
    const physics = new PhysicsSystem({ backend: new RapierPhysicsBackend() });
    await physics.init();
    physics.setCharacterControllerOptions(cabin.physics?.characterController || null);
    physics.addEnvironment(cabin.colliders, { id: cabin.id });

    const object = new THREE.Group();
    object.position.set(6, 0.1, -5);
    object.updateMatrixWorld(true);
    store.add('agent_01', { id: 'agent_01', assetId: 'agent', object, manifest: agentManifest, state: {} });
    physics.addObject('agent_01', agentManifest, object);

    const navigation = createRecastNavigationSystem({
      store,
      environmentRoots: [cabin.root],
      ...(cabin.navigation || {})
    });
    const locomotion = new LocomotionSystem({ store, physics, navigation });

    try {
      const door = cabin.interactions.find((item) => item.contractId === 'cabin:front-door');
      expect(door).toBeTruthy();
      door.activate();
      for (let i = 0; i < 180; i += 1) {
        cabin.step(1 / 60, { physics });
        physics.step(1 / 60, store);
      }
      navigation.invalidate('door-opened');

      const upstairs = [-2, 3.12, 0];
      const route = await navigation.findPath([6, 0.1, -5], upstairs);
      expect(route.reachable).toBe(true);

      const walk = locomotion.navigate('agent_01', upstairs, { speed: 2.0, timeout: 45 });
      let settled = null;
      for (let i = 0; i < 60 * 45; i += 1) {
        // Yield so navigate()'s findPath microtask can install the task before update().
        if (i % 5 === 0) {
          settled = await Promise.race([
            walk.then((value) => ({ done: true, value })),
            Promise.resolve(null)
          ]);
          if (settled?.done) break;
        }
        locomotion.update(1 / 60);
        physics.step(1 / 60, store);
        cabin.step(1 / 60, { physics });
        const status = locomotion.status('agent_01');
        if (status.status === 'arrived' || status.status === 'blocked' || status.status === 'cancelled' || status.status === 'unreachable') {
          settled = await Promise.race([walk.then((value) => ({ done: true, value })), Promise.resolve(null)]);
          if (settled?.done) break;
        }
      }
      const result = settled?.done
        ? settled.value
        : await Promise.race([
            walk,
            new Promise((resolve) => setTimeout(() => resolve({ status: 'TEST_TIMEOUT', position: object.position.toArray() }), 1000))
          ]);

      expect(result.status).toBe('arrived');
      expect(object.position.y).toBeGreaterThan(3.0);
      expect(object.position.y).toBeLessThan(3.3);
    } finally {
      locomotion.cancelAll?.();
      navigation.dispose?.();
      physics.dispose();
      cabin.dispose();
    }
  }, 60000);
});
