import { AssetCatalog } from './AssetCatalog.js';
import { AssetManager } from './AssetManager.js';
import { AssetProductionError, createAssetPublisher } from './pipeline/VerifiedArtifactAssetPipeline.js';
import { HttpCompilerProvider } from './compiler/providers/HttpCompilerProvider.js';
import { CompiledAssetStore } from './storage/CompiledAssetStore.js';
import { AssetManifestStore } from './storage/AssetManifestStore.js';
import { LocalAssetLibrary } from './LocalAssetLibrary.js';
import { LocalAssetLibraryStore } from './storage/LocalAssetLibraryStore.js';

export function createAssetModule({
  manifests,
  compiledStore = null,
  manifestStore = undefined,
  libraryStore = undefined,
  now = () => Date.now()
} = {}) {
  const store = compiledStore || new CompiledAssetStore();
  const durableManifests = manifestStore === undefined
    ? (globalThis.indexedDB ? new AssetManifestStore() : null)
    : manifestStore;
  const manager = new AssetManager({ manifests, compiledStore: store });
  const catalog = new AssetCatalog({ assetManager: manager });
  const durableLibrary = libraryStore === undefined
    ? new LocalAssetLibraryStore()
    : (libraryStore || new LocalAssetLibraryStore({ indexedDBImpl:null }));
  const library = new LocalAssetLibrary({
    assetManager:manager,
    compiledStore:store,
    store:durableLibrary,
    now:()=>new Date(now()).toISOString()
  });
  let publisher = null;
  let hydrated = false;
  let configuredCompilerProvider = null;
  let configuredCompiler = null;
  let configuredCompilerGetter = null;

  const persistManifest = async (manifest) => {
    if (manifest?.source?.kind !== 'compiled' || !durableManifests?.put) return false;
    await durableManifests.put(manifest);
    return true;
  };

  const configureCompiler = ({ provider = null, endpoint = '', events = null, version = 'dev' } = {}) => {
    configuredCompilerProvider = provider || new HttpCompilerProvider({ endpoint:String(endpoint || '').trim() });
    configuredCompiler = null;
    configuredCompilerGetter = async () => {
      if (!configuredCompiler) {
        const { AssetCompiler } = await import('./compiler/AssetCompiler.js');
        configuredCompiler = new AssetCompiler({ store, provider:configuredCompilerProvider, events, version });
      }
      return configuredCompiler;
    };
    return configuredCompilerGetter;
  };

  const module = {
    manager,
    catalog,
    compiledStore: store,
    manifestStore: durableManifests,
    library,

    async hydrate() {
      if (hydrated) return { manifests: manager.manifests.size, restored: false };
      if (!durableManifests?.list) {
        await library.hydrate();
        hydrated = true;
        return { manifests: manager.manifests.size, restored: false };
      }
      const persisted = await durableManifests.list();
      let restored = 0;
      for (const manifest of persisted) {
        const changed = manager.registerManifest(manifest);
        if (changed) restored += 1;
      }
      await library.hydrate();
      hydrated = true;
      return { manifests: persisted.length, restored };
    },

    async registerManifest(manifest, options = {}) {
      const changed = manager.registerManifest(manifest, options);
      await persistManifest(manager.getManifest(manifest.id));
      return changed;
    },

    async approveAsset(assetId, metadata = {}) {
      return library.approve(assetId, metadata);
    },

    async listApprovedAssets() {
      return library.list();
    },

    configurePublication({
      artifacts,
      getAssetCompiler = null,
      compilerProvider = null,
      compilerEndpoint = '',
      events = null,
      version = 'dev',
      idFactory = undefined
    } = {}) {
      if (!artifacts?.registry || !artifacts?.byteStore) {
        throw new AssetProductionError('ASSET_PUBLICATION_INVALID', 'Asset publication requires an ArtifactModule boundary');
      }
      const compilerGetter = getAssetCompiler || configureCompiler({
        provider:compilerProvider,
        endpoint:compilerEndpoint,
        events,
        version
      });
      publisher = createAssetPublisher({
        artifactRegistry: artifacts.registry,
        byteStore: artifacts.byteStore,
        getAssetCompiler: compilerGetter,
        assetManager: manager,
        onManifestRegistered: persistManifest,
        events,
        now,
        ...(idFactory ? { idFactory } : {})
      });
      return module;
    },

    setCompilerEndpoint(endpoint = '') {
      configuredCompilerProvider?.setEndpoint?.(String(endpoint || '').trim());
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
