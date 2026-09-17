import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { AssetRegistry } from '../../modules/asset/registry/AssetRegistry.js';
import { AssetLoader } from '../../modules/asset/loading/AssetLoader.js';

it('disposes a loaded instance when required-node validation fails', async () => {
  const registry = new AssetRegistry({ manifests:{} });
  const geometry = new THREE.BoxGeometry(); geometry.dispose = vi.fn();
  const material = new THREE.MeshStandardMaterial(); material.dispose = vi.fn();
  const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, material));
  registry.registerManifest({ id:'bad', type:'object', source:{kind:'glb',url:'bad.glb'}, actions:['move'], requiredNodes:['Missing'] });
  const loader = new AssetLoader({
    registry,
    gltfLoader:{ loadScene:vi.fn(async () => root) }
  });

  await expect(loader.instantiate('bad')).rejects.toThrow(/missing required GLB nodes/i);
  expect(geometry.dispose).toHaveBeenCalledOnce();
  expect(material.dispose).toHaveBeenCalledOnce();
});
