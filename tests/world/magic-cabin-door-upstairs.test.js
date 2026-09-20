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

function cabinRuntimeWithNav({ agentStart = [6, 0, -5] } = {}) {
  const cabin = createMagicCabin(cabinCanvasHost());
  const store = new ObjectStore();
  const positions = { agent_01: [...agentStart] };
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
    backendOptions: {},
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
        return { status: 'arrived', id, target: [...end], position: positions[id].map((v) => Number(v.toFixed(3))) };
      }
    }
  };
  runtime.affordances = new WorldAffordances(runtime);
  runtime.commands = new WorldCommands(runtime);
  const registry = registerCoreSkills(new SkillRegistry({ policy: runtime.policy, runtime }), runtime);
  return { runtime, cabin, navigation, registry, positions };
}

describe('magic cabin door open then upstairs navigation', () => {
  it('finds an outdoor approach to the front door, opens it, then paths upstairs', async () => {
    const { runtime, cabin, navigation, registry, positions } = cabinRuntimeWithNav({ agentStart: [6, 0, -5] });
    const doorInteraction = cabin.interactions.find((item) => item.contractId === 'cabin:front-door');
    expect(doorInteraction).toBeTruthy();
    try {
      const before = await navigation.findPath([6, 0, -5], [-2, 3.12, 0]);
      expect(before.reachable).toBe(false);

      const diagnosis = await registry.invoke('findEnvironmentInteractApproach', {
        interactionId: doorInteraction.id,
        actorId: 'agent_01'
      }, { profile: 'viewer', actor: 'agent_01' });
      expect(diagnosis.success).toBe(true);
      expect(diagnosis.result.status).toBe('approach-ready');
      expect(Array.isArray(diagnosis.result.approach)).toBe(true);

      // Studio 在并行跑固定步长仿真；测试也必须在 activate 等待 verify 时 step 弹簧/导航失效。
      let openedResult = null;
      const openedPromise = registry.invoke('approachAndActivateEnvironmentInteract', {
        interactionId: doorInteraction.id,
        actorId: 'agent_01'
      }, { profile: 'builder', actor: 'agent_01' }).then((value) => {
        openedResult = value;
        return value;
      });
      for (let i = 0; i < 300 && !openedResult; i += 1) {
        cabin.step(1 / 60);
        runtime.affordances?.update?.(1 / 60);
        await new Promise((resolve) => setImmediate(resolve));
      }
      const opened = await openedPromise;
      expect(opened.success).toBe(true);
      expect(opened.result.phase).toBe('activated');
      expect(opened.result.navigated).toBe(true);
      expect(opened.result.navigationInvalidated).toBe(true);
      expect(opened.result.status === 'world-action-completed' || opened.result.verified === true).toBe(true);

      for (let i = 0; i < 120; i += 1) {
        cabin.step(1 / 60);
        await new Promise((resolve) => setImmediate(resolve));
      }
      navigation.invalidate('door-opened');

      const upstairs = [-2, 3.12, 0];
      const after = await navigation.findPath(positions.agent_01, upstairs);
      expect(after.reachable).toBe(true);

      const walk = await runtime.locomotion.navigate('agent_01', upstairs, {});
      expect(walk.status).toBe('arrived');
      expect(positions.agent_01[1]).toBeGreaterThan(2.5);
    } finally {
      navigation.dispose?.();
      cabin.dispose();
    }
  }, 60000);
});
