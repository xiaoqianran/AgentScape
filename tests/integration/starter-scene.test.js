import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openStarterScene } from '../../application/scene/StarterScene.js';

const project = JSON.parse(await readFile(new URL('../../apps/starter/scene.json', import.meta.url), 'utf8'));
async function complete(scene, promise) {
  let done = false;
  const observed = promise.finally(() => { done = true; });
  for (let tick = 0; !done && tick < 12000; tick++) {
    scene.step();
    if (tick % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    else await Promise.resolve();
  }
  expect(done, 'Action should settle within the simulation budget').toBe(true);
  return observed;
}
describe('experimental starter scene', () => {
  it('runs real pickup/place, exports and restores in a fresh runtime', async () => {
    const scene = await openStarterScene({ project });
    let restored;
    try {
      expect(scene.observe().objects.every(o => o.physicsRegistered)).toBe(true);
      const pickup = await complete(scene, scene.interact({ action: 'pickup', actorId: 'helper', targetId: 'mug' }));
      expect(pickup.verified).toBe(true);
      await expect(scene.move({ id: 'mug', position: [0, 0, 4] })).rejects.toMatchObject({ code: 'OBJECT_HELD' });
      const place = await complete(scene, scene.interact({ action: 'place', actorId: 'helper', targetId: 'desk', surfaceId: 'top' }));
      expect(place.verified).toBe(true);
      expect(place.result.supportVerified).toBe(true);
      await scene.add({ id: 'seat', asset: 'chair', position: [-4, 0, 3] });
      await scene.move({ id: 'seat', position: [-3, 0, 6] });
      const save = JSON.parse(JSON.stringify(scene.save()));
      restored = await openStarterScene({ project });
      await restored.load(save);
      expect(restored.observe().objects).toHaveLength(4);
      expect(restored.observe().objects.find(o => o.id === 'seat').position).toEqual([-3, 0, 6]);
      expect(restored.observe().relations).toEqual(expect.arrayContaining([expect.objectContaining({ subject: 'mug', predicate: 'ON', object: 'desk' })]));
      const before = restored.save().objects;
      const bad = structuredClone(save); bad.objects[0].assetId = 'https://invalid.example/model.glb';
      await expect(restored.load(bad)).rejects.toThrow();
      expect(restored.save().objects).toEqual(before);
      const badCamera = structuredClone(save); badCamera.camera = { position: ['bad', 0, 0], target: [0, 0, 0] };
      await expect(restored.load(badCamera)).rejects.toThrow();
      expect(restored.save().objects).toEqual(before);
    } finally { scene.close(); restored?.close(); }
    expect(() => scene.observe()).toThrow('SCENE_CLOSED');
  }, 60000);
  it('rejects invalid projects and concurrent edits without corrupting the world', async () => {
    await expect(openStarterScene({ project: { ...project, objects: [project.objects[0], project.objects[0]] } })).rejects.toThrow();
    const scene = await openStarterScene({ project });
    try {
      const pending = scene.interact({ action: 'pickup', actorId: 'helper', targetId: 'mug' });
      await expect(scene.add({ id: 'seat', asset: 'chair', position: [-4, 0, 3] })).rejects.toMatchObject({ code: 'SCENE_BUSY' });
      expect(() => scene.save()).toThrow('SCENE_BUSY');
      expect(() => scene.close()).toThrow('SCENE_BUSY');
      await complete(scene, pending);
      await expect(scene.add({ id: 'seat', asset: 'chair', position: [NaN, 0, 3] })).rejects.toThrow();
      expect(scene.observe().objects).toHaveLength(3);
    } finally { scene.close(); }
  }, 60000);
});
