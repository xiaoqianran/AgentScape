import { describe, expect, it } from 'vitest';
import { createMagicCabin } from '../../modules/world/content/magicCabin.js';
import { cabinCanvasHost } from '../helpers/cabinCanvasHost.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { WorldAffordances } from '../../modules/world/runtime/affordance/WorldAffordances.js';
import { WorldCommands } from '../../modules/world/runtime/WorldCommands.js';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../application/skills/registerCoreSkills.js';
import { PolicyEngine } from '../../foundation/PolicyEngine.js';

describe('magic cabin spiral stair navmesh', () => {
  it('keeps stairs connected after door activation rebuilds NavMesh without manual invalidate', async () => {
    const cabin = createMagicCabin(cabinCanvasHost());
    const store = new ObjectStore();
    const positions = { agent_01: [6, 0, -5] };
    store.add('agent_01', {
      id: 'agent_01',
      assetId: 'agent',
      manifest: { id: 'agent', type: 'agent', actions: ['navigate'], physics: { body: 'kinematic' } },
      object: { position: { toArray: () => [...positions.agent_01] } },
      state: {}
    });
    const navigation = createRecastNavigationSystem({
      store,
      environmentRoots: [cabin.root],
      ...(cabin.navigation || {})
    });
    const runtime = {
      ready: true,
      environment: cabin,
      store,
      policy: new PolicyEngine(),
      events: { emit() {} },
      mutate: async (_label, operation) => operation(),
      physics: {
        getPosition: (id) => (positions[id] ? [...positions[id]] : null),
        hasCapability: () => true,
        raycast: () => null
      },
      navigation,
      locomotion: {
        navigate: async (id, end) => {
          positions[id] = [...end];
          return { status: 'arrived', id, target: [...end], position: positions[id] };
        }
      }
    };
    runtime.affordances = new WorldAffordances(runtime);
    runtime.commands = new WorldCommands(runtime);
    const registry = registerCoreSkills(new SkillRegistry({ policy: runtime.policy, runtime }), runtime);

    try {
      const upstairs = [-2, 3.12, 0];
      const closed = await navigation.findPath(positions.agent_01, upstairs);
      expect(closed.reachable).toBe(false);

      const door = cabin.interactions.find((item) => item.contractId === 'cabin:front-door');
      expect(door).toBeTruthy();

      let openedResult = null;
      const openedPromise = registry.invoke('approachAndActivateEnvironmentInteract', {
        interactionId: door.id,
        actorId: 'agent_01'
      }, { profile: 'builder', actor: 'agent_01' }).then((value) => {
        openedResult = value;
        return value;
      });
      for (let i = 0; i < 300 && !openedResult; i += 1) {
        cabin.step(1 / 60);
        runtime.affordances.update(1 / 60);
        await new Promise((resolve) => setImmediate(resolve));
      }
      const opened = await openedPromise;
      expect(opened.success).toBe(true);
      expect(opened.result.phase).toBe('activated');
      expect(opened.result.navigationInvalidated).toBe(true);
      expect(opened.result.navigationBuild?.success).toBe(true);

      // 关键：不手动 navigation.invalidate，activate 之后路径应已连通。
      const after = await navigation.findPath(positions.agent_01, upstairs);
      expect(after.reachable).toBe(true);

      const mid = await navigation.findPath(positions.agent_01, [1.0, 1.6, -1.0], { maxSnapDistance: 1.0 });
      expect(mid.reachable).toBe(true);
    } finally {
      navigation.dispose?.();
      cabin.dispose();
    }
  }, 30000);
});
