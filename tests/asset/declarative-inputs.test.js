import { describe, it, expect } from 'vitest';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { recipeSchema, assetPackageSchema, assertEmbeddedGLB } from '../../modules/asset/model/AssetInputContracts.js';
import { compileRecipeGeometry } from '../../modules/asset/production/AssetRecipe.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { openScene } from '../../application/scene/SceneFacade.js';

const recipe = () => ({ schema: 'agentscape.asset-recipe', schemaVersion: 1, id: 'example/box', parts: [{ id: 'body', geometry: { type: 'box', size: [1, 1, 1] }, position: [0, 0.5, 0] }] });
const project = { schema: 'agentscape.scene-project', schemaVersion: 1, name: 'Inputs', environment: { type: 'builtin', id: 'monument-hall' }, objects: [] };
const assets = () => createAssetModule({ manifests: {}, manifestStore: null, libraryStore: null, gltfLoader: createHeadlessGLTFLoader() });

describe('declarative asset inputs', () => {
  it('imports a versioned Visual recipe and rejects a Physical request without changing the world', async () => {
    installHeadlessAssetIO();
    const module = assets();
    const imported = await module.importRecipe(recipe());
    expect(await module.importRecipe(recipe())).toEqual(imported);
    expect(imported.manifest.physics).toBeUndefined();
    expect(imported.manifest.actions).toEqual([]);
    const scene = await openScene({ project, assetModule: module });
    try {
      await expect(scene.addModel({ id: 'wrong', asset: imported.asset, level: 'physical' })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
      expect(scene.observe().objects).toHaveLength(0);
      await scene.addModel({ id: 'visual', asset: imported.asset, level: 'visual' });
      expect(scene.observe().objects[0].physicsRegistered).toBe(false);
      await scene.setTransform({ id: 'visual', transform: { position: [2, 1, 0], scale: 2 } });
      scene.step();
      expect(scene.observe().objects[0].physicsRegistered).toBe(false);
      expect(scene.observe().objects[0].transform.scale).toBe(2);
      const nextRecipe = recipe(); nextRecipe.parts[0].geometry.size[0] = 2;
      const next = await module.importRecipe(nextRecipe);
      await scene.replaceAsset({ id: 'visual', asset: next.asset, level: 'visual' });
      expect(scene.observe().objects[0]).toMatchObject({ id: 'visual', physicsRegistered: false, transform: { scale: 2 } });
      await scene.remove({ id: 'visual' });
      expect(scene.observe().objects).toHaveLength(0);
    } finally { scene.close(); }
  });
  it('compiles explicit physics through the existing compiler and registers a real body', async () => {
    const module = assets(), input = recipe();
    input.capabilities = { level: 'physical', physics: { body: 'fixed', colliders: [{ shape: 'box', halfExtents: [0.5, 0.5, 0.5], translation: [0, 0.5, 0] }] } };
    const imported = await module.importRecipe(input);
    expect(imported.manifest.compiler.collisionStrategy).toBe('declared-colliders');
    const scene = await openScene({ project, assetModule: module });
    try {
      await scene.addModel({ id: 'body', asset: imported.asset, level: 'physical' });
      expect(scene.observe().objects[0].physicsRegistered).toBe(true);
    } finally { scene.close(); }
    input.parts[0].geometry.size[0] = 2;
    expect((await module.importRecipe(input)).asset).not.toBe(imported.asset);
  });
  it('imports self-contained GLB without Docker and rejects capability upgrades', async () => {
    const { bytes } = await compileRecipeGeometry(recipe());
    const module = assets();
    const imported = await module.importGLB({ bytes });
    expect(imported.manifest.capabilityLevel).toBe('visual');
    await expect(module.importGLB({ bytes, level: 'physical' })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    expect(() => assertEmbeddedGLB(new Uint8Array(20))).toThrow('INVALID_GLB');
    const copy = bytes.slice(), fresh = assets();
    const pending = fresh.importGLB({ bytes: copy });
    copy.fill(0);
    expect((await pending).asset).toBe(imported.asset);
  });
  it('rejects cycles, excess parts, code fields and false capabilities', () => {
    const cases = [
      { ...recipe(), code: 'alert(1)' },
      { ...recipe(), parts: Array.from({ length: 65 }, (_, i) => ({ id: `p${i}` })) },
      { ...recipe(), parts: [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }] },
      { ...recipe(), capabilities: { level: 'physical' } },
      { ...recipe(), capabilities: { level: 'visual', actions: ['pickup'] } }
    ];
    for (const input of cases) expect(() => recipeSchema.parse(input)).toThrow();
    expect(() => assetPackageSchema.parse({ schema: 'agentscape.asset-package', schemaVersion: 1, id: 'box', version: '1.0.0', entry: { kind: 'glb', path: './../escape' }, level: 'visual' })).toThrow();
  });
});
