import { expect, it, vi } from 'vitest';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../application/skills/registerCoreSkills.js';
import { PolicyEngine } from '../../foundation/PolicyEngine.js';
import { WorldQueries } from '../../modules/world/runtime/WorldQueries.js';

const mesh = (position) => ({ position: { toArray: () => [...position] }, name: undefined });

function fixture() {
  const runtime = {
    policy: new PolicyEngine(),
    events: { emit: vi.fn() },
    mutate: vi.fn(async (_label, operation) => operation()),
    store: {
      list: () => [
        ['agent_01', {
          assetId: 'agent',
          manifest: { id: 'agent', type: 'agent', label: 'Embodied Agent', actions: ['navigate'] },
          object: mesh([0, 0, 0]),
          state: {}
        }],
        ['cup_01', {
          assetId: 'cup',
          manifest: {
            id: 'cup',
            type: 'cup',
            label: 'Cup',
            actions: ['pickup', 'drop', 'place', 'move']
          },
          object: mesh([1, 0, 0]),
          state: {}
        }],
        ['table_01', {
          assetId: 'table',
          manifest: {
            id: 'table',
            type: 'table',
            label: 'Table',
            actions: ['move'],
            surfaces: [{ id: 'top', localPosition: [0, 1, 0], size: [1, 1] }]
          },
          object: mesh([2, 0, 0]),
          state: {}
        }],
        ['cabinet_01', {
          assetId: 'cabinet',
          manifest: {
            id: 'cabinet',
            type: 'cabinet',
            label: 'Cabinet',
            actions: ['move'],
            parts: {
              door: {
                node: 'doorHinge',
                actions: ['open', 'close'],
                targets: { open: -1.2, close: 0 },
                joint: { type: 'revolute', axis: [0, 1, 0] },
                physics: { body: 'dynamic' }
              }
            }
          },
          object: mesh([0, 0, 2.4]),
          state: {}
        }],
        ['far_box', {
          assetId: 'box',
          manifest: { id: 'box', type: 'object', label: 'Far Box', actions: ['pickup'] },
          object: mesh([9, 0, 0]),
          state: {}
        }]
      ],
      has: vi.fn((id) => id === 'agent_01'),
      get: vi.fn()
    },
    physics: {
      getPosition: vi.fn((id) => {
        const positions = {
          agent_01: [0, 0, 0],
          cup_01: [1, 0, 0],
          table_01: [2, 0, 0],
          cabinet_01: [0, 0, 2.4],
          far_box: [9, 0, 0]
        };
        return positions[id] || null;
      })
    },
    spatial: {
      findNearby: vi.fn(() => [
        { id: 'cup_01', asset: 'cup', distance: 1 },
        { id: 'table_01', asset: 'table', distance: 2 },
        { id: 'cabinet_01', asset: 'cabinet', distance: 2.4 }
      ])
    },
    affordances: {
      list: vi.fn(() => ({
        schema: 'agentscape.affordances.v1',
        total: 2,
        entities: [
          {
            id: 'cabin:front-door',
            label: 'Front Door',
            kind: 'door',
            position: [0.4, 1, 2.2],
            evidenceKind: 'animated-transform',
            physicsVerified: false,
            actions: [{ action: 'open', available: true, distance: 2.1 }, { action: 'close', available: false, distance: 2.1, reason: 'OUT_OF_REACH' }]
          },
          {
            id: 'cabin:table-lamp',
            label: 'Table Lamp',
            kind: 'lamp',
            position: [20, 1, 0],
            evidenceKind: 'device-state',
            physicsVerified: false,
            actions: [{ action: 'turn_on', available: false, distance: 20, reason: 'OUT_OF_REACH' }]
          }
        ]
      }))
    }
  };
  runtime.queries = new WorldQueries(runtime);
  const registry = registerCoreSkills(new SkillRegistry({ policy: runtime.policy, runtime }), runtime);
  return { runtime, registry };
}

it('merges nearby ObjectStore interactables with affordance contracts for near-me questions', async () => {
  const { runtime, registry } = fixture();
  const result = await registry.invoke(
    'listInteractablesNearMe',
    { actorId: 'agent_01', radius: 3 },
    { profile: 'viewer', actor: 'agent_01' }
  );

  expect(result.success).toBe(true);
  expect(result.result).toMatchObject({
    schema: 'agentscape.interactables-near-me.v1',
    status: 'interactables-near-me',
    actorId: 'agent_01',
    radius: 3,
    position: [0, 0, 0]
  });

  const { objects, interactables, affordances, summary } = result.result;
  expect(objects.map((entry) => entry.id)).toEqual(['cup_01', 'table_01', 'cabinet_01']);
  expect(objects.find((entry) => entry.id === 'far_box')).toBeUndefined();

  const cup = interactables.find((entry) => entry.id === 'cup_01');
  expect(cup.interactiveActions).toEqual(['pickup', 'drop', 'place']);

  const table = interactables.find((entry) => entry.id === 'table_01');
  expect(table.canPlaceOnto).toBe(true);
  expect(table.surfaces).toEqual(['top']);

  const cabinet = interactables.find((entry) => entry.id === 'cabinet_01');
  expect(cabinet.partActions).toEqual([
    { partName: 'door', action: 'open', target: -1.2 },
    { partName: 'door', action: 'close', target: 0 }
  ]);

  expect(affordances.map((entry) => entry.id)).toEqual(['cabin:front-door']);
  expect(affordances[0]).toMatchObject({ available: true, distance: 2.1 });
  expect(summary).toMatchObject({
    objectCount: 3,
    interactableCount: 3,
    affordanceCount: 1,
    inReachAffordanceCount: 1
  });
  expect(runtime.spatial.findNearby).toHaveBeenCalledWith('agent_01', 3);
  expect(runtime.affordances.list).toHaveBeenCalledWith({ actorId: 'agent_01', limit: 50 });
  expect(registry.executionPolicy('listInteractablesNearMe', result.result).outcome).toMatchObject({
    state: 'accepted',
    verified: null
  });
});

it('defaults actorId to the invoking actor and validates the tool contract', async () => {
  const { registry } = fixture();
  const definition = registry.definitions().find((item) => item.name === 'listInteractablesNearMe');
  expect(definition.parameters.required).toEqual([]);
  expect(definition.parameters.properties.radius.maximum).toBe(20);

  const result = await registry.invoke('listInteractablesNearMe', { radius: 3 }, { profile: 'viewer', actor: 'agent_01' });
  expect(result.success).toBe(true);
  expect(result.result.actorId).toBe('agent_01');

  const missing = await registry.invoke('listInteractablesNearMe', {}, { profile: 'viewer', actor: 'ghost' });
  expect(missing.success).toBe(true);
  expect(missing.result).toMatchObject({ status: 'actor-not-found', actorId: 'ghost' });
});
