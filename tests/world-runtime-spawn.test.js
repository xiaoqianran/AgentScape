import { expect, it, vi } from 'vitest';
import { WorldRuntime } from '../src/runtime/WorldRuntime.js';

it('updates the semantic scene graph immediately after direct spawn', async () => {
  const object = { position:{ fromArray:vi.fn() }, userData:{} };
  const manifest = { id:'chair', actions:['move'] };
  const runtime = {
    assets:{ instantiate:vi.fn(async () => ({ object, manifest })) },
    scene:{ add:vi.fn() },
    store:{ add:vi.fn() },
    physics:{ attach:vi.fn() },
    sceneGraph:{ update:vi.fn() },
    events:{ emit:vi.fn() }
  };
  const id = await WorldRuntime.prototype.spawn.call(runtime, 'chair', { id:'chair_01', position:[1,0,0] });
  expect(id).toBe('chair_01');
  expect(runtime.sceneGraph.update).toHaveBeenCalledOnce();
  expect(runtime.events.emit).toHaveBeenCalledWith('object.spawned', { id:'chair_01', assetId:'chair', position:[1,0,0] });
});
