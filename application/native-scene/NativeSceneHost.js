import * as THREE from 'three';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { ArticulationVerifier } from '../../modules/world/verification/ArticulationVerifier.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { createSceneFacade } from '../scene/SceneFacade.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { registerSceneSkills } from '../skills/packs/sceneSkills.js';
import { registerSpatialSkills } from '../skills/packs/spatialSkills.js';
import { registerInteractionSkills } from '../skills/packs/interactionSkills.js';
import { extractNativeStaticColliders } from './NativeEnvironmentGeometry.js';
import { writeNativeSceneOverlay, prepareNativeSceneOverlay, restoreNativeSceneOverlay, exportNativeSceneOverlay, importNativeSceneOverlay } from './NativeSceneOverlay.js';

const bindings = new WeakMap();
const fail = code => Object.assign(new Error(code), { code });

/** Attach to a trusted, already running native Scene. Never own its renderer or loop.
 * Colliders/navigationRoot are explicit world-space environment registration.
 * Native source and closure state are deliberately outside SceneFacade serialization.
 */
export async function attachNativeScene({
  scene: nativeScene, camera, renderer, three = THREE, name = 'Native scene',
  environmentId = 'native-scene', colliders = [], navigationRoot = null,
  staticMeshes = [], walkableMesh = null, hostProjectId = null, hostRevision = null,
  assetModule = null, audioListener = null, audioThree = THREE, autoStart = true, codeExecutor = null, codeGLTFLoader,
  assetBaseUrl = globalThis.location?.origin ? globalThis.location.origin + '/' : null,
  onAttach = null,
} = {}) {
  if (three.Object3D !== THREE.Object3D || three.REVISION !== THREE.REVISION) throw fail('NATIVE_THREE_INSTANCE_MISMATCH');
  if (!nativeScene?.isScene || !camera?.isCamera || typeof renderer?.render !== 'function') throw fail('NATIVE_BINDING_INVALID');
  if (!(nativeScene instanceof THREE.Scene) || !(camera instanceof THREE.Camera)) throw fail('NATIVE_THREE_INSTANCE_MISMATCH');
  if (bindings.has(nativeScene)) throw fail('NATIVE_SCENE_ALREADY_ATTACHED');
  nativeScene.updateWorldMatrix(true, false);
  if (!nativeScene.matrixWorld.equals(new THREE.Matrix4())) throw fail('NATIVE_WORLD_TRANSFORM_UNSUPPORTED');
  if (!Array.isArray(colliders)) throw fail('NATIVE_COLLIDERS_INVALID');
  if (hostProjectId != null && (typeof hostProjectId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(hostProjectId))) throw fail('NATIVE_HOST_IDENTITY_INVALID');
  if (hostRevision != null && (typeof hostRevision !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(hostRevision))) throw fail('NATIVE_HOST_IDENTITY_INVALID');
  if (navigationRoot && !navigationRoot.isObject3D) throw fail('NATIVE_NAVIGATION_ROOT_INVALID');
  if (onAttach != null && typeof onAttach !== 'function') throw fail('NATIVE_ATTACH_HOOK_INVALID');
  const extractedColliders = extractNativeStaticColliders(nativeScene, { staticMeshes, walkableMesh });
  const environmentColliders = [...structuredClone(colliders), ...extractedColliders];
  const environmentNavigation = navigationRoot || walkableMesh;
  bindings.set(nativeScene, true); // Reserve before asynchronous physics initialization.
  let assets, world, facade, frameId, closed = false;
  const injectedComponents = new Map();
  const componentId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
  const unsupported = code => async () => { throw fail(code); };
  try {
    const manifests = structuredClone(assetManifests);
    if (assetBaseUrl) {
      for (const manifest of Object.values(manifests)) {
        if (manifest.source?.kind === 'glb') manifest.source.url = new URL(manifest.source.url, assetBaseUrl).href;
      }
    }
    assets = assetModule || createAssetModule({ manifests, volatile: true, manifestStore: null, libraryStore: null });
    const environmentRoot = new THREE.Group();
    environmentRoot.name = 'AgentScapeEnvironment';
    world = new WorldRuntime({ assetModule: assets, audioListener, audioThree, environmentFactory: () => ({
      id: environmentId, root: environmentRoot, colliders: environmentColliders,
      ...(environmentNavigation ? { navigationRoot: environmentNavigation } : {}), dispose() {},
    }) });
    world.scene.name = 'AgentScapeRoot';
    // The runtime owns only this subtree. Host environment/materials stay untouched.
    // A nested Scene is traversed as Object3D; the outer Scene still owns lighting/fog.
    world.attachRendering({ scene: world.scene, renderer, camera,
      init() {}, render() {}, applyEnvironment() {}, dispose() {},
    });
    assets.configureVerification({ articulationVerifier: new ArticulationVerifier({
      assetRegistry: assets.registry, assetLoader: assets.loader,
    }) });
    world.skills = new SkillRegistry({ policy: world.policy, trace: world.trace, runtime: world });
    const add = (name, options, handler) => world.skills.register({ name, ...options, handler });
    registerSceneSkills(add, world);
    registerSpatialSkills(add, world);
    registerInteractionSkills(add, world);
    await world.init();
    facade = createSceneFacade(world, { name, codeExecutor, codeGLTFLoader });
    nativeScene.add(world.scene);
    const frame = timestamp => {
      if (closed) throw fail('SCENE_CLOSED');
      // Do not call renderer.render: the original project owns every render pass.
      facade.frame(timestamp);
    };
    const tick = timestamp => {
      if (closed) return;
      frame(timestamp);
      frameId = requestAnimationFrame(tick);
    };
    const removeComponent = component => {
      if (!component || injectedComponents.get(component.id) !== component) return false;
      injectedComponents.delete(component.id);
      world.audio?.unregisterEmitter(component.id);
      component.unregister?.();
      world.entities.unregister(component.id, { reason:'native-component-removed' });
      if (component.mounted) component.object.removeFromParent();
      return true;
    };
    const registerComponent = ({ id, object, parent = world.scene, semantic = null, audio = false, audioOptions = {} } = {}, mounted = true) => {
      if (closed) throw fail('SCENE_CLOSED');
      if (!componentId(id)) throw fail('NATIVE_COMPONENT_ID_INVALID');
      if (!(object instanceof THREE.Object3D) || !object.isObject3D) throw fail('NATIVE_COMPONENT_OBJECT_INVALID');
      if (!(parent instanceof THREE.Object3D) || !parent.isObject3D) throw fail('NATIVE_COMPONENT_PARENT_INVALID');
      if (injectedComponents.has(id) || [...injectedComponents.values()].some(component => component.object === object)) throw fail('NATIVE_COMPONENT_CONFLICT');
      if (!mounted) {
        let ancestor = object.parent;
        while (ancestor && ancestor !== nativeScene && ancestor !== world.scene) ancestor = ancestor.parent;
        if (ancestor !== nativeScene) throw fail('NATIVE_COMPONENT_NOT_IN_HOST_SCENE');
      }
      if (semantic != null && (typeof semantic !== 'object' || Array.isArray(semantic))) throw fail('NATIVE_COMPONENT_SEMANTIC_INVALID');
      if (world.entities.has(id) || world.store.has(id)) throw fail('NATIVE_COMPONENT_CONFLICT');
      const component = { id, object, parent, mounted, unregister: null, remove: () => removeComponent(component) };
      try {
        if (mounted) parent.add(object);
        world.entities.register({ id, object, source:'native', phase:'visual-mounted', transformAuthority:'host',
          capabilities:['semantic', ...(semantic?.capabilities || [])], metadata:{ label:semantic?.label ?? id } });
        if (audio) {
          if (!world.audio) throw fail('NATIVE_AUDIO_UNAVAILABLE');
          world.audio.registerEmitter(id, object, audioOptions);
        }
        if (semantic) {
          component.unregister = facade.registerEntity({
            id, label: semantic.label ?? id, description: semantic.description ?? '',
            object, read: semantic.read ?? (() => ({})),
          });
        }
        injectedComponents.set(id, component);
        return Object.freeze({ id, object, remove: component.remove });
      } catch (error) {
        component.unregister?.();
        world.audio?.unregisterEmitter(id);
        world.entities.unregister(id, { reason:'native-injection-failed' });
        if (mounted) object.removeFromParent();
        throw error;
      }
    };
    const addComponent = options => registerComponent(options);
    const bindComponent = options => registerComponent(options, false);
    const native = { scene: nativeScene, renderer, camera, root: world.scene, addComponent, bindComponent, audio: world.audio };
    const close = () => {
      if (closed) return;
      facade.close(); // Reject a close during a mutation before detaching anything.
      closed = true;
      if (frameId != null) cancelAnimationFrame(frameId);
      for (const component of [...injectedComponents.values()]) removeComponent(component);
      world.scene.removeFromParent();
      try { world.dispose(); } finally {
        if (!assetModule) assets.loader.gltfLoader.dispose?.();
        bindings.delete(nativeScene);
      }
    };
    const handle = {
      ...facade,
      frame,
      close,
      // Never export a native project as a misleading built-in Scene Project.
      save: unsupported('NATIVE_PROJECT_SAVE_UNSUPPORTED'),
      exportWorld: unsupported('NATIVE_PROJECT_SAVE_UNSUPPORTED'),
      saveOverlay: async (storage, options = {}) => {
        if (closed) throw fail('SCENE_CLOSED');
        if (!hostProjectId) throw fail('NATIVE_HOST_IDENTITY_REQUIRED');
        return writeNativeSceneOverlay(world, storage, { projectId: hostProjectId, revision: hostRevision }, options);
      },
      prepareOverlay: async (storage, root, options = {}) => {
        if (closed) throw fail('SCENE_CLOSED');
        if (!hostProjectId) throw fail('NATIVE_HOST_IDENTITY_REQUIRED');
        const prepared = await prepareNativeSceneOverlay(world, storage, root,
          { projectId: hostProjectId, revision: hostRevision }, options);
        return {
          summary: prepared.summary,
          commit: () => { if (closed) throw fail('SCENE_CLOSED'); return prepared.commit(); },
          dispose: () => prepared.dispose()
        };
      },
      restoreOverlay: async (storage, root, options = {}) => {
        if (closed) throw fail('SCENE_CLOSED');
        if (!hostProjectId) throw fail('NATIVE_HOST_IDENTITY_REQUIRED');
        return restoreNativeSceneOverlay(world, storage, root,
          { projectId: hostProjectId, revision: hostRevision }, options);
      },
      exportOverlay: async (storage, root, writer, options = {}) => {
        if (closed) throw fail('SCENE_CLOSED');
        if (!hostProjectId) throw fail('NATIVE_HOST_IDENTITY_REQUIRED');
        return exportNativeSceneOverlay(storage, root,
          { projectId: hostProjectId, revision: hostRevision }, writer, options);
      },
      importOverlay: async (storage, source, options = {}) => {
        if (closed) throw fail('SCENE_CLOSED');
        if (!hostProjectId) throw fail('NATIVE_HOST_IDENTITY_REQUIRED');
        return importNativeSceneOverlay(storage, source,
          { projectId: hostProjectId, revision: hostRevision }, options);
      },
      importProject: unsupported('NATIVE_PROJECT_IMPORT_UNSUPPORTED'),
      importWorld: unsupported('NATIVE_PROJECT_IMPORT_UNSUPPORTED'),
      prepareWorld: unsupported('NATIVE_PROJECT_IMPORT_UNSUPPORTED'),
      setStyle: unsupported('NATIVE_RENDERING_OWNED_BY_PROJECT'),
      native,
      capabilities: Object.freeze({ mode: 'native-scene', threeRevision: THREE.REVISION,
        sourceConversion: false, ownsRenderer: false, nativeProjectSave: false,
        environmentColliders: environmentColliders.length, navigationRegistered: Boolean(environmentNavigation),
        nativeOverlayPersistence: Boolean(hostProjectId), audio: Boolean(world.audio) }),
    };
    if (onAttach) await onAttach({ scene: handle, native, three: THREE });
    world.simulation.play();
    if (autoStart) frameId = requestAnimationFrame(tick);
    // Runtime is exposed to the local Studio bridge, never serialized over MCP.
    return { scene: handle, world, close };
  } catch (error) {
    if (frameId != null) cancelAnimationFrame(frameId);
    for (const component of [...injectedComponents.values()]) {
      component.unregister?.();
      world.audio?.unregisterEmitter(component.id);
      world.entities.unregister(component.id, { reason:'native-scene-attach-failed' });
      if (component.mounted) component.object.removeFromParent();
    }
    injectedComponents.clear();
    world?.scene.removeFromParent();
    try {
      facade?.close();
      if (world?.sceneGraph) world.dispose();
      else world?.physics.dispose();
    } finally {
      if (!assetModule) assets?.loader.gltfLoader.dispose?.();
      bindings.delete(nativeScene);
    }
    throw error;
  }
}
