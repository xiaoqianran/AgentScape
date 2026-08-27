import { AssetCatalog } from './AssetCatalog.js';
import { AssetManager } from './AssetManager.js';
import { CompiledAssetStore } from './storage/CompiledAssetStore.js';

export function createAssetModule({ manifests, compiledStore = null } = {}) {
  const store = compiledStore || new CompiledAssetStore();
  const manager = new AssetManager({ manifests, compiledStore: store });
  const catalog = new AssetCatalog({ assetManager: manager });
  return { manager, catalog, compiledStore: store };
}
