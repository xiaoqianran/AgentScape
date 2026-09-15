import { describe, expect, it, vi } from 'vitest';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';

describe('WorldRuntime simulation boundary', () => {
  it('advances environment interactions before locomotion and physics in the same fixed tick',()=>{
    const order=[];
    const runtime={environment:{step:(dt,systems)=>{expect(dt).toBe(1/60);expect(systems.physics).toBe(runtime.physics);order.push('environment');}},locomotion:{update:()=>order.push('locomotion')},physics:{step:()=>{order.push('physics');return false;}},store:{}};
    WorldRuntime.prototype.stepSimulation.call(runtime,1/60);
    expect(order).toEqual(['environment','locomotion','physics']);
  });
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
