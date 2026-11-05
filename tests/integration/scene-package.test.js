import { it, expect } from 'vitest';
import { openScene } from '../../application/scene/SceneFacade.js';
import { openScenePackage } from '../../application/scene/ScenePackage.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';

it('carries real resource bytes into a fresh asset store and preserves the old world on failed import', async () => {
  installHeadlessAssetIO();
  const assets = () => createAssetModule({ gltfLoader: createHeadlessGLTFLoader(), manifestStore: null, libraryStore: null });
  const firstAssets = assets();
  const imported = await firstAssets.importRecipe({ schema: 'agentscape.asset-recipe', schemaVersion: 1, id: 'example/cube', parts: [{ id: 'cube', geometry: { type: 'box', size: [1, 1, 1] } }] });
  const physical = await firstAssets.importRecipe({ schema: 'agentscape.asset-recipe', schemaVersion: 1, id: 'example/physical',
    parts: [{ id: 'body', geometry: { type: 'box', size: [1, 1, 1] }, position: [0, 0.5, 0] }],
    capabilities: { level: 'physical', physics: { body: 'fixed', colliders: [{ shape: 'box', halfExtents: [0.5, 0.5, 0.5], translation: [0, 0.5, 0] }] } } });
  const scene = await openScene({ assetModule: firstAssets, project: { schema: 'agentscape.scene-project', schemaVersion: 1, name: 'Portable', environment: { type: 'builtin', id: 'monument-hall' }, objects: [{ id: 'cube', asset: imported.asset, level: 'visual' }] } });
  let restored;
  let importedInto;
  try {
    await scene.addModel({ id: 'body', asset: physical.asset, level: 'physical', position: [3, 0, 0] });
    const saved = await scene.save();
    expect(saved.value.assets[0].bytes.length).toBeGreaterThan(0);
    const freshAssets = assets();
    restored = await openScenePackage(JSON.stringify(saved.value), { assetModule: freshAssets });
    expect(restored.observe().objects[0]).toMatchObject({ id: 'cube', physicsRegistered: false });
    expect(restored.observe().objects[1]).toMatchObject({ id: 'body', physicsRegistered: true });
    expect(freshAssets.registry.has(imported.manifest.id)).toBe(true);
    importedInto = await openScene({ project: { schema: 'agentscape.scene-project', schemaVersion: 1, name: 'Target', environment: { type: 'builtin', id: 'monument-hall' }, objects: [] } });
    await importedInto.importProject(saved.value);
    expect(importedInto.observe().objects).toHaveLength(2);
    const corrupt = structuredClone(saved.value); corrupt.assets[0].bytes = 'AAAA';
    await expect(openScenePackage(corrupt)).rejects.toThrow('PROJECT_INTEGRITY_MISMATCH');
    expect(scene.observe().objects).toHaveLength(2);
  } finally { scene.close(); restored?.close(); importedInto?.close(); }
});
