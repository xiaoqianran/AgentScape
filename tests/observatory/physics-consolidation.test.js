import { describe, expect, it } from 'vitest';
import { studioScenarios } from '../../apps/observatory/labs/physics-studio/scenarios/index.js';
import { physicsScenarios } from '../../apps/observatory/labs/physics/scenarios/index.js';
import { PhysicsStudioLab } from '../../apps/observatory/labs/physics-studio/PhysicsStudioLab.js';
import { PhysicsStudioCompareLab } from '../../apps/observatory/labs/physics-studio/PhysicsStudioCompareLab.js';
import { PhysicsLab } from '../../apps/observatory/labs/physics/PhysicsLab.js';
import { PhysicsCompareLab } from '../../apps/observatory/labs/physics/PhysicsCompareLab.js';

describe('Physics Studio consolidation invariants', () => {
  it('reuses every physics scenario rather than cloning its implementation', () => {
    expect(studioScenarios.slice(0, physicsScenarios.length)).toEqual(physicsScenarios);
    for (let i = 0; i < physicsScenarios.length; i++) {
      expect(studioScenarios[i]).toBe(physicsScenarios[i]);
    }
    expect(new Set(studioScenarios.map((item) => item.id)).size).toBe(studioScenarios.length);
  });

  it('inherits the standard simulation and compare renderers', () => {
    expect(PhysicsStudioLab.prototype).toBeInstanceOf(PhysicsLab);
    expect(PhysicsStudioCompareLab.prototype).toBeInstanceOf(PhysicsCompareLab);
  });
});
