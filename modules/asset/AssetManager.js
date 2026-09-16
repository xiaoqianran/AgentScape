import { AssetRegistry } from './AssetRegistry.js';
import { AssetLoader } from './loading/AssetLoader.js';

// Deprecated compatibility facade. New production code should depend on
// AssetRegistry and AssetLoader explicitly through AssetModule.
export class AssetManager {
  constructor(options = {}) {
    this.registry = options.registry || new AssetRegistry({ manifests:options.manifests });
    this.loader = options.loader || new AssetLoader({
      registry:this.registry,
      compiledStore:options.compiledStore,
      gltfLoader:options.gltfLoader
    });
  }

  get manifests() { return this.registry.manifests; }
  get factories() { return this.loader.factories; }
  get compiledStore() { return this.loader.compiledStore; }
  get gltfLoader() { return this.loader.gltfLoader; }

  registerManifest(manifest, options) { return this.registry.registerManifest(manifest, options); }
  assertCompatibleManifest(manifest) { return this.registry.assertCompatibleManifest(manifest); }
  has(assetId) { return this.registry.has(assetId); }
  getManifest(assetId) { return this.registry.getManifest(assetId); }
  listManifests() { return this.registry.listManifests(); }

  registerFactory(assetId, factory) { return this.loader.registerFactory(assetId, factory); }
  configureRenderer(renderer) { return this.loader.configureRenderer(renderer); }
  instantiate(assetId) { return this.loader.instantiate(assetId); }
  validateNodes(object, manifest) { return this.loader.validateNodes(object, manifest); }
  loadCompiled(source) { return this.loader.loadCompiled(source); }
  loadGLB(url) { return this.loader.loadGLB(url); }
}
