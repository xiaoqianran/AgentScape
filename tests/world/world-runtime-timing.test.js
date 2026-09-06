import { describe, expect, it, vi } from 'vitest';
import { WorldRuntime } from '../../world/runtime/WorldRuntime.js';

describe('WorldRuntime simulation boundary', () => {
  it('preserves locomotion → physics → interaction order inside one fixed simulation tick', () => {
    const order=[];
    const runtime = {
      locomotion:{ update:vi.fn(()=>order.push('locomotion')) },
      physics:{ step:vi.fn(()=>{order.push('physics'); return true;}) },
      store:{},
      sceneGraph:{ invalidate:vi.fn(()=>order.push('invalidate')) },
      interactions:{ update:vi.fn(()=>order.push('interaction')) }
    };

    WorldRuntime.prototype.stepSimulation.call(runtime, 1/60);

    expect(runtime.locomotion.update).toHaveBeenCalledWith(1/60);
    expect(runtime.physics.step).toHaveBeenCalledWith(1/60,runtime.store);
    expect(runtime.interactions.update).toHaveBeenCalledWith(1/60);
    expect(order).toEqual(['locomotion','physics','invalidate','interaction']);
  });
});
