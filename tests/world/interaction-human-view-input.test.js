import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from '../../modules/world/runtime/systems/InteractionSystem.js';

describe('InteractionSystem human view input', () => {
  it('consumes explicit human view input without reading a renderer or camera', () => {
    const physics={setHeldTarget:vi.fn()};
    const system=new InteractionSystem({
      store:{has:()=>false}, physics, spatial:{}, events:{emit:vi.fn()}
    });
    system.humanHeldId='box_01';

    expect(system.setHumanViewPose({position:[0,1,2],rotation:[0,0,0,1]})).toBe(true);
    system.update(1/60);

    expect(physics.setHeldTarget).toHaveBeenCalledOnce();
    expect(physics.setHeldTarget.mock.calls[0][0]).toBe('box_01');
    expect(physics.setHeldTarget.mock.calls[0][1].toArray()).toEqual([0,1,0.3999999999999999]);

    expect(system.setHumanViewPose(null)).toBe(false);
    system.update(1/60);
    expect(physics.setHeldTarget).toHaveBeenCalledOnce();
  });
});
