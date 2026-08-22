import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RepairEngine } from '../src/validation/RepairEngine.js';

function belowGroundRuntime({ worsen = false } = {}) {
  const object = new THREE.Group(); object.position.set(0, -0.2, 0);
  let validationCalls = 0;
  const runtime = {
    snapshot: vi.fn(() => ({ before: true })),
    restore: vi.fn(async () => {}),
    store: { get: () => ({ object }) },
    spatial: {
      getBounds: () => ({ min: [0, object.position.y, 0] }),
      isColliding: () => []
    },
    interactions: { move: vi.fn((_id, p) => object.position.fromArray(p)) },
    sceneGraph: { update: vi.fn() },
    validator: {
      run: vi.fn(() => {
        validationCalls += 1;
        return { counts: { hard: worsen ? 2 : 0, advisory: 0 }, hard: [], advisory: [] };
      })
    }
  };
  runtime.validationCalls = () => validationCalls;
  return runtime;
}

describe('RepairEngine', () => {
  it('lifts below-ground objects and accepts non-regressing repairs', async () => {
    const runtime = belowGroundRuntime();
    const engine = new RepairEngine(runtime);
    const result = await engine.repair({ counts:{hard:1,advisory:0}, hard:[{ code:'G_BELOW_GROUND', object:'a' }] });
    expect(result.accepted).toBe(true);
    expect(result.applied[0].action).toBe('lift_to_ground');
    expect(runtime.interactions.move).toHaveBeenCalled();
  });

  it('restores the snapshot if hard findings increase', async () => {
    const runtime = belowGroundRuntime({ worsen:true });
    const engine = new RepairEngine(runtime);
    const result = await engine.repair({ counts:{hard:1,advisory:0}, hard:[{ code:'G_BELOW_GROUND', object:'a' }] });
    expect(result.accepted).toBe(false);
    expect(runtime.restore).toHaveBeenCalledWith({ before:true });
  });
});
