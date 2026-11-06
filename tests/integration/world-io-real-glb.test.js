import { it, expect } from 'vitest';
import { mkdtemp, rm, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { WorldStorage } from '../../application/scene/WorldStorage.js';
import { WorldDiskStorage } from '../../apps/server/WorldDiskStorage.js';
import { EnvironmentPlugins } from '../../application/scene/WorldDocument.js';

it('round-trips real GLB bytes, runtime entities and environment through a world archive', async () => {
  installHeadlessAssetIO();
  const directory = await mkdtemp(path.join(tmpdir(), 'agentscape-real-glb-'));
  const make = async () => {
    const assetModule = createAssetModule({ gltfLoader: createHeadlessGLTFLoader(), manifestStore: null, libraryStore: null });
    const session = createSession(null, { environmentFactory: () => createMonumentHall({ loadAssets:false }), assetModule });
    await session.world.init();
    return session;
  };
  const source = await make();
  const target = await make();
  const plugins = new EnvironmentPlugins().register('monument-hall', { create: () => createMonumentHall({ loadAssets:false }) });
  try {
    const result = await source.world.assetModule.importRecipe({
      schema:'agentscape.asset-recipe', schemaVersion:1, id:'sample/world-cube',
      parts:[{ id:'body', geometry:{ type:'box', size:[1, 1, 1] } }],
      capabilities:{level:'physical',physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[0.5,0.5,0.5],translation:[0,0,0]}]}}
    });
    await source.scene.addModel({ id:'imported_cube', asset:result.asset, level:'physical', position:[3,1,2] });
    source.world.store.get('imported_cube').state.label = 'preserved';
    const store = new WorldStorage(await new WorldDiskStorage(path.join(directory,'blocks')).initialize());
    const archive = path.join(directory,'world.asworld');
    const writer = await open(archive,'wx');
    try { const exported = await source.scene.exportWorld(store,{write:chunk=>writer.writeFile(chunk)});
      expect(exported.status).toBe('succeeded'); }
    finally { await writer.close(); }
    const importedResult = await target.scene.importWorld(store,createReadStream(archive,{highWaterMark:65536}),{
      plugins,gltfLoader:createHeadlessGLTFLoader()
    });
    expect(importedResult.status).toBe('succeeded');
    expect(target.world.environment.id).toBe('monument-hall');
    expect(target.world.store.size).toBe(1);
    expect(target.world.store.get('imported_cube').object.position.toArray()).toEqual([3,1,2]);
    expect(target.world.store.get('imported_cube').state.label).toBe('preserved');
    expect(target.world.physics.getPosition('imported_cube')).toEqual([3,1,2]);
  } finally {source.scene.close();target.scene.close();source.world.dispose();target.world.dispose(); await rm(directory,{recursive:true,force:true});}
},60000);
