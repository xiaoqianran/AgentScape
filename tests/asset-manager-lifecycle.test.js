import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { AssetManager } from '../asset/AssetManager.js';

it('disposes a loaded instance when required-node validation fails', async () => {
  const assets = new AssetManager({ manifests:{} });
  const geometry = new THREE.BoxGeometry(); geometry.dispose = vi.fn();
  const material = new THREE.MeshStandardMaterial(); material.dispose = vi.fn();
  const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, material));
  assets.registerManifest({ id:'bad', type:'object', source:{kind:'glb',url:'bad.glb'}, actions:['move'], requiredNodes:['Missing'] });
  assets.loadGLB = vi.fn(async () => root);

  await expect(assets.instantiate('bad')).rejects.toThrow(/missing required GLB nodes/i);
  expect(geometry.dispose).toHaveBeenCalledOnce();
  expect(material.dispose).toHaveBeenCalledOnce();
});
