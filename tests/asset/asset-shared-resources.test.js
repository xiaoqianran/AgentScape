import { it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { AssetRegistry } from '../../modules/asset/registry/AssetRegistry.js';
import { AssetLoader } from '../../modules/asset/loading/AssetLoader.js';
import { disposeObject3D } from '../../modules/rendering/disposeObject3D.js';

it('shares geometry by resource, isolates instance materials, and releases only after the last owner', async () => {
  const registry = new AssetRegistry({ manifests: Object.fromEntries(['a', 'b'].map(id => [id, { id, type: 'object', source: { kind: 'glb', url: 'shared.glb' }, actions: [] }])) });
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const dispose = vi.spyOn(geometry, 'dispose');
  const loadScene = vi.fn(async () => new THREE.Mesh(geometry, material));
  const loader = new AssetLoader({ registry, gltfLoader: { loadScene } });
  const [a, b] = await Promise.all([loader.instantiate('a'), loader.instantiate('b')]);
  expect(loadScene).toHaveBeenCalledOnce(); expect(a.object.geometry).toBe(b.object.geometry);
  expect(a.object.material).not.toBe(b.object.material);
  expect(loader.stats().references).toBe(2);
  disposeObject3D(a.object); disposeObject3D(a.object);
  expect(dispose).not.toHaveBeenCalled(); expect(loader.stats().references).toBe(1);
  disposeObject3D(b.object); expect(dispose).toHaveBeenCalledOnce();
  expect(loader.stats()).toMatchObject({ resources: 0, references: 0, estimatedResidentBytes: 0 });
});

it('allows retry after failure and releases cancelled consumers', async () => {
  const registry = new AssetRegistry({ manifests: { a: { id: 'a', type: 'object', source: { kind: 'glb', url: 'a.glb' }, actions: [] } } });
  const loader = new AssetLoader({ registry, gltfLoader: { loadScene: vi.fn().mockRejectedValueOnce(new Error('network')).mockImplementation(async () => new THREE.Group()) } });
  await expect(loader.instantiate('a')).rejects.toThrow('network');
  expect(loader.stats().resources).toBe(0);
  const controller = new AbortController(); const pending = loader.instantiate('a', { signal: controller.signal }); controller.abort();
  await expect(pending).rejects.toThrow('ASSET_CANCELLED');
  expect(loader.stats().references).toBe(0);
  const a = await loader.instantiate('a'); disposeObject3D(a.object);
  expect(loader.stats().resources).toBe(0);
});
