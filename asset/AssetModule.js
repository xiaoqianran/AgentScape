import { AssetCatalog } from './AssetCatalog.js';
import { AssetManager } from './AssetManager.js';
import { AssetProductionError, createAssetPublisher } from './pipeline/VerifiedArtifactAssetPipeline.js';
import { CompiledAssetStore } from './storage/CompiledAssetStore.js';
import { AssetManifestStore } from './storage/AssetManifestStore.js';

export function createAssetModule({
  manifests,
  compiledStore = null,
  manifestStore = undefined,
  now = () => Date.now()
} = {}) {
  const store = compiledStore || new CompiledAssetStore();
  const durableManifests = manifestStore === undefined
    ? (globalThis.indexedDB ? new AssetManifestStore() : null)
    : manifestStore;
  const manager = new AssetManager({ manifests, compiledStore: store });
  const catalog = new AssetCatalog({ assetManager: manager });
  let publisher = null;
  let hydrated = false;

  const persistManifest = async (manifest) => {
    if (manifest?.source?.kind !== 'compiled' || !durableManifests?.put) return false;
    await durableManifests.put(manifest);
    return true;
  };

  const module = {
    manager,
    catalog,
    compiledStore: store,
    manifestStore: durableManifests,

    async hydrate() {
      if (hydrated) return { manifests: manager.manifests.size, restored: false };
      if (!durableManifests?.list) return { manifests: manager.manifests.size, restored: false };
      const persisted = await durableManifests.list();
      let restored = 0;
      for (const manifest of persisted) {
        const changed = manager.registerManifest(manifest);
        if (changed) restored += 1;
      }
      hydrated = true;
      return { manifests: persisted.length, restored };
    },

    async registerManifest(manifest, options = {}) {
      const changed = manager.registerManifest(manifest, options);
      await persistManifest(manager.getManifest(manifest.id));
      return changed;
    },

    configurePublication({ artifacts, getAssetCompiler, events = null, idFactory = undefined } = {}) {
      if (!artifacts?.registry || !artifacts?.byteStore) {
        throw new AssetProductionError('ASSET_PUBLICATION_INVALID', 'Asset publication requires an ArtifactModule boundary');
      }
      publisher = createAssetPublisher({
        artifactRegistry: artifacts.registry,
        byteStore: artifacts.byteStore,
        getAssetCompiler,
        assetManager: manager,
        onManifestRegistered: persistManifest,
        events,
        now,
        ...(idFactory ? { idFactory } : {})
      });
      return module;
    },

    async publishAsset(request = {}) {
      if (!publisher) {
        throw new AssetProductionError(
          'ASSET_PUBLICATION_NOT_CONFIGURED',
          'Asset publication requires composition-time compiler configuration'
        );
      }
      return publisher(request);
    }
  };

  return module;
}
