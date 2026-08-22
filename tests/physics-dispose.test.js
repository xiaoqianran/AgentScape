import { expect, it, vi } from 'vitest';
import { PhysicsSystem } from '../src/runtime/systems/PhysicsSystem.js';

it('frees the Rapier world and clears runtime entry references', () => {
  const physics = new PhysicsSystem();
  physics.entries.set('a', {});
  physics.world = { free:vi.fn() };
  physics.dispose();
  expect(physics.entries.size).toBe(0);
  expect(physics.world).toBeNull();
});
