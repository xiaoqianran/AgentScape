import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { behaviors } from '../assets/behaviors.js';

export class AssetRegistry {
  constructor() {
    this.loader = new GLTFLoader();
    this.factories = new Map();
    this.registerBuiltins();
  }

  register(id, factory) {
    this.factories.set(id, factory);
  }

  async create(id) {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`Unknown asset: ${id}`);
    const object = await factory();
    object.userData.assetId = id;
    object.userData.behavior = structuredClone(behaviors[id] || {});
    return object;
  }

  async loadGLB(url, behavior = {}) {
    const gltf = await this.loader.loadAsync(url);
    gltf.scene.userData.behavior = structuredClone(behavior);
    return gltf.scene;
  }

  registerBuiltins() {
    this.register('cup', async () => {
      const g = new THREE.Group();
      g.name = 'cup';
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.13, 0.32, 28),
        new THREE.MeshStandardMaterial({ color: 0xe9edf5, roughness: 0.35 })
      );
      body.position.y = 0.16;
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      return g;
    });

    this.register('table', async () => {
      const g = new THREE.Group();
      g.name = 'table';
      const mat = new THREE.MeshStandardMaterial({ color: 0x9a6a43, roughness: 0.72 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 1.25), mat);
      top.position.y = 1;
      top.castShadow = top.receiveShadow = true;
      g.add(top);
      for (const x of [-1.02, 1.02]) for (const z of [-0.46, 0.46]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.94, 0.14), mat);
        leg.position.set(x, 0.47, z);
        leg.castShadow = leg.receiveShadow = true;
        g.add(leg);
      }
      return g;
    });

    this.register('cabinet', async () => {
      const g = new THREE.Group();
      g.name = 'cabinet';
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x536176, roughness: 0.6 });
      const doorMat = new THREE.MeshStandardMaterial({ color: 0x71839d, roughness: 0.5 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.0, 0.72), bodyMat);
      body.position.y = 1;
      body.castShadow = body.receiveShadow = true;
      g.add(body);

      const hinge = new THREE.Group();
      hinge.name = 'doorHinge';
      hinge.position.set(-0.82, 1, 0.39);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.62, 1.9, 0.08), doorMat);
      door.name = 'door';
      door.position.x = 0.81;
      door.castShadow = true;
      hinge.add(door);
      g.add(hinge);
      g.userData.doorHinge = hinge;
      return g;
    });
  }
}
