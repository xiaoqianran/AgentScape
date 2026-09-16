import { describe, expect, it } from 'vitest';
import { AssetManager } from '../../modules/asset/AssetManager.js';
import { AssetRegistry } from '../../modules/asset/AssetRegistry.js';
import { AssetLoader } from '../../modules/asset/loading/AssetLoader.js';

describe('AssetManager compatibility facade', () => {
  it('forwards registry and loader boundaries without owning state', () => {
    const registry = new AssetRegistry({ manifests:{} });
    const loader = new AssetLoader({ registry, factories:{} });
    const manager = new AssetManager({ registry, loader });

    expect(manager.registry).toBe(registry);
    expect(manager.loader).toBe(loader);
    expect(manager.manifests).toBe(registry.manifests);
    expect(manager.factories).toBe(loader.factories);
  });
});
