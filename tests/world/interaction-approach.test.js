import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from '../../modules/world/runtime/systems/InteractionSystem.js';

const setup = (position = [0,0,0]) => {
  const physics = { getPosition:vi.fn(() => position) };
  const locomotion = { navigate:vi.fn(async() => ({ status:'arrived' })) };
  const system = new InteractionSystem({ store:{}, physics, spatial:{}, locomotion, events:{ emit(){} } });
  return { system, locomotion };
};

describe('Interaction approach execution', () => {
  it('does not invoke locomotion for the current pose', async() => {
    const { system, locomotion } = setup();
    await expect(system.navigateToPose('agent', { status:'current-pose', position:[0,0,0] })).resolves.toBeNull();
    await expect(system.correctToPose('agent', { status:'current-pose', position:[0,0,0] })).resolves.toBeNull();
    expect(locomotion.navigate).not.toHaveBeenCalled();
  });

  it('executes an approach pose through Locomotion', async() => {
    const { system, locomotion } = setup();
    await system.navigateToPose('agent', { status:'approach-pose', position:[2,0,1] }, { speed:3 });
    expect(locomotion.navigate).toHaveBeenCalledWith('agent', [2,0,1], { speed:3 });
  });

  it('only requests precision correction outside the correction tolerance', async() => {
    const near = setup([0.02,0,0]);
    await expect(near.system.correctToPose('agent', { status:'approach-pose', position:[0,0,0] }, { speed:2 })).resolves.toBeNull();
    expect(near.locomotion.navigate).not.toHaveBeenCalled();

    const far = setup([0.08,0,0]);
    await far.system.correctToPose('agent', { status:'approach-pose', position:[0,0,0] }, { speed:2 });
    expect(far.locomotion.navigate).toHaveBeenCalledWith('agent', [0,0,0], { speed:2, waypointTolerance:0.05 });
  });
});
