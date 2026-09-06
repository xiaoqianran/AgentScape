import { expect, it, vi } from 'vitest';
import { WorldRuntime } from '../../world/runtime/WorldRuntime.js';

it('marks semantic relations dirty after physical motion without rebuilding them in the fixed tick', () => {
  const runtime = {
    locomotion:{ update:vi.fn() },
    physics:{ step:vi.fn(() => true) },
    store:{},
    sceneGraph:{ invalidate:vi.fn(), update:vi.fn() },
    interactions:{ update:vi.fn() },
    rendering:{ viewPose:vi.fn(()=>null) }
  };
  WorldRuntime.prototype.stepSimulation.call(runtime,1/60);
  expect(runtime.sceneGraph.invalidate).toHaveBeenCalledOnce();
  expect(runtime.sceneGraph.update).not.toHaveBeenCalled();
});
