import * as THREE from 'three';
import { installThreeBvhRuntime, ensureBoundsTrees } from './spatial/ThreeBvhRuntime.js';
import { EventBus } from '../../core/EventBus.js';
import { ObjectStore } from './ObjectStore.js';
import { PhysicsSystem } from './systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from './physics/RapierPhysicsBackend.js';
import { InteractionSystem } from './systems/InteractionSystem.js';
import { SpatialSystem } from './systems/SpatialSystem.js';
import { NavigationSystem } from './systems/NavigationSystem.js';
import { RecastNavigationBackend } from './navigation/RecastNavigationBackend.js';
import { LocomotionSystem } from './systems/LocomotionSystem.js';
import { RenderingSystem } from './systems/RenderingSystem.js';
import { SceneSerializer } from './SceneSerializer.js';
import { CommandHistory } from './CommandHistory.js';
import { SceneGraph } from './graph/SceneGraph.js';
import { PolicyEngine } from '../../core/PolicyEngine.js';
import { TraceRecorder } from '../../core/TraceRecorder.js';
import { WorldValidator } from '../verification/WorldValidator.js';
import { RepairEngine } from '../verification/RepairEngine.js';
import { disposeObject3D } from '../../core/disposeObject3D.js';
import { ArticulationVerifier } from '../verification/ArticulationVerifier.js';
import { RuleRuntime } from './behavior/RuleRuntime.js';
import { clearInteractionEvidenceForTarget } from '../verification/InteractionEvidence.js';
import { captureWorldAuthority, restoreWorldAuthority } from './WorldAuthority.js';
import { SimulationSession } from './simulation/SimulationSession.js';
import { physicsManifestForUniformScale, scalesEqual, uniformScaleValue } from './ObjectTransform.js';
installThreeBvhRuntime();

const mutationResultCommitted=(result)=>!(
  result?.committed===false ||
  result?.rolledBack===true ||
  result?.recompile?.committed===false
);

export class WorldRuntime {
  constructor(container, { environmentFactory, assetModule, physicsFactory = () => new PhysicsSystem({ backend:new RapierPhysicsBackend() }), navigationBackendFactory = () => new RecastNavigationBackend(), rendererFactory = null, rendererMode = 'auto', rendererTiming = false } = {}) {
    if (!assetModule?.manager || !assetModule?.catalog || !assetModule?.compiledStore) {
      throw new TypeError('WorldRuntime requires an Asset module');
    }
    if (typeof physicsFactory !== 'function') throw new TypeError('WorldRuntime physicsFactory must be a function');
    if (typeof navigationBackendFactory !== 'function') throw new TypeError('WorldRuntime navigationBackendFactory must be a function');
    if (rendererFactory !== null && typeof rendererFactory !== 'function') throw new TypeError('WorldRuntime rendererFactory must be a function');
    this.version = '1.34.2';
    this.container = container; this.environmentFactory = environmentFactory; this.events = new EventBus(); this.mutationOwner = null;
    this.policy = new PolicyEngine(); this.trace = new TraceRecorder({ events: this.events });
    this.assetModule = assetModule;
    this.assets = assetModule.manager;
    this.assetCatalog = assetModule.catalog;
    this.physicsFactory = physicsFactory;
    this.navigationBackendFactory = navigationBackendFactory;
    this.rendererFactory = rendererFactory;
    this.rendererMode = rendererMode;
    this.rendererTiming = Boolean(rendererTiming);
    this.rendering = null;
    this.articulationVerifier = new ArticulationVerifier({ assets: this.assets, physicsFactory }); this.ruleRuntime = new RuleRuntime(this); this.serializer = new SceneSerializer(); this.store = new ObjectStore(); this.physics = physicsFactory(); this.navigation = null;
    this.simulation = new SimulationSession({
      fixedDt:1/60,
      executeStep:(dt)=>this.stepSimulation(dt),
      snapshotWorld:()=>this.snapshot(),
      restoreWorld:(scene)=>this.restore(scene),
      events:this.events
    });
  }
  async init() {
    await this.assetModule.hydrate?.();
    await this.physics.init();
    this.scene = new THREE.Scene();
    const renderingOptions = {
      container:this.container,
      scene:this.scene,
      events:this.events,
      rendererMode:this.rendererMode,
      rendererTiming:this.rendererTiming
    };
    if (this.rendererFactory) renderingOptions.rendererFactory = this.rendererFactory;
    this.rendering = new RenderingSystem(renderingOptions);
    await this.rendering.init();
    this.assets.configureRenderer?.(this.rendering.renderer);
    this.spatial = new SpatialSystem({ store: this.store, scene: this.scene });
    this.sceneGraph = new SceneGraph({ store: this.store, spatial: this.spatial, events: this.events });
    this.history = new CommandHistory({ apply: (scene) => this.restore(scene), events: this.events });
    this.validator = new WorldValidator(this); this.repair = new RepairEngine(this);
    await this.addEnvironment();
    this.createEnvironmentSystems();
    this.ruleRuntime.start();
    const rendering=this.renderingDiagnostics(); this.trace.emit('runtime.ready', { version: this.version, rendering }); this.events.emit('runtime.ready', { rendering }); return this;
  }
  async addEnvironment() {
    if (!this.environmentFactory) throw new Error('WorldRuntime requires an environmentFactory');
    const environment = await this.environmentFactory({ scene:this.scene });
    this.installEnvironment(environment);
    return environment;
  }

  installEnvironment(environment) {
    if (!environment?.root?.isObject3D || !Array.isArray(environment.colliders)) {
      const error=new TypeError('Runtime environment requires root Object3D and colliders');
      error.code='ENVIRONMENT_INVALID';
      throw error;
    }
    this.environment = environment;
    this.environmentFloor = environment.floor || null;
    this.sceneGraph?.setEnvironmentSemantics(environment.id, environment.semantics);
    this.scene.add(environment.root);
    this.rendering?.applyEnvironment(environment);
    this.physics.addEnvironment(environment.colliders,{id:environment.id});
    return environment;
  }

  createEnvironmentSystems() {
    this.navigation = new NavigationSystem({
      store:this.store,physics:this.physics,environmentRoots:[this.environment.navigationRoot || this.environment.root],events:this.events,
      backend:this.navigationBackendFactory()
    });
    this.locomotion = new LocomotionSystem({ store:this.store, physics:this.physics, navigation:this.navigation, events:this.events });
    this.interactions = new InteractionSystem({ store:this.store, physics:this.physics, spatial:this.spatial, navigation:this.navigation, locomotion:this.locomotion, events:this.events });
    return this.navigation;
  }

  teardownEnvironmentSystems(reason='ENVIRONMENT_REPLACED') {
    this.interactions?.cancelPending(reason);
    this.locomotion?.cancelAll(reason);
    this.navigation?.dispose();
    this.interactions=null;
    this.locomotion=null;
    this.navigation=null;
  }

  async replaceEnvironment(environment,{disposePrevious=true,reason='environment-replaced'}={}) {
    if (this.store.list().length) {
      const error=new Error('Environment replacement requires an empty ObjectStore');
      error.code='ENVIRONMENT_REPLACE_REQUIRES_EMPTY_WORLD';
      throw error;
    }
    if (!environment?.root?.isObject3D || !Array.isArray(environment.colliders)) {
      const error=new TypeError('Runtime environment requires root Object3D and colliders');
      error.code='ENVIRONMENT_INVALID';
      throw error;
    }
    const previous=this.environment || null;
    if (previous===environment) return {status:'environment-ready',environmentId:environment.id || null,previousEnvironmentId:previous?.id || null,reused:true};
    this.teardownEnvironmentSystems('ENVIRONMENT_REPLACED');
    if (previous?.root?.parent===this.scene) this.scene.remove(previous.root);
    this.physics.resetWorld();
    try {
      this.installEnvironment(environment);
      this.createEnvironmentSystems();
      this.sceneGraph?.changed();
      this.events?.emit('environment.replaced',{id:environment.id || null,previousId:previous?.id || null,reason});
      if (disposePrevious) previous?.dispose?.();
      return {status:'environment-ready',environmentId:environment.id || null,previousEnvironmentId:previous?.id || null,reused:false};
    } catch (error) {
      let rollbackError=null;
      try {
        if (environment.root?.parent===this.scene) this.scene.remove(environment.root);
        this.teardownEnvironmentSystems('ENVIRONMENT_REPLACE_ROLLBACK');
        this.physics.resetWorld();
        if (previous) {
          this.installEnvironment(previous);
          this.createEnvironmentSystems();
          this.sceneGraph?.changed();
        } else {
          this.environment=null;
          this.environmentFloor=null;
          this.sceneGraph?.setEnvironmentSemantics('environment',null);
        }
      } catch (cause) { rollbackError=cause; }
      if (rollbackError) {
        const failure=new AggregateError([error,rollbackError],'Environment replacement rollback failed',{cause:error});
        failure.code='ENVIRONMENT_REPLACE_ROLLBACK_FAILED';
        failure.rollbackError=rollbackError;
        throw failure;
      }
      throw error;
    }
  }
  async spawn(assetId, { position = [0, 0, 0], quaternion = [0, 0, 0, 1], scale = 1, id = `${assetId}_${crypto.randomUUID()}`, initialState = null } = {}) {
    const { object, manifest } = await this.assets.instantiate(assetId);
    const uniformScale = uniformScaleValue(scale);
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) {
      const error=new TypeError('Object position requires finite vec3'); error.code='OBJECT_POSITION_INVALID'; throw error;
    }
    if (!Array.isArray(quaternion) || quaternion.length !== 4 || !quaternion.every(Number.isFinite)) {
      const error=new TypeError('Object quaternion requires finite vec4'); error.code='OBJECT_ROTATION_INVALID'; throw error;
    }
    let physicsManifest;
    try { physicsManifest = physicsManifestForUniformScale(manifest,uniformScale); }
    catch (error) { disposeObject3D(object); throw error; }
    object.position.fromArray(position);
    object.quaternion.fromArray(quaternion).normalize();
    object.scale.setScalar(uniformScale);
    object.userData.instanceId = id;
    ensureBoundsTrees(object);
    let stored = false;
    try {
      this.scene.add(object);
      this.store.add(id, { id, assetId, object, manifest, state: {}, physicsScale:uniformScale });
      stored = true;
      this.physics.attach(id, physicsManifest, object);
      clearInteractionEvidenceForTarget(this,id);
      if (initialState && Object.keys(initialState).length) this.restoreObjectState(id, initialState);
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

  applyObjectTransform(id,{position=null,quaternion=null,rotationDegrees=null,scale=null}={}, {source='runtime'}={}) {
    const record=this.store.get(id);
    const object=record.object;
    const previous={
      position:object.position.toArray(),
      quaternion:object.quaternion.toArray(),
      scale:uniformScaleValue(object.scale.toArray()),
      physicsScale:Number.isFinite(record.physicsScale)?record.physicsScale:1
    };
    if (position!=null && (!Array.isArray(position) || position.length!==3 || !position.every(Number.isFinite))) {
      const error=new TypeError('Object position requires finite vec3'); error.code='OBJECT_POSITION_INVALID'; throw error;
    }
    const nextPosition=position==null?previous.position:[...position];
    if (quaternion!=null && (!Array.isArray(quaternion) || quaternion.length!==4 || !quaternion.every(Number.isFinite))) {
      const error=new TypeError('Object quaternion requires finite vec4'); error.code='OBJECT_ROTATION_INVALID'; throw error;
    }
    let nextQuaternion=quaternion==null?[...previous.quaternion]:[...quaternion];
    if (rotationDegrees!=null) {
      if (!Array.isArray(rotationDegrees) || rotationDegrees.length!==3 || !rotationDegrees.every(Number.isFinite)) {
        const error=new TypeError('Object rotation requires finite degree vec3'); error.code='OBJECT_ROTATION_INVALID'; throw error;
      }
      const euler=new THREE.Euler(...rotationDegrees.map(THREE.MathUtils.degToRad),'XYZ');
      nextQuaternion=new THREE.Quaternion().setFromEuler(euler).toArray();
    }
    const nextScale=scale==null?previous.scale:uniformScaleValue(scale);
    const scaleChanged=!scalesEqual(nextScale,previous.physicsScale);
    if (scaleChanged && record.state?.heldBy) {
      const error=new Error(`Cannot scale held object: ${id}`); error.code='OBJECT_SCALE_HELD_UNSUPPORTED'; throw error;
    }
    const nextPhysicsManifest=scaleChanged?physicsManifestForUniformScale(record.manifest,nextScale):null;
    const previousPhysicsManifest=scaleChanged?physicsManifestForUniformScale(record.manifest,previous.physicsScale):null;

    object.position.fromArray(nextPosition);
    object.quaternion.fromArray(nextQuaternion).normalize();
    object.scale.setScalar(nextScale);
    object.updateMatrixWorld(true);
    try {
      if (scaleChanged) {
        this.physics.remove(id);
        this.physics.attach(id,nextPhysicsManifest,object);
        record.physicsScale=nextScale;
      } else this.physics.syncTransform(id,object);
    } catch (error) {
      object.position.fromArray(previous.position);
      object.quaternion.fromArray(previous.quaternion);
      object.scale.setScalar(previous.scale);
      object.updateMatrixWorld(true);
      if (scaleChanged) {
        try { this.physics.remove(id); } catch {}
        this.physics.attach(id,previousPhysicsManifest,object);
        record.physicsScale=previous.physicsScale;
      } else this.physics.syncTransform(id,object);
      throw error;
    }
    this.navigation?.invalidateIfStatic(record,'object.transformed');
    this.events.emit('object.transformed',{
      id,source,position:[...nextPosition],quaternion:[...nextQuaternion],scale:nextScale,physicsRebuilt:scaleChanged
    });
    return {status:'object-transformed',id,position:[...nextPosition],quaternion:[...nextQuaternion],scale:nextScale,physicsRebuilt:scaleChanged};
  }

  snapshot() {
    const scene = this.serialize({ name: 'History Snapshot' });
    delete scene.metadata.savedAt;
    return scene;
  }

  captureWorldAuthority() { return captureWorldAuthority(this); }
  restoreWorldAuthority(authority) { return restoreWorldAuthority(this,authority); }

  async exclusiveMutation(label, operation) {
    if (this.mutationOwner) {
      const error = new Error(`World mutation already in progress: ${this.mutationOwner}`);
      error.code = 'WORLD_MUTATION_BUSY';
      throw error;
    }
    this.mutationOwner=label;
    try { return await operation(); }
    finally { this.mutationOwner=null; }
  }

  async mutate(label, operation, meta = {}) {
    if (this.history?.suspended) return operation();
    if (this.mutationOwner) {
      const error = new Error(`World mutation already in progress: ${this.mutationOwner}`);
      error.code = 'WORLD_MUTATION_BUSY';
      throw error;
    }
    this.mutationOwner = label;
    try {
      const authorityBefore=captureWorldAuthority(this);
      const before = this.snapshot();
      if (!this.history.begin(label, before)) {
        const error = new Error('World history transaction unavailable');
        error.code = 'WORLD_MUTATION_BUSY';
        throw error;
      }
      try {
        let result;
        await this.sceneGraph.batch(async () => {
          result = await operation();
          if(mutationResultCommitted(result)) this.sceneGraph.changed();
        });
        if(!mutationResultCommitted(result)){
          restoreWorldAuthority(this,authorityBefore);
          this.history.cancel();
          return result;
        }
        this.history.commit(this.snapshot(), meta);
        return result;
      } catch (error) {
        this.history.cancel();
        try {
          await this.restore(before);
          restoreWorldAuthority(this,authorityBefore);
        } catch (rollbackError) {
          const failure = new AggregateError(
            [error, rollbackError],
            `World mutation rollback failed: ${label}`,
            { cause:error }
          );
          failure.code = 'WORLD_MUTATION_ROLLBACK_FAILED';
          failure.rollbackError = rollbackError;
          throw failure;
        }
        throw error;
      }
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

  async clearObjects({silent=false}={}) {
    const ids = this.store.list().map(([id]) => id);
    await this.sceneGraph.batch(async () => {
      for (const id of ids) this.remove(id,{silent});
      this.sceneGraph.changed();
    });
    if(!silent) this.events.emit('scene.cleared', { count: ids.length });
  }

  serialize(options) { return this.serializer.serialize(this, options); }
  async restore(scene) { return this.serializer.restore(this, scene); }

  loadRuleGraph(graph) { return this.ruleRuntime.load(graph); }

  applyStateTransition(id, stateKey, value, meta = {}) {
    const record=this.store.get(id);
    if(!record) { const error=new Error(`State target not found: ${id}`); error.code='STATE_TARGET_NOT_FOUND'; throw error; }
    const key=String(stateKey||'').trim();
    if(!key || key.includes('.') || key.startsWith('__')) { const error=new Error('Invalid state key'); error.code='STATE_KEY_INVALID'; throw error; }
    if(value!==null && !['string','number','boolean'].includes(typeof value)) { const error=new TypeError('State value must be a JSON scalar'); error.code='STATE_VALUE_INVALID'; throw error; }
    record.state ||= {};
    record.state[key]=value;
    this.sceneGraph?.changed();
    this.events.emit('world.state-transition',{id,stateKey:key,value,meta});
    return {status:'state-transition-applied',targetId:id,stateKey:key,value};
  }

  restoreObjectState(id, state = {}) {
    const record = this.store.get(id);
    record.state = structuredClone(state);
    if (record.state.navigation?.status === 'moving') record.state.navigation.status = 'interrupted';
    const articulationTargets = Object.keys(state.partTargets || {}).length ? state.partTargets : (state.parts || {});
    for (const [partName, action] of Object.entries(articulationTargets)) {
      if (record.manifest.actions.includes(action)) this.interactions.setArticulationAction(id, action, { partName });
    }
    // 兼容 1.1.8 以前的 cabinet 状态。
    if (state.door === 'open') this.interactions.setArticulationAction(id, 'open');
    else if (state.door === 'closed') this.interactions.setArticulationAction(id, 'close');
  }

  remove(id,{silent=false}={}) {
    const record = this.store.get(id);
    this.locomotion?.cancel(id, 'OBJECT_REMOVED');
    this.interactions?.beforeRemove(id,{silent});
    this.navigation?.invalidateIfStatic(record, 'object.removed');
    this.physics.remove(id);
    this.scene.remove(record.object);
    disposeObject3D(record.object);
    this.store.delete(id);
    clearInteractionEvidenceForTarget(this,id);
    this.sceneGraph?.removeObject(id); this.sceneGraph?.changed();
    if(!silent) this.events.emit('object.removed', { id, assetId: record.assetId });
    return true;
  }

  async duplicate(id) {
    const record = this.store.get(id);
    const p = record.object.position;
    const duplicateId = `${record.assetId}_${crypto.randomUUID()}`;
    await this.spawn(record.assetId, {
      position:[p.x + 0.6,p.y,p.z + 0.6],
      quaternion:record.object.quaternion.toArray(),
      scale:uniformScaleValue(record.object.scale.toArray()),
      id:duplicateId
    });
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
      scale: Number(uniformScaleValue(r.object.scale.toArray()).toFixed(3)),
      actions: [...r.manifest.actions]
    };
  }

  listObjects() { return this.store.list().map(([id, r]) => ({ id, asset: r.assetId, position: r.object.position.toArray().map(v => Number(v.toFixed(2))), actions: [...r.manifest.actions] })); }
  stepSimulation(dt) {
    this.locomotion?.update(dt);
    if (this.physics.step(dt, this.store)) this.sceneGraph.invalidate();
    this.interactions?.update(dt);
  }
  renderingDiagnostics() { return this.rendering?.diagnostics?.() || null; }
  resize() { return this.rendering?.resize?.() ?? false; }
  dispose() {
    this.interactions?.cancelPending('RUNTIME_DISPOSED');
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
    this.navigation?.dispose();
    this.navigation = null;
    this.physics.dispose();
    this.simulation?.pause();
    this.rendering?.dispose?.();
    this.rendering = null;
    this.events.clear();
  }
}
