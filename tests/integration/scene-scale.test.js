import { describe, it, expect, vi } from 'vitest';
import { Object3D } from 'three';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { openScene } from '../../application/scene/SceneFacade.js';
import { parseSceneProject } from '../../application/scene/SceneProject.js';
import { openScenePackage } from '../../application/scene/ScenePackage.js';

const project = { schema: 'agentscape.scene-project', schemaVersion: 1, name: 'Scale',
  environment: { type: 'builtin', id: 'monument-hall' }, objects: [] };

describe('Scene capacity and bounded observations', () => {
  it.each([100, 1000, 10000])('queries %i lightweight records without global graph work', async count => {
    const session = createSession(null, { environmentFactory: () => createMonumentHall({ loadAssets: false }) });
    await session.world.init();
    const { world, scene } = session;
    try {
      // Deliberately logical records: no GPU geometry, physics bodies or navigation registration.
      for (let i = 0; i < count; i++) world.store.add(`entity_${i}`, {
        object: new Object3D(), assetId: 'cup', manifest: { type: 'prop' }, state: { index: i }
      });
      const graph = vi.spyOn(world.sceneGraph, 'update').mockImplementation(() => { throw Error('Global graph requested'); });
      const list = vi.spyOn(world.store, 'list').mockImplementation(() => { throw Error('Full store copied'); });
      const affordances = vi.spyOn(world.affordances, 'list').mockImplementation(() => { throw Error('Global affordances requested'); });
      const ids = new Set();
      let offset = 0;
      do {
        const page = scene.observe({ offset, limit: 73 });
        expect(page.total).toBe(count);
        expect(page.objects.length).toBeLessThanOrEqual(73);
        for (const object of page.objects) { expect(ids.has(object.id)).toBe(false); ids.add(object.id); }
        offset = page.nextOffset;
      } while (offset !== null);
      expect(ids.size).toBe(count);
      const page = scene.observe({ limit: 1 }); page.objects[0].state.index = -1;
      expect(world.store.get('entity_0').state.index).toBe(0);
      expect(scene.observe({ offset: count, limit: 10 }).objects).toEqual([]);
      expect(() => scene.observe({ limit: 1001 })).toThrow();
      expect(() => scene.observe({ offset: 1 })).toThrow('PAGE_LIMIT_REQUIRED');
      expect(() => world.store.add('entity_0', {})).toThrow('Duplicate');
      const record = world.store.get('entity_0'); world.store.delete('entity_0');
      expect(world.store.size).toBe(count - 1); world.store.add('entity_0', record);
      expect(world.store.size).toBe(count);
      graph.mockRestore(); list.mockRestore(); affordances.mockRestore();
    } finally { vi.restoreAllMocks(); scene.close(); world.dispose(); }
  });

  it('opens 100 physical objects, preserves partial batches, and restores state', async () => {
    const objects = Array.from({ length: 100 }, (_, i) => ({ id: `cup_${i}`, asset: 'builtin://cup',
      level: 'physical', transform: { position: [(i % 10) * 3, 1, Math.floor(i / 10) * 3] } }));
    const scene = await openScene({ project: { ...project, objects } });
    try {
      expect(scene.observe({ limit: 100 }).objects.every(o => o.physicsRegistered)).toBe(true);
      const saved = scene.snapshot(); saved.objects[0].state = { custom: 'preserved' };
      const result = await scene.apply({ operations: [
        { type: 'remove', id: 'cup_0' },
        { type: 'add', model: { id: 'cup_1', asset: 'builtin://cup' } },
        { type: 'remove', id: 'cup_2' }
      ] });
      expect(result.status).toBe('failed'); expect(result.value.notRun).toEqual([2]);
      expect(result.diagnostics[0].code).toBe('DUPLICATE_ID');
      expect(scene.observe({ limit: 1 }).total).toBe(99);
      await scene.restoreSnapshot(saved);
      expect(scene.observe({ limit: 1 }).objects[0].state).toEqual({ custom: 'preserved' });
      expect(scene.observe({ limit: 1 }).total).toBe(100);
      const broken = structuredClone(saved); broken.objects[0].assetId = 'missing';
      await expect(scene.restoreSnapshot(broken)).rejects.toThrow('ASSET_UNAVAILABLE');
      expect(scene.observe({ limit: 1 }).objects[0].state).toEqual({ custom: 'preserved' });
      await expect(scene.apply({ operations: Array.from({ length: 33 }, () => ({ type: 'remove', id: 'cup_0' })) })).rejects.toThrow();
      const bundle = (await scene.save()).value;
      expect(bundle.project.objects).toHaveLength(100);
      scene.close();
      const reopened = await openScenePackage(bundle);
      try {
        const restored = reopened.snapshot();
        expect(restored.objects).toEqual(saved.objects);
      } finally { reopened.close(); }
    } finally { scene.close(); }
  }, 120000);

  it('accepts 10000 project entities without changing the legacy text parsing budget', () => {
    const input = { ...project, objects: Array.from({ length: 10000 }, (_, i) => ({ id: `e_${i}`, asset: 'builtin://cup', level: 'physical' })) };
    expect(parseSceneProject(input).objects).toHaveLength(10000);
    input.objects[9999].id = 'e_0';
    expect(() => parseSceneProject(input)).toThrow('INVALID_DOCUMENT');
  });
});
