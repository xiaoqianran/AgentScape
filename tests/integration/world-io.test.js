import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { WorldStorage } from '../../application/scene/WorldStorage.js';
import { WorldDiskStorage } from '../../apps/server/WorldDiskStorage.js';
import { EnvironmentPlugins } from '../../application/scene/WorldDocument.js';
import { exportWorld, prepareWorld } from '../../application/scene/WorldIO.js';

it('prepares separately, rejects budgets without mutation, and commits stable entity state', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentscape-world-io-'));
  const session = createSession(null, { environmentFactory: () => createMonumentHall({ loadAssets: false }) });
  await session.world.init();
  const { world, scene } = session;
  const plugins = new EnvironmentPlugins().register('monument-hall', { create: () => createMonumentHall({ loadAssets: false }) });
  try {
    await scene.addModel({ id: 'cup', asset: 'builtin://cup', position: [3, 1, 2] });
    world.store.get('cup').state.custom = 'saved';
    const storage = new WorldStorage(await new WorldDiskStorage(directory).initialize());
    const root = await exportWorld(world, storage);
    await scene.setTransform({ id: 'cup', transform: { position: [4, 1, 2] } });
    const before = world.snapshot();
    await expect(prepareWorld(storage, root, { plugins, maxActiveEntities: 0 })).rejects.toThrow('WORLD_ACTIVATION_BUDGET');
    expect(world.snapshot()).toEqual(before);
    const prepared = await prepareWorld(storage, root, { plugins, active: 'none' });
    expect(world.snapshot()).toEqual(before);
    await prepared.commit(world);
    expect(world.store.size).toBe(1); expect(world.store.get('cup').active).toBe(false);
    expect(world.store.get('cup').object.position.toArray()).toEqual([3, 1, 2]);
    expect(world.physics.getPosition('cup')).toBeNull();
    await world.setObjectActive('cup', true);
    expect(world.physics.getPosition('cup')).toEqual([3, 1, 2]);
    expect(world.store.get('cup').state.custom).toBe('saved');
    await world.setObjectActive('cup', false);
    expect(world.store.size).toBe(1); expect(world.physics.getPosition('cup')).toBeNull();
    await expect(prepared.commit(world)).rejects.toThrow('WORLD_PREPARED_STATE');
  } finally { scene.close(); world.dispose(); await rm(directory, { recursive: true, force: true }); }
});
