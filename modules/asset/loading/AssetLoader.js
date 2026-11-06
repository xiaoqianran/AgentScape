import { GltfAssetLoader } from './GltfAssetLoader.js';
import { Errors } from '../model/errors.js';
import { disposeObject3D, RELEASE_RESOURCE } from '../../rendering/disposeObject3D.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { builtinAssetFactories } from './builtins/BuiltinAssets.js';

export class AssetLoader {
  constructor({ registry, compiledStore = null, gltfLoader = new GltfAssetLoader(), factories = builtinAssetFactories, maxResidentBytes = 256 * 1024 * 1024 } = {}) {
    if (!registry?.getManifest || !registry?.has) throw new TypeError('AssetLoader requires an AssetRegistry');
    if (!gltfLoader || typeof gltfLoader.loadScene !== 'function') throw new TypeError('AssetLoader requires a glTF asset loader');
    this.registry = registry;
    this.compiledStore = compiledStore;
    this.gltfLoader = gltfLoader;
    this.factories = new Map(Object.entries(factories || {}));
    this.shared = new Map();
    this.residentBytes = 0;
    this.maxResidentBytes = maxResidentBytes;
  }

  registerFactory(assetId, factory) {
    if (typeof factory !== 'function') throw new TypeError(`Asset factory for ${assetId} must be a function`);
    this.factories.set(assetId, factory);
  }

  configureRenderer(renderer) {
    return this.gltfLoader.configureRenderer?.(renderer) ?? false;
  }

  async instantiate(assetId, { signal } = {}) {
    const manifest = this.registry.getManifest(assetId);
    let object;
    if (['glb', 'compiled'].includes(manifest.source?.kind)) object = await this.instantiateShared(manifest, signal);
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

  stats() {
    return { resources: this.shared.size, references: [...this.shared.values()].reduce((sum, entry) => sum + entry.users, 0),
      estimatedResidentBytes: this.residentBytes, maxResidentBytes: this.maxResidentBytes };
  }

  async instantiateShared(manifest, signal) {
    if (signal?.aborted) throw Object.assign(new Error('ASSET_CANCELLED'), { code: 'ASSET_CANCELLED' });
    const source = manifest.source;
    const key = source.kind === 'compiled' ? `compiled:${source.key}` : `glb:${source.url}`;
    let entry = this.shared.get(key);
    if (!entry) {
      entry = { users: 0, bytes: 0, root: null, promise: null };
      this.shared.set(key, entry);
      entry.promise = (async () => {
        const root = source.kind === 'compiled' ? await this.loadCompiled(source) : await this.loadGLB(source.url);
        const bytes = estimateResourceBytes(root);
        if (this.residentBytes + bytes > this.maxResidentBytes) {
          disposeObject3D(root); throw Object.assign(new Error('ASSET_RESIDENT_BUDGET'), { code: 'ASSET_RESIDENT_BUDGET' });
        }
        entry.root = root; entry.bytes = bytes; this.residentBytes += bytes;
        return root;
      })();
    }
    entry.users++;
    const release = () => {
      entry.users--;
      if (!entry.users) {
        this.shared.delete(key);
        this.residentBytes -= entry.bytes;
        if (entry.root) disposeObject3D(entry.root);
      }
    };
    try {
      const root = await entry.promise;
      if (signal?.aborted) throw Object.assign(new Error('ASSET_CANCELLED'), { code: 'ASSET_CANCELLED' });
      this.validateNodes(root, manifest);
      const object = cloneSkeleton(root), materials = new Map();
      object.traverse(node => {
        if (!node.material) return;
        const copy = material => { if (!materials.has(material)) materials.set(material, material.clone()); return materials.get(material); };
        node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
      });
      let released = false;
      object[RELEASE_RESOURCE] = () => {
        if (!released) { released = true; for (const material of materials.values()) material.dispose(); release(); }
        return { geometries: 0, materials: materials.size, textures: 0 };
      };
      return object;
    } catch (error) { release(); throw error; }
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
    if (this.gltfLoader.loadBytes) {
      const object = await this.gltfLoader.loadBytes(stored.bytes);
      object.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
      return object;
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

function estimateResourceBytes(root) {
  const buffers = new Set(), textures = new Set(); let total = 0;
  root.traverse(node => {
    for (const attribute of [...Object.values(node.geometry?.attributes || {}), node.geometry?.index].filter(Boolean)) {
      const buffer = attribute.array?.buffer || attribute.data?.array?.buffer;
      if (buffer && !buffers.has(buffer)) { buffers.add(buffer); total += buffer.byteLength; }
    }
    for (const material of (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture && !textures.has(value)) {
        textures.add(value); total += (value.image?.width || 0) * (value.image?.height || 0) * 4;
      }
    }
  });
  return total;
}
