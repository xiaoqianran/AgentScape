import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetManifests } from './manifests/index.js';
import { validateAssetManifest } from './schema.js';
import { Errors } from '../core/errors.js';
import { disposeObject3D } from '../core/disposeObject3D.js';

const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};

export class AssetManager {
  constructor({ manifests = assetManifests, compiledStore = null } = {}) {
    this.compiledStore = compiledStore;
    this.loader = new GLTFLoader();
    this.manifests = new Map();
    this.factories = new Map();
    for (const manifest of Object.values(manifests)) this.registerManifest(manifest);
    this.registerBuiltins();
  }

  registerManifest(manifest, { replace = false } = {}) {
    validateAssetManifest(manifest);
    const existing = this.manifests.get(manifest.id);
    if (existing && !replace) {
      if (canonical(existing) === canonical(manifest)) return false;
      throw Errors.invalidManifest(`Asset id conflict: ${manifest.id}`, { id: manifest.id });
    }
    this.manifests.set(manifest.id, structuredClone(manifest));
    return true;
  }

  assertCompatibleManifest(manifest) {
    const existing = this.manifests.get(manifest.id);
    if (!existing) return this.registerManifest(manifest);
    if (canonical(existing) !== canonical(manifest)) throw Errors.invalidManifest(`Asset id conflict: ${manifest.id}`, { id: manifest.id });
    return false;
  }

  registerFactory(assetId, factory) { this.factories.set(assetId, factory); }
  has(assetId) { return this.manifests.has(assetId); }
  getManifest(assetId) {
    const manifest = this.manifests.get(assetId);
    if (!manifest) throw Errors.assetNotFound(assetId);
    return structuredClone(manifest);
  }

  async instantiate(assetId) {
    const manifest = this.getManifest(assetId);
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
    if (missing.length) throw Errors.invalidManifest(`Asset ${manifest.id} is missing required GLB nodes: ${missing.join(', ')}`, { id: manifest.id, missing });
  }

  async loadCompiled(source) {
    const stored = await this.compiledStore?.get(source.key);
    if (!stored?.bytes) {
      if (source.fallbackUrl) return this.loadGLB(source.fallbackUrl);
      throw new Error(`Compiled asset binary missing: ${source.key}`);
    }
    const blob = new Blob([stored.bytes], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    try { return await this.loadGLB(url); } finally { URL.revokeObjectURL(url); }
  }

  async loadGLB(url) {
    const gltf = await this.loader.loadAsync(url);
    gltf.scene.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.geometry.computeBoundsTree?.();
      }
    });
    return gltf.scene;
  }

  registerBuiltins() {
    this.registerFactory('agent', async () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.32, 1.06, 8, 16),
        new THREE.MeshStandardMaterial({ color:0x567fbd, roughness:0.28, metalness:0.48 })
      );
      body.position.y = 0.85; body.castShadow = body.receiveShadow = true; g.add(body);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), new THREE.MeshBasicMaterial({ color:0xa9d5ff, toneMapped:false }));
      visor.position.set(0, 1.12, -0.29); g.add(visor);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 32), new THREE.MeshBasicMaterial({ color:0x7db4ff, toneMapped:false }));
      ring.position.y = 0.08; ring.rotation.x = Math.PI / 2; g.add(ring);
      const hold = new THREE.Group(); hold.name = 'HoldAnchor'; hold.position.set(0,0.95,-0.62); g.add(hold);
      return g;
    });
    this.registerFactory('chair', async () => {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x71806a, roughness: 0.75 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.1, 0.76), mat); seat.position.y = 0.72; seat.castShadow = seat.receiveShadow = true; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.9, 0.1), mat); back.position.set(0, 1.16, -0.33); back.castShadow = back.receiveShadow = true; g.add(back);
      for (const x of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.68, 0.08), mat); leg.position.set(x, 0.34, z); leg.castShadow = leg.receiveShadow = true; g.add(leg); }
      return g;
    });
    this.registerFactory('cup', async () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.32, 28), new THREE.MeshStandardMaterial({ color: 0xe9edf5, roughness: 0.35 }));
      body.position.y = 0.16; body.castShadow = body.receiveShadow = true; g.add(body); return g;
    });
    this.registerFactory('table', async () => {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x9a6a43, roughness: 0.72 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 1.25), mat); top.position.y = 1; top.castShadow = top.receiveShadow = true; g.add(top);
      for (const x of [-1.02, 1.02]) for (const z of [-0.46, 0.46]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.94, 0.14), mat); leg.position.set(x, 0.47, z); leg.castShadow = leg.receiveShadow = true; g.add(leg); }
      return g;
    });

  }
}
