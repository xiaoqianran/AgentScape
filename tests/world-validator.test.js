import { describe, expect, it } from 'vitest';
import { WorldValidator } from '../src/validation/WorldValidator.js';

function runtime({ below = false, collision = false } = {}) {
  return {
    listObjects: () => [{ id: 'a' }, { id: 'b' }],
    spatial: {
      getBounds: (id) => ({ min: [0, below && id === 'a' ? -0.2 : 0, 0], max: [1,1,1], center: [.5,.5,.5], size:[1,1,1] }),
      isColliding: (id) => collision && id === 'a' ? ['b'] : collision && id === 'b' ? ['a'] : []
    },
    sceneGraph: { update: () => [], list: () => [] },
    interactions: { heldId: null }
  };
}

describe('WorldValidator', () => {
  it('reports below-ground and overlap findings as hard failures', () => {
    const report = new WorldValidator(runtime({ below: true, collision: true })).run();
    expect(report.ok).toBe(false);
    expect(report.hard.map((x) => x.code)).toEqual(expect.arrayContaining(['G_BELOW_GROUND', 'P_OVERLAP']));
  });

  it('returns stable count/coverage structure', () => {
    const report = new WorldValidator(runtime()).run();
    expect(report.counts).toHaveProperty('hard');
    expect(report.coverage.objects).toBe(2);
  });
});
