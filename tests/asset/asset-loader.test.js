import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AssetRegistry } from '../../modules/asset/registry/AssetRegistry.js';
import { AssetLoader } from '../../modules/asset/loading/AssetLoader.js';

const manifest = (overrides = {}) => ({
  id:'fixture',
  type:'object',
  source:{ kind:'builtin' },
  actions:['move'],
  ...overrides
});

describe('AssetLoader', () => {
  it('materializes through a registered factory and attaches asset metadata', async () => {
    const registry = new AssetRegistry({ manifests:{ fixture:manifest() } });
    const loader = new AssetLoader({ registry, factories:{} });
    loader.registerFactory('fixture', async () => new THREE.Group());

    const { object, manifest:loadedManifest } = await loader.instantiate('fixture');
    expect(object.userData.assetId).toBe('fixture');
    expect(object.userData.manifest.id).toBe('fixture');
    expect(loadedManifest.id).toBe('fixture');
  });

  it('disposes an invalid materialized object when required nodes are missing', async () => {
    const registry = new AssetRegistry({
      manifests:{ fixture:manifest({ requiredNodes:['RequiredNode'] }) }
    });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const loader = new AssetLoader({ registry, factories:{
      fixture:async () => {
        const group = new THREE.Group();
        group.add(new THREE.Mesh(geometry, material));
        return group;
      }
    } });

    await expect(loader.instantiate('fixture')).rejects.toThrow(/missing required GLB nodes/i);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });
});
