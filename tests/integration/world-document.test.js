import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openScene } from '../../application/scene/SceneFacade.js';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { WorldStorage } from '../../application/scene/WorldStorage.js';
import { WorldDiskStorage } from '../../apps/server/WorldDiskStorage.js';
import { writeWorldDocument, inspectWorldDocument, EnvironmentPlugins } from '../../application/scene/WorldDocument.js';

it('stores runtime entities as immutable pages and requires an explicitly registered environment', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentscape-document-'));
  const session = createSession(null, { environmentFactory: () => createMonumentHall({ loadAssets: false }) });
  await session.world.init();
  try {
    for (let i = 0; i < 140; i++) await session.scene.addModel({ id: `cup_${i}`, asset: 'builtin://cup', position: [i * 2, 1, 0] });
    const storage = new WorldStorage(await new WorldDiskStorage(directory).initialize());
    const root = await writeWorldDocument(session.world, storage);
    const plugins = new EnvironmentPlugins().register('monument-hall', { create: () => createMonumentHall({ loadAssets: false }) });
    const document = await inspectWorldDocument(storage, root, { plugins });
    const entities = [];
    for await (const page of storage.pages(document.entities, 'entities')) entities.push(...page);
    expect(entities).toHaveLength(140);
    expect(entities.sort((a, b) => a.ordinal - b.ordinal).map(({ ordinal, ...entity }) => entity)).toEqual(session.world.snapshot().objects);
    const assets = [];
    for await (const page of storage.pages(document.assets, 'assets')) assets.push(...page);
    expect(assets).toEqual([{ id: 'cup', builtin: true }]);
    await expect(inspectWorldDocument(storage, root, { plugins: new EnvironmentPlugins() })).rejects.toThrow('WORLD_PLUGIN_UNAVAILABLE');
    expect(session.world.mutationOwner).toBeNull();
  } finally { session.scene.close(); session.world.dispose(); await rm(directory, { recursive: true, force: true }); }
}, 30000);
