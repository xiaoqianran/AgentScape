import { createAssetRef } from '../AssetRef.js';
import {
  AssetProductionError,
  VerifiedArtifactAssetPipeline
} from '../pipeline/VerifiedArtifactAssetPipeline.js';

export { AssetProductionError };

export class AssetPublisher {
  constructor(options = {}) {
    this.pipeline = new VerifiedArtifactAssetPipeline(options);
  }

  async publish(request = {}) {
    return this.pipeline.produce(request);
  }
}

export function createAssetPublisher({
  artifactRegistry,
  byteStore,
  getAssetCompiler,
  assetManager,
  onManifestRegistered = null,
  events = null,
  now = () => Date.now(),
  idFactory = undefined
} = {}) {
  if (typeof getAssetCompiler !== 'function') {
    throw new AssetProductionError('ASSET_PUBLISHER_INVALID', 'Asset publisher requires getAssetCompiler()');
  }

  let publisher = null;

  return async function publishAsset(request = {}) {
    if (!publisher) {
      const assetCompiler = await getAssetCompiler();
      publisher = new AssetPublisher({
        artifactRegistry,
        byteStore,
        assetCompiler,
        assetManager,
        onManifestRegistered,
        events,
        now,
        ...(idFactory ? { idFactory } : {})
      });
    }

    const result = await publisher.publish(request);
    if (result.status === 'asset-ready' || result.status === 'asset-provisional') {
      return { ...result, assetRef: createAssetRef(result.assetId) };
    }
    return result;
  };
}
