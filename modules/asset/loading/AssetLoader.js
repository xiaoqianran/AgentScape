import { GltfAssetLoader } from './GltfAssetLoader.js';
import { Errors } from '../model/errors.js';
import { disposeObject3D } from '../../rendering/disposeObject3D.js';
import { builtinAssetFactories } from './builtins/BuiltinAssets.js';

export class AssetLoader {
  constructor({ registry, compiledStore = null, gltfLoader = new GltfAssetLoader(), factories = builtinAssetFactories } = {}) {
    if (!registry?.getManifest || !registry?.has) throw new TypeError('AssetLoader requires an AssetRegistry');
    if (!gltfLoader || typeof gltfLoader.loadScene !== 'function') throw new TypeError('AssetLoader requires a glTF asset loader');
    this.registry = registry;
    this.compiledStore = compiledStore;
    this.gltfLoader = gltfLoader;
    this.factories = new Map(Object.entries(factories || {}));
  }

  registerFactory(assetId, factory) {
    if (typeof factory !== 'function') throw new TypeError(`Asset factory for ${assetId} must be a function`);
    this.factories.set(assetId, factory);
  }

  configureRenderer(renderer) {
    return this.gltfLoader.configureRenderer?.(renderer) ?? false;
  }

  async instantiate(assetId) {
    const manifest = this.registry.getManifest(assetId);
    let object;
    if (manifest.source?.kind === 'glb') object = await this.loadGLB(manifest.source.url);
    else if (manifest.source?.kind === 'compiled') object = await this.loadCompiled(manifest.source);
    else {
      const factory = this.factories.get(assetId);
      if (!factory) throw Errors.assetNotFound(assetId);
      object = await factory();
    }

    try {
      this.validateNodes(object, manifest);
      object.name ||= assetId;
      object.userData.assetId = assetId;
      object.userData.manifest = manifest;
      return { object, manifest };
    } catch (error) {
      disposeObject3D(object);
      throw error;
    }
  }

  validateNodes(object, manifest) {
    const missing = (manifest.requiredNodes || []).filter((name) => !object.getObjectByName(name));
    if (missing.length) {
      throw Errors.invalidManifest(
        `Asset ${manifest.id} is missing required GLB nodes: ${missing.join(', ')}`,
        { id:manifest.id, missing }
      );
    }
  }

  async loadCompiled(source) {
    const stored = await this.compiledStore?.get(source.key);
    if (!stored?.bytes) {
      if (source.fallbackUrl) return this.loadGLB(source.fallbackUrl);
      throw new Error(`Compiled asset binary missing: ${source.key}`);
    }
    const blob = new Blob([stored.bytes], { type:'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    try {
      return await this.loadGLB(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadGLB(url) {
    const scene = await this.gltfLoader.loadScene(url);
    scene.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
    });
    return scene;
  }
}
