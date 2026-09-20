import { expect, it, vi } from 'vitest';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../application/skills/registerCoreSkills.js';
import { PolicyEngine } from '../../foundation/PolicyEngine.js';
import { WorldCommands } from '../../modules/world/runtime/WorldCommands.js';

function agentRuntime({ position = [0, 0, 0], rotation = [0, 0, 0, 1], navigateResult } = {}) {
  const runtime = {
    ready: true,
    policy: new PolicyEngine(),
    events: { emit: vi.fn() },
    store: {
      has: vi.fn((id) => id === 'agent_01'),
      get: vi.fn((id) => ({
        id,
        assetId: 'agent',
        manifest: {
          type: 'agent',
          actions: ['navigate'],
          physics: { body: 'kinematic' }
        },
        state: {}
      }))
    },
    physics: {
      getPosition: vi.fn(() => [...position]),
      getRotation: vi.fn(() => [...rotation])
    },
    locomotion: {
      navigate: vi.fn(async () => navigateResult || {
        status: 'arrived',
        id: 'agent_01',
        position: [0, 0, -0.8]
      })
    },
    mutate: vi.fn(async (_label, operation) => operation())
  };
  runtime.commands = new WorldCommands(runtime);
  runtime.queries = { listInteractablesNearMe: vi.fn() };
  return runtime;
}

it('computes forward endpoint from Runtime character yaw and keeps moveForward inside mutate', async () => {
  const runtime = agentRuntime();
  const registry = registerCoreSkills(new SkillRegistry({ policy: runtime.policy, runtime }), runtime);
  const result = await registry.invoke('moveForward', { id: 'agent_01', distance: 0.8 }, { profile: 'builder', actor: 'agent_01' });

  expect(result.success).toBe(true);
  expect(runtime.locomotion.navigate).toHaveBeenCalledWith('agent_01', [0, 0, -0.8], { speed: undefined });
  expect(result.result).toMatchObject({
    skill: 'moveForward',
    status: 'arrived',
    start: [0, 0, 0],
    end: [0, 0, -0.8],
    distance: 0.8,
    forward: [0, 0, -1],
    moved: 0.8
  });
  expect(runtime.mutate).toHaveBeenCalledWith(
    'skill:moveForward',
    expect.any(Function),
    expect.objectContaining({ skill: 'moveForward', source: 'agent_01' })
  );
  expect(registry.executionPolicy('moveForward', result.result)).toMatchObject({
    mutates: true,
    barrier: true,
    batchable: false,
    outcome: { state: 'verified', status: 'arrived' }
  });
});

it('refuses to mark near-zero displacement as verified arrival', async () => {
  const runtime = agentRuntime({
    navigateResult: { status: 'arrived', id: 'agent_01', position: [0, 0, -0.02] }
  });
  const registry = registerCoreSkills(new SkillRegistry({ policy: runtime.policy, runtime }), runtime);
  const result = await registry.invoke('moveForward', { id: 'agent_01', distance: 0.8 }, { profile: 'builder', actor: 'agent_01' });

  expect(result.success).toBe(true);
  expect(result.result).toMatchObject({
    status: 'blocked',
    reason: 'INSUFFICIENT_FORWARD_DISPLACEMENT',
    moved: 0.02
  });
  expect(registry.executionPolicy('moveForward', result.result).outcome).toMatchObject({
    state: 'blocked',
    verified: false
  });
});

it('exposes moveForward as a relative-movement contract that does not accept invented targets', async () => {
  const runtime = agentRuntime();
  const registry = registerCoreSkills(new SkillRegistry({ policy: runtime.policy, runtime }), runtime);
  const definition = registry.definitions().find((item) => item.name === 'moveForward');

  expect(definition.parameters.required).toEqual(['id']);
  expect(definition.parameters.properties).not.toHaveProperty('end');
  expect(definition.parameters.properties.distance).toMatchObject({ type: 'number', maximum: 4 });
  expect(definition.description).toContain('模型不得编造绝对坐标');

  const invalid = await registry.invoke('moveForward', { id: 'agent_01', distance: 9 }, { profile: 'builder' });
  expect(invalid.success).toBe(false);
  expect(invalid.error.message).toContain('distance must be within');
  expect(runtime.locomotion.navigate).not.toHaveBeenCalled();
});
