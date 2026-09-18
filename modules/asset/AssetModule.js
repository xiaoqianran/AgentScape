import { AssetCatalog } from './registry/AssetCatalog.js';
import { AssetRegistry } from './registry/AssetRegistry.js';
import { AssetLoader } from './loading/AssetLoader.js';
import { AssetProductionError, createAssetProducer } from './production/AssetProductionPipeline.js';
import { HttpCompilerProvider } from './production/compiler/providers/HttpCompilerProvider.js';
import { CompiledAssetStore } from './persistence/CompiledAssetStore.js';
import { AssetManifestStore } from './persistence/AssetManifestStore.js';
import { LocalAssetLibrary } from './persistence/LocalAssetLibrary.js';
import { LocalAssetLibraryStore } from './persistence/LocalAssetLibraryStore.js';

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

  const registry = new AssetRegistry({ manifests });
  const loader = new AssetLoader({ registry, compiledStore:store });
  const catalog = new AssetCatalog({ registry });

  const durableLibrary = libraryStore === undefined
    ? new LocalAssetLibraryStore()
    : (libraryStore || new LocalAssetLibraryStore({ indexedDBImpl:null }));
  const library = new LocalAssetLibrary({
    assetRegistry:registry,
    compiledStore:store,
    store:durableLibrary,
    now:()=>new Date(now()).toISOString()
  });

  let producer = null;
  let hydrated = false;
  let configuredCompilerProvider = null;
  let configuredCompiler = null;
  let configuredCompilerGetter = null;
  let articulationVerifier = null;

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
        const { AssetCompiler } = await import('./production/compiler/AssetCompiler.js');
        configuredCompiler = new AssetCompiler({ store, provider:configuredCompilerProvider, events, version });
      }
      return configuredCompiler;
    };
    return configuredCompilerGetter;
  };

  const module = {
    registry,
    loader,
    catalog,
    compiledStore:store,
    manifestStore:durableManifests,
    library,

    getManifest(assetId) {
      return registry.getManifest(assetId);
    },

    hasAsset(assetId) {
      return registry.has(assetId);
    },

    assertCompatibleManifest(manifest) {
      return registry.assertCompatibleManifest(manifest);
    },

    configureRenderer(renderer) {
      return loader.configureRenderer?.(renderer);
    },

    instantiate(assetId, options) {
      return loader.instantiate(assetId, options);
    },

    configureVerification({ articulationVerifier: verifier = null } = {}) {
      if (verifier != null && typeof verifier.verify !== 'function') {
        throw new TypeError('Asset articulation verifier must provide verify(assetId)');
      }
      articulationVerifier = verifier;
      return module;
    },

    async verifyArticulation(assetId) {
      if (!articulationVerifier) {
        const error = new Error('Asset articulation verification is not configured');
        error.code = 'ASSET_ARTICULATION_VERIFIER_UNAVAILABLE';
        throw error;
      }
      return articulationVerifier.verify(assetId);
    },

    async hydrate() {
      if (hydrated) return { manifests:registry.size, restored:false };
      if (!durableManifests?.list) {
        await library.hydrate();
        hydrated = true;
        return { manifests:registry.size, restored:false };
      }
      const persisted = await durableManifests.list();
      let restored = 0;
      for (const manifest of persisted) {
        const changed = registry.registerManifest(manifest);
        if (changed) restored += 1;
      }
      await library.hydrate();
      hydrated = true;
      return { manifests:persisted.length, restored };
    },

    async registerManifest(manifest, options = {}) {
      const changed = registry.registerManifest(manifest, options);
      await persistManifest(registry.getManifest(manifest.id));
      return changed;
    },

    async approveAsset(assetId, metadata = {}) {
      return library.approve(assetId, metadata);
    },

    async listApprovedAssets() {
      return library.list();
    },

    configureProduction({
      artifacts,
      getAssetCompiler = null,
      compilerProvider = null,
      compilerEndpoint = '',
      events = null,
      version = 'dev',
      idFactory = undefined
    } = {}) {
      if (!artifacts?.registry || !artifacts?.byteStore) {
        throw new AssetProductionError('ASSET_PRODUCTION_INVALID', 'Asset production requires an ArtifactModule boundary');
      }
      const compilerGetter = getAssetCompiler || configureCompiler({
        provider:compilerProvider,
        endpoint:compilerEndpoint,
        events,
        version
      });
      producer = createAssetProducer({
        artifactRegistry:artifacts.registry,
        byteStore:artifacts.byteStore,
        getAssetCompiler:compilerGetter,
        assetRegistry:registry,
        onManifestRegistered:persistManifest,
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

    async produceAsset(request = {}) {
      if (!producer) {
        throw new AssetProductionError(
          'ASSET_PRODUCTION_NOT_CONFIGURED',
          'Asset production requires composition-time compiler configuration'
        );
      }
      return producer(request);
    }
  };

  return module;
}
