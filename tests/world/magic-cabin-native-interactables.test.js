import { describe, expect, it } from 'vitest';
import { createMagicCabin } from '../../modules/world/content/magicCabin.js';
import { cabinCanvasHost } from '../helpers/cabinCanvasHost.js';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { WorldAffordances } from '../../modules/world/runtime/affordance/WorldAffordances.js';
import { WorldQueries } from '../../modules/world/runtime/WorldQueries.js';
import { WorldCommands } from '../../modules/world/runtime/WorldCommands.js';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../application/skills/registerCoreSkills.js';
import { PolicyEngine } from '../../foundation/PolicyEngine.js';

function cabinRuntime() {
  const cabin = createMagicCabin(cabinCanvasHost());
  const store = new ObjectStore();
  store.add('agent_01', {
    id: 'agent_01',
    assetId: 'agent',
    manifest: { id: 'agent', type: 'agent', actions: ['navigate'], physics: { body: 'kinematic' } },
    object: { position: { toArray: () => [0, 0, 6] } },
    state: {}
  });
  const feet = [0, 0, 6];
  const runtime = {
    ready: true,
    environment: cabin,
    store,
    policy: new PolicyEngine(),
    events: { emit() {} },
    mutate: async (_label, operation) => operation(),
    physics: {
      getPosition: (id) => (id === 'agent_01' ? [...feet] : null),
      hasCapability: () => true,
      raycast: () => null
    },
    spatial: { findNearby: () => [] }
  };
  runtime.affordances = new WorldAffordances(runtime);
  runtime.queries = new WorldQueries(runtime);
  runtime.commands = new WorldCommands(runtime);
  const registry = registerCoreSkills(new SkillRegistry({ policy: runtime.policy, runtime }), runtime);
  runtime.skills = registry;
  return { runtime, cabin, registry, setFeet: (next) => { feet.splice(0, feet.length, ...next); } };
}

describe('magic cabin native Three.js interactables', () => {
  it('surfaces environment.interactions through listInteractablesNearMe beyond ObjectStore assets', () => {
    const { runtime } = cabinRuntime();
    try {
      const result = runtime.queries.listInteractablesNearMe({ actorId: 'agent_01', radius: 20 });
      expect(result.environmentId).toBe('magic-cabin');
      expect(result.nativeInteractables.length).toBeGreaterThan(20);
      expect(result.summary.nativeContractLinkedCount).toBeGreaterThan(0);
      expect(result.summary.nativeOnlyCount).toBeGreaterThan(0);

      const door = result.nativeInteractables.find((entry) => String(entry.label).includes('大门'));
      expect(door).toBeTruthy();
      expect(door.contractId).toBe('cabin:front-door');
      expect(door.executeVia).toBe('executeWorldAction');
      expect(door.verification).toBe('runtime-contract');

      const seatOrProp = result.nativeInteractables.find((entry) => !entry.contractId);
      expect(seatOrProp).toBeTruthy();
      expect(seatOrProp.executeVia).toBe('activateEnvironmentInteract');
      expect(seatOrProp.verification).toBe('native-provisional');

      const catalog = runtime.queries.listEnvironmentInteractables({ actorId: 'agent_01', radius: 20 });
      expect(catalog.schema).toBe('agentscape.environment-interactables.v1');
      expect(catalog.items.length).toBe(result.nativeInteractables.length);
    } finally {
      runtime.environment.dispose();
    }
  });

  it('activates contract-linked natives through affordance verification and refuses out-of-reach natives', async () => {
    const { runtime, cabin, registry, setFeet } = cabinRuntime();
    try {
      const hinge = cabin.interactions.find((item) => item.contractId === 'cabin:front-door');
      expect(hinge).toBeTruthy();
      hinge.object.updateWorldMatrix(true, false);
      const elements = hinge.object.matrixWorld.elements;
      const doorPosition = [elements[12], elements[13], elements[14]];

      setFeet([doorPosition[0], 0, doorPosition[2] + 8]);
      const blocked = await runtime.commands.activateEnvironmentInteraction(hinge.id, { actorId: 'agent_01' });
      expect(blocked).toMatchObject({ status: 'world-action-blocked', reason: 'OUT_OF_REACH', interactionId: hinge.id });

      setFeet([doorPosition[0], 0, doorPosition[2]]);
      const pending = runtime.commands.activateEnvironmentInteraction(hinge.id, { actorId: 'agent_01' });
      for (let i = 0; i < 240; i += 1) {
        cabin.step(1 / 60);
        runtime.affordances.update(1 / 60);
        await new Promise((resolve) => setImmediate(resolve));
      }
      const activated = await pending;
      expect(activated).toMatchObject({
        status: 'world-action-completed',
        verified: true,
        targetId: 'cabin:front-door'
      });

      const nativeOnly = cabin.interactions.find((item) => !item.contractId && typeof item.activate === 'function');
      expect(nativeOnly).toBeTruthy();
      const nativeResult = await runtime.commands.activateEnvironmentInteraction(nativeOnly.id, {
        actorId: 'agent_01',
        requireReach: false
      });
      expect(nativeResult).toMatchObject({
        status: 'environment-interaction-activated',
        provisional: true,
        verification: 'native-provisional',
        physicsVerified: false
      });

      const skill = await registry.invoke('listEnvironmentInteractables', { radius: 20 }, { profile: 'viewer', actor: 'agent_01' });
      expect(skill.success).toBe(true);
      expect(skill.result.items.length).toBeGreaterThan(20);
    } finally {
      runtime.environment.dispose();
    }
  }, 20000);
});
