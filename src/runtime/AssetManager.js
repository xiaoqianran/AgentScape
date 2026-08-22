import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetManifests } from '../assets/manifests/index.js';
import { validateAssetManifest } from '../assets/schema.js';
import { Errors } from '../core/errors.js';

export class AssetManager {
  constructor({ manifests = assetManifests } = {}) {
    this.loader = new GLTFLoader();
    this.manifests = new Map();
    this.factories = new Map();
    for (const manifest of Object.values(manifests)) this.registerManifest(manifest);
    this.registerBuiltins();
  }

  registerManifest(manifest) {
    validateAssetManifest(manifest);
    this.manifests.set(manifest.id, structuredClone(manifest));
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
    else {
      const factory = this.factories.get(assetId);
      if (!factory) throw Errors.assetNotFound(assetId);
      object = await factory();
    }
    object.name ||= assetId;
    object.userData.assetId = assetId;
    object.userData.manifest = manifest;
    return { object, manifest };
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
    this.registerFactory('cabinet', async () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2, 0.72), new THREE.MeshStandardMaterial({ color: 0x536176, roughness: 0.6 })); body.position.y = 1; body.castShadow = body.receiveShadow = true; g.add(body);
      const hinge = new THREE.Group(); hinge.name = 'doorHinge'; hinge.position.set(-0.82, 1, 0.39);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.62, 1.9, 0.08), new THREE.MeshStandardMaterial({ color: 0x71839d, roughness: 0.5 })); door.name = 'door'; door.position.x = 0.81; door.castShadow = true; hinge.add(door); g.add(hinge); return g;
    });
  }
}
