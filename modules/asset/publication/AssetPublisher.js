import { createAssetRef } from '../AssetRef.js';
import {
  AssetProductionError,
  VerifiedArtifactAssetPipeline
} from '../pipeline/VerifiedArtifactAssetPipeline.js';

export { AssetProductionError };

export class AssetPublisher {
  constructor(options = {}) {
    const assetRegistry = options.assetRegistry || options.assetManager;
    this.pipeline = new VerifiedArtifactAssetPipeline({ ...options, assetManager:assetRegistry });
  }

  async publish(request = {}) {
    return this.pipeline.produce(request);
  }
}

export function createAssetPublisher({
  artifactRegistry,
  byteStore,
  getAssetCompiler,
  assetRegistry,
  assetManager = null,
  onManifestRegistered = null,
  events = null,
  now = () => Date.now(),
  idFactory = undefined
} = {}) {
  if (typeof getAssetCompiler !== 'function') {
    throw new AssetProductionError('ASSET_PUBLISHER_INVALID', 'Asset publisher requires getAssetCompiler()');
  }

  const registry = assetRegistry || assetManager?.registry || assetManager;
  if (!registry?.registerManifest || !registry?.getManifest) {
    throw new AssetProductionError('ASSET_PUBLISHER_INVALID', 'Asset publisher requires AssetRegistry');
  }

  let publisher = null;

  return async function publishAsset(request = {}) {
    if (!publisher) {
      const assetCompiler = await getAssetCompiler();
      publisher = new AssetPublisher({
        artifactRegistry,
        byteStore,
        assetCompiler,
        assetRegistry:registry,
        onManifestRegistered,
        events,
        now,
        ...(idFactory ? { idFactory } : {})
      });
    }

    const result = await publisher.publish(request);
    if (result.status === 'asset-ready' || result.status === 'asset-provisional') {
      return { ...result, assetRef:createAssetRef(result.assetId) };
    }
    return result;
  };
}
