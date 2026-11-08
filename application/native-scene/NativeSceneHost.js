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

const bindings = new WeakMap();
const fail = code => Object.assign(new Error(code), { code });

/** Attach to a trusted, already running native Scene. Never own its renderer or loop.
 * Colliders/navigationRoot are explicit world-space environment registration.
 * Native source and closure state are deliberately outside SceneFacade serialization.
 */
export async function attachNativeScene({
  scene: nativeScene, camera, renderer, three = THREE, name = 'Native scene',
  environmentId = 'native-scene', colliders = [], navigationRoot = null,
  staticMeshes = [], walkableMesh = null,
  assetModule = null, autoStart = true, codeExecutor = null, codeGLTFLoader,
  assetBaseUrl = globalThis.location?.origin ? globalThis.location.origin + '/' : null,
} = {}) {
  if (three.Object3D !== THREE.Object3D || three.REVISION !== THREE.REVISION) throw fail('NATIVE_THREE_INSTANCE_MISMATCH');
  if (!nativeScene?.isScene || !camera?.isCamera || typeof renderer?.render !== 'function') throw fail('NATIVE_BINDING_INVALID');
  if (!(nativeScene instanceof THREE.Scene) || !(camera instanceof THREE.Camera)) throw fail('NATIVE_THREE_INSTANCE_MISMATCH');
  if (bindings.has(nativeScene)) throw fail('NATIVE_SCENE_ALREADY_ATTACHED');
  nativeScene.updateWorldMatrix(true, false);
  if (!nativeScene.matrixWorld.equals(new THREE.Matrix4())) throw fail('NATIVE_WORLD_TRANSFORM_UNSUPPORTED');
  if (!Array.isArray(colliders)) throw fail('NATIVE_COLLIDERS_INVALID');
  if (navigationRoot && !navigationRoot.isObject3D) throw fail('NATIVE_NAVIGATION_ROOT_INVALID');
  const extractedColliders = extractNativeStaticColliders(nativeScene, { staticMeshes, walkableMesh });
  const environmentColliders = [...structuredClone(colliders), ...extractedColliders];
  const environmentNavigation = navigationRoot || walkableMesh;
  bindings.set(nativeScene, true); // Reserve before asynchronous physics initialization.
  let assets, world, facade, frameId, closed = false;
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
    world = new WorldRuntime({ assetModule: assets, environmentFactory: () => ({
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
    world.simulation.play();
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
    if (autoStart) frameId = requestAnimationFrame(tick);
    const close = () => {
      if (closed) return;
      facade.close(); // Reject a close during a mutation before detaching anything.
      closed = true;
      if (frameId != null) cancelAnimationFrame(frameId);
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
      importProject: unsupported('NATIVE_PROJECT_IMPORT_UNSUPPORTED'),
      importWorld: unsupported('NATIVE_PROJECT_IMPORT_UNSUPPORTED'),
      prepareWorld: unsupported('NATIVE_PROJECT_IMPORT_UNSUPPORTED'),
      setStyle: unsupported('NATIVE_RENDERING_OWNED_BY_PROJECT'),
      native: { scene: nativeScene, renderer, camera, root: world.scene },
      capabilities: Object.freeze({ mode: 'native-scene', threeRevision: THREE.REVISION,
        sourceConversion: false, ownsRenderer: false, nativeProjectSave: false,
        environmentColliders: environmentColliders.length, navigationRegistered: Boolean(environmentNavigation) }),
    };
    // Runtime is exposed to the local Studio bridge, never serialized over MCP.
    return { scene: handle, world, close };
  } catch (error) {
    if (frameId != null) cancelAnimationFrame(frameId);
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
