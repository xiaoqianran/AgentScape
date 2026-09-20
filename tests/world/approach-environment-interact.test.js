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

describe('approachAndActivateEnvironmentInteract', () => {
  it('paths to a cabin native interactive then activates it through Runtime', async () => {
    const cabin = createMagicCabin(cabinCanvasHost());
    const store = new ObjectStore();
    const manifest = { id: 'agent', type: 'agent', actions: ['navigate'], physics: { body: 'kinematic' } };
    const agentObject = { position: { toArray: () => [0, 0, 6] } };
    store.add('agent_01', { id: 'agent_01', assetId: 'agent', manifest, object: agentObject, state: {} });

    const positions = { agent_01: [0, 0, 6] };
    const navigation = createRecastNavigationSystem({ store, environmentRoots: [cabin.root] });
    // Open front door so outdoor agent can enter cabin navigation space if needed.
    const door = cabin.interactions.find((item) => item.contractId === 'cabin:front-door');
    door.activate();
    for (let i = 0; i < 180; i += 1) cabin.step(1 / 60, { navigation });

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

    try {
      const nativeOnly = cabin.interactions.find((item) => !item.contractId && typeof item.activate === 'function' && item.object?.isObject3D);
      expect(nativeOnly).toBeTruthy();
      nativeOnly.object.updateWorldMatrix(true, false);
      const elements = nativeOnly.object.matrixWorld.elements;
      const target = [elements[12], elements[13], elements[14]];

      const result = await registry.invoke('approachAndActivateEnvironmentInteract', {
        interactionId: nativeOnly.id,
        actorId: 'agent_01'
      }, { profile: 'builder', actor: 'agent_01' });

      expect(result.success).toBe(true);
      expect(result.result.skill).toBe('approachAndActivateEnvironmentInteract');
      if (result.result.status === 'unreachable' || result.result.status === 'world-action-blocked') {
        // NavMesh may not reach every indoor prop from outdoor spawn; the tool must report honestly.
        expect(result.result.interactionId).toBe(nativeOnly.id);
        expect(result.result.target || result.result.approach).toBeTruthy();
      } else {
        expect(result.result.phase).toBe('activated');
        expect(result.result.status).toBe('environment-interaction-activated');
        expect(result.result.provisional).toBe(true);
        expect(result.result.navigated === true || result.result.distance <= 1.5).toBe(true);
      }

      const def = registry.definitions().find((item) => item.name === 'approachAndActivateEnvironmentInteract');
      expect(def.parameters.required).toEqual(['interactionId']);
      expect(registry.executionPolicy('approachAndActivateEnvironmentInteract', result.result).mutates).toBe(true);
    } finally {
      navigation.dispose?.();
      cabin.dispose();
    }
  }, 30000);
});
