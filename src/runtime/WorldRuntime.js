import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { EventBus } from '../core/EventBus.js';
import { AssetManager } from './AssetManager.js';
import { ObjectStore } from './ObjectStore.js';
import { PhysicsSystem } from './systems/PhysicsSystem.js';
import { InteractionSystem } from './systems/InteractionSystem.js';
import { SpatialSystem } from './systems/SpatialSystem.js';
import { AssetLibrary } from '../assets/library/AssetLibrary.js';
import { HttpAssetGenerator } from '../assets/gateway/HttpAssetGenerator.js';
import { SceneSerializer } from '../persistence/SceneSerializer.js';
import { CommandHistory } from '../history/CommandHistory.js';
import { SceneGraph } from './graph/SceneGraph.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export class WorldRuntime {
  constructor(container) {
    this.version = '0.10.0';
    this.container = container; this.events = new EventBus(); this.assets = new AssetManager();
    this.assetGenerator = new HttpAssetGenerator({ endpoint: localStorage.getItem('agentscape.assetGeneratorEndpoint') || '' });
    this.assetLibrary = new AssetLibrary({ assetManager: this.assets, generator: this.assetGenerator, events: this.events }); this.serializer = new SceneSerializer(); this.store = new ObjectStore(); this.physics = new PhysicsSystem(); this.clock = new THREE.Clock(); this.running = false;
  }
  async init() {
    await this.physics.init();
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0b1020); this.scene.fog = new THREE.Fog(0x0b1020, 12, 28);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 100); this.camera.position.set(5.2, 4.2, 6.2);
    this.renderer = new THREE.WebGLRenderer({ antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.shadowMap.enabled = true; this.container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.target.set(0, 0.9, 0); this.controls.enableDamping = true;
    this.spatial = new SpatialSystem({ store: this.store, scene: this.scene });
    this.sceneGraph = new SceneGraph({ store: this.store, spatial: this.spatial, events: this.events });
    this.interactions = new InteractionSystem({ store: this.store, physics: this.physics, spatial: this.spatial, events: this.events });
    this.history = new CommandHistory({ apply: (scene) => this.restore(scene), events: this.events });
    this.addEnvironment(); this.resize(); window.addEventListener('resize', this._resize = () => this.resize()); this.running = true; this.animate(); this.events.emit('runtime.ready'); return this;
  }
  addEnvironment() {
    this.scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x252c3b, 2.2)); const key = new THREE.DirectionalLight(0xffffff, 3.5); key.position.set(4, 7, 3); key.castShadow = true; this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x20283a, roughness: 0.92 })); floor.position.y = -0.1; floor.receiveShadow = true; this.scene.add(floor);
    const grid = new THREE.GridHelper(10, 20, 0x526077, 0x30394d); grid.position.y = 0.003; this.scene.add(grid); this.physics.addFloor();
  }
  async spawn(assetId, { position = [0, 0, 0], id = `${assetId}_${crypto.randomUUID()}` } = {}) {
    const { object, manifest } = await this.assets.instantiate(assetId); object.position.fromArray(position); object.userData.instanceId = id; this.scene.add(object); this.store.add(id, { id, assetId, object, manifest, state: {} }); this.physics.attach(id, manifest, object); this.events.emit('object.spawned', { id, assetId, position }); return id;
  }
  snapshot() {
    const scene = this.serialize({ name: 'History Snapshot' });
    delete scene.metadata.savedAt;
    return scene;
  }

  async mutate(label, operation, meta = {}) {
    if (this.history?.suspended) return operation();
    const before = this.snapshot();
    this.history.begin(label, before);
    try {
      const result = await operation();
      this.sceneGraph?.update();
      this.history.commit(this.snapshot(), meta);
      return result;
    } catch (error) {
      this.history.cancel();
      throw error;
    }
  }

  beginMutation(label) {
    if (!this.history?.suspended) this.history.begin(label, this.snapshot());
  }

  commitMutation(meta = {}) {
    if (!this.history?.suspended) { this.sceneGraph?.update(); this.history.commit(this.snapshot(), meta); }
  }

  clearObjects() {
    const ids = this.store.list().map(([id]) => id);
    for (const id of ids) this.remove(id);
    this.events.emit('scene.cleared', { count: ids.length });
  }

  serialize(options) { return this.serializer.serialize(this, options); }
  async restore(scene) { return this.serializer.restore(this, scene); }

  restoreObjectState(id, state = {}) {
    const record = this.store.get(id);
    record.state = { ...state };
    if (state.door === 'open') this.interactions.setDoor(id, true);
    else if (state.door === 'closed') this.interactions.setDoor(id, false);
  }

  remove(id) {
    const record = this.store.get(id);
    this.physics.remove(id);
    this.scene.remove(record.object);
    record.object.traverse((node) => {
      if (node.isMesh) node.geometry?.disposeBoundsTree?.();
    });
    this.store.delete(id);
    this.sceneGraph?.removeObject(id); this.sceneGraph?.update();
    this.events.emit('object.removed', { id, assetId: record.assetId });
    return true;
  }

  async duplicate(id) {
    const record = this.store.get(id);
    const p = record.object.position;
    const duplicateId = `${record.assetId}_${crypto.randomUUID()}`;
    await this.spawn(record.assetId, { position: [p.x + 0.6, p.y, p.z + 0.6], id: duplicateId });
    const copy = this.store.get(duplicateId).object;
    copy.quaternion.copy(record.object.quaternion);
    this.physics.syncTransform(duplicateId, copy);
    this.events.emit('object.duplicated', { sourceId: id, id: duplicateId });
    return duplicateId;
  }

  getObjectInfo(id) {
    const r = this.store.get(id);
    return {
      id,
      asset: r.assetId,
      type: r.manifest.type,
      position: r.object.position.toArray().map(v => Number(v.toFixed(3))),
      rotation: r.object.rotation.toArray().slice(0, 3).map(v => Number(THREE.MathUtils.radToDeg(v).toFixed(1))),
      actions: [...r.manifest.actions]
    };
  }

  listObjects() { return this.store.list().map(([id, r]) => ({ id, asset: r.assetId, position: r.object.position.toArray().map(v => Number(v.toFixed(2))), actions: [...r.manifest.actions] })); }
  update() { const dt = Math.min(this.clock.getDelta(), 1 / 30); this.physics.step(dt, this.store); this.interactions.update(dt, this.camera); this.controls.update(); }
  animate = () => { if (!this.running) return; requestAnimationFrame(this.animate); this.update(); this.renderer.render(this.scene, this.camera); };
  resize() { const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h, false); }
  dispose() { this.running = false; window.removeEventListener('resize', this._resize); this.events.clear(); this.renderer?.dispose(); }
}
