import { ArtifactRegistry } from '../artifacts/ArtifactRegistry.js';
import { MemoryArtifactByteStore } from '../artifacts/MemoryArtifactByteStore.js';
import { AssetCatalog } from '../../asset/AssetCatalog.js';
import { AssetManager } from '../../asset/AssetManager.js';
import { AssetProductionError, createAssetPublisher } from './publishAsset.js';
import { CompiledAssetStore } from '../../asset/storage/CompiledAssetStore.js';

export function createAssetModule({
  manifests,
  compiledStore = null,
  artifactRegistry = null,
  byteStore = null,
  now = () => Date.now()
} = {}) {
  const store = compiledStore || new CompiledAssetStore();
  const manager = new AssetManager({ manifests, compiledStore: store });
  const catalog = new AssetCatalog({ assetManager: manager });
  const registry = artifactRegistry || new ArtifactRegistry({ now });
  const bytes = byteStore || new MemoryArtifactByteStore();
  let publisher = null;

  const module = {
    manager,
    catalog,
    compiledStore: store,
    artifactRegistry: registry,
    byteStore: bytes,

    configurePublication({ getAssetCompiler, events = null, idFactory = undefined } = {}) {
      publisher = createAssetPublisher({
        artifactRegistry: registry,
        byteStore: bytes,
        getAssetCompiler,
        assetManager: manager,
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
