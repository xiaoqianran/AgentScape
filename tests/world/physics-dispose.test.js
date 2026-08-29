import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { expect, it, vi } from 'vitest';

it('frees the Rapier world and clears runtime entry references', () => {
  const physics = createRapierPhysicsSystem();
  physics.entries.set('a', {});
  physics.world = { free:vi.fn() };
  physics.dispose();
  expect(physics.entries.size).toBe(0);
  expect(physics.world).toBeNull();
});
