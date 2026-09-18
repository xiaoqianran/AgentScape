import { normalizeAuthoringModelRef } from './ModelRef.js';

export function createAuthoringModelResolver({
  assetLoader = null,
  gltfLoader = null
} = {}) {
  return async function resolveAuthoringModel(reference) {
    const normalized = normalizeAuthoringModelRef(reference);
    const source = normalized.source;

    if (source.type === 'url') {
      if (!gltfLoader || typeof gltfLoader.loadScene !== 'function') {
        throw new TypeError('World Authoring URL ModelRef resolution requires a GLTF scene loader');
      }
      return gltfLoader.loadScene(source.uri);
    }

    if (!assetLoader || typeof assetLoader.instantiate !== 'function') {
      throw new TypeError('World Authoring AssetRef resolution requires AssetLoader');
    }

    const assetId = source.assetRef.assetId;
    const result = await assetLoader.instantiate(assetId);
    if (!result?.object?.isObject3D) {
      throw new TypeError(`World Authoring AssetRef resolver returned no Object3D: ${assetId}`);
    }
    return result.object;
  };
}
