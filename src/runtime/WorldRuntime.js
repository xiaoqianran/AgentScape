import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { EventBus } from '../core/EventBus.js';
import { AssetManager } from './AssetManager.js';
import { ObjectStore } from './ObjectStore.js';
import { PhysicsSystem } from './systems/PhysicsSystem.js';
import { InteractionSystem } from './systems/InteractionSystem.js';
import { SpatialSystem } from './systems/SpatialSystem.js';
import { NavigationSystem } from './systems/NavigationSystem.js';
import { LocomotionSystem } from './systems/LocomotionSystem.js';
import { AssetLibrary } from '../assets/library/AssetLibrary.js';
import { HttpAssetGenerator } from '../assets/gateway/HttpAssetGenerator.js';
import { SceneSerializer } from '../persistence/SceneSerializer.js';
import { CommandHistory } from '../history/CommandHistory.js';
import { SceneGraph } from './graph/SceneGraph.js';
import { PolicyEngine } from '../policy/PolicyEngine.js';
import { TraceRecorder } from '../observability/TraceRecorder.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { registerCoreSkills } from '../skills/registerCoreSkills.js';
import { WorldValidator } from '../validation/WorldValidator.js';
import { RepairEngine } from '../validation/RepairEngine.js';
import { createWorldPipeline } from '../pipeline/createWorldPipeline.js';
import { CompiledAssetStore } from '../assets/storage/CompiledAssetStore.js';
import { HttpCompilerProvider } from '../compiler/providers/HttpCompilerProvider.js';
import { disposeObject3D } from './disposeObject3D.js';
import { ArticulationVerifier } from '../validation/ArticulationVerifier.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export class WorldRuntime {
  constructor(container, { environmentFactory } = {}) {
    this.version = '1.17.0';
    this.container = container; this.environmentFactory = environmentFactory; this.events = new EventBus(); this.mutationOwner = null;
    this.policy = new PolicyEngine(); this.trace = new TraceRecorder({ events: this.events });
    this.compiledAssetStore = new CompiledAssetStore();
    this.assets = new AssetManager({ compiledStore: this.compiledAssetStore });
    this.compilerProvider = new HttpCompilerProvider({ endpoint: localStorage.getItem('agentscape.compilerEndpoint') || '' });
    this.assetCompiler = null;
    this.assetGenerator = new HttpAssetGenerator({ endpoint: localStorage.getItem('agentscape.assetGeneratorEndpoint') || '' });
    this.assetLibrary = new AssetLibrary({ assetManager: this.assets, generator: this.assetGenerator, events: this.events }); this.articulationVerifier = new ArticulationVerifier({ assets: this.assets }); this.serializer = new SceneSerializer(); this.store = new ObjectStore(); this.physics = new PhysicsSystem(); this.navigation = null; this.clock = new THREE.Clock(); this.running = false;
  }
  async getAssetCompiler() {
    if (!this.assetCompiler) {
      const { AssetCompiler } = await import('../compiler/AssetCompiler.js');
      this.assetCompiler = new AssetCompiler({ store: this.compiledAssetStore, provider: this.compilerProvider, events: this.events, version: this.version });
    }
    return this.assetCompiler;
  }

  async init() {
    await this.physics.init();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 120);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
    this.spatial = new SpatialSystem({ store: this.store, scene: this.scene });
    this.sceneGraph = new SceneGraph({ store: this.store, spatial: this.spatial, events: this.events });
    this.history = new CommandHistory({ apply: (scene) => this.restore(scene), events: this.events });
    this.validator = new WorldValidator(this); this.repair = new RepairEngine(this);
    this.addEnvironment();
    this.navigation = new NavigationSystem({ store: this.store, physics: this.physics, environmentRoots: [this.environment.root], events: this.events });
    this.locomotion = new LocomotionSystem({ store:this.store, physics:this.physics, navigation:this.navigation, events:this.events });
    this.interactions = new InteractionSystem({ store:this.store, physics:this.physics, spatial:this.spatial, navigation:this.navigation, locomotion:this.locomotion, events:this.events });
    this.skills = registerCoreSkills(new SkillRegistry({ policy: this.policy, trace: this.trace, runtime: this }), this);
    this.worldPipeline = createWorldPipeline(this);
    this.resize(); window.addEventListener('resize', this._resize = () => this.resize()); this.running = true; this.animate(); this.trace.emit('runtime.ready', { version: this.version }); this.events.emit('runtime.ready'); return this;
  }
  addEnvironment() {
    if (!this.environmentFactory) throw new Error('WorldRuntime requires an environmentFactory');
    this.environment = this.environmentFactory({ scene:this.scene });
    this.environmentFloor = this.environment.floor;
    const rendering = this.environment.rendering || {};
    const background = rendering.background ?? 0x080b10;
    this.scene.background = new THREE.Color(background);
    const fog = rendering.fog || { color:background, near:22, far:58 };
    this.scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    this.renderer.toneMappingExposure = rendering.exposure ?? 1.1;
    this.scene.add(this.environment.root);
    this.physics.addEnvironment(this.environment.colliders);
    if (this.environment.camera.far) { this.camera.far = this.environment.camera.far; this.camera.updateProjectionMatrix(); }
    this.camera.position.fromArray(this.environment.camera.position);
    this.controls.target.fromArray(this.environment.camera.target);
    this.controls.update();
  }
  async spawn(assetId, { position = [0, 0, 0], id = `${assetId}_${crypto.randomUUID()}` } = {}) {
    const { object, manifest } = await this.assets.instantiate(assetId);
    object.position.fromArray(position);
    object.userData.instanceId = id;
    let stored = false;
    try {
      this.scene.add(object);
      this.store.add(id, { id, assetId, object, manifest, state: {} });
      stored = true;
      this.physics.attach(id, manifest, object);
      this.navigation?.invalidateIfStatic(this.store.get(id), 'object.spawned');
      this.sceneGraph?.changed();
      this.events.emit('object.spawned', { id, assetId, position });
      return id;
    } catch (error) {
      this.physics.remove(id);
      if (stored) this.store.delete(id);
      this.scene.remove(object);
      disposeObject3D(object);
      throw error;
    }
  }
  snapshot() {
    const scene = this.serialize({ name: 'History Snapshot' });
    delete scene.metadata.savedAt;
    return scene;
  }

  async mutate(label, operation, meta = {}) {
    if (this.history?.suspended) return operation();
    if (this.mutationOwner) {
      const error = new Error(`World mutation already in progress: ${this.mutationOwner}`);
      error.code = 'WORLD_MUTATION_BUSY';
      throw error;
    }
    this.mutationOwner = label;
    const before = this.snapshot();
    if (!this.history.begin(label, before)) {
      this.mutationOwner = null;
      const error = new Error('World history transaction unavailable');
      error.code = 'WORLD_MUTATION_BUSY';
      throw error;
    }
    try {
      let result;
      await this.sceneGraph.batch(async () => {
        result = await operation();
        this.sceneGraph.changed();
      });
      this.history.commit(this.snapshot(), meta);
      return result;
    } catch (error) {
      this.history.cancel();
      throw error;
    } finally {
      this.mutationOwner = null;
    }
  }

  beginMutation(label) {
    if (this.history?.suspended || this.mutationOwner) return false;
    if (!this.history.begin(label, this.snapshot())) return false;
    this.mutationOwner = 'editor';
    return true;
  }

  commitMutation(meta = {}) {
    if (this.history?.suspended || (this.mutationOwner && this.mutationOwner !== 'editor')) return false;
    try {
      this.sceneGraph?.changed();
      if (meta.id && this.store.has(meta.id)) this.navigation?.invalidateIfStatic(this.store.get(meta.id), 'editor.transform');
      return this.history.commit(this.snapshot(), meta);
    } finally {
      if (this.mutationOwner === 'editor') this.mutationOwner = null;
    }
  }

  async clearObjects() {
    const ids = this.store.list().map(([id]) => id);
    await this.sceneGraph.batch(async () => {
      for (const id of ids) this.remove(id);
      this.sceneGraph.changed();
    });
    this.events.emit('scene.cleared', { count: ids.length });
  }

  serialize(options) { return this.serializer.serialize(this, options); }
  async restore(scene) { return this.serializer.restore(this, scene); }

  restoreObjectState(id, state = {}) {
    const record = this.store.get(id);
    record.state = structuredClone(state);
    if (record.state.navigation?.status === 'moving') record.state.navigation.status = 'interrupted';
    for (const [partName, action] of Object.entries(state.parts || {})) {
      if (record.manifest.actions.includes(action)) this.interactions.setArticulationAction(id, action, { partName });
    }
    // 兼容 1.1.8 以前的 cabinet 状态。
    if (state.door === 'open') this.interactions.setArticulationAction(id, 'open');
    else if (state.door === 'closed') this.interactions.setArticulationAction(id, 'close');
  }

  remove(id) {
    const record = this.store.get(id);
    this.locomotion?.cancel(id, 'OBJECT_REMOVED');
    this.interactions?.beforeRemove(id);
    this.navigation?.invalidateIfStatic(record, 'object.removed');
    this.physics.remove(id);
    this.scene.remove(record.object);
    disposeObject3D(record.object);
    this.store.delete(id);
    this.sceneGraph?.removeObject(id); this.sceneGraph?.changed();
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
  update() { const dt = Math.min(this.clock.getDelta(), 1 / 30); this.locomotion?.update(dt); if (this.physics.step(dt, this.store)) this.sceneGraph.invalidate(); this.interactions.update(dt, this.camera); this.controls.update(); }
  animate = () => { if (!this.running) return; requestAnimationFrame(this.animate); this.update(); this.renderer.render(this.scene, this.camera); };
  resize() { const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h, false); }
  dispose() {
    this.running = false;
    window.removeEventListener('resize', this._resize);
    for (const [id, record] of this.store.list()) {
      this.physics.remove(id);
      this.scene.remove(record.object);
      disposeObject3D(record.object);
      this.store.delete(id);
    }
    this.sceneGraph.reset();
    this.locomotion?.cancelAll();
    this.locomotion = null;
    this.environment?.dispose();
    this.environment = null;
    disposeObject3D(this.scene);
    this.controls?.dispose();
    this.navigation?.dispose();
    this.navigation = null;
    this.physics.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
    this.events.clear();
  }
}
