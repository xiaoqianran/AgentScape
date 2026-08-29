import { expect, it, vi } from 'vitest';
import { WorldRuntime } from '../../world/runtime/WorldRuntime.js';

it('marks semantic relations dirty after physical motion without rebuilding them in the frame loop', () => {
  const runtime = {
    clock:{ getDelta:()=>1/60 },
    physics:{ step:vi.fn(() => true) },
    store:{},
    sceneGraph:{ invalidate:vi.fn(), update:vi.fn() },
    interactions:{ update:vi.fn() },
    camera:{},
    controls:{ update:vi.fn() }
  };
  WorldRuntime.prototype.update.call(runtime);
  expect(runtime.sceneGraph.invalidate).toHaveBeenCalledOnce();
  expect(runtime.sceneGraph.update).not.toHaveBeenCalled();
});
