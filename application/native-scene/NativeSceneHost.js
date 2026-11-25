import * as THREE from 'three';
import * as z from 'zod/v4';
import { assetPhysicsSchema, canonicalAssetJson } from '../../modules/asset/model/AssetInputContracts.js';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { ArticulationVerifier } from '../../modules/world/verification/ArticulationVerifier.js';
import { clearInteractionEvidenceForTarget } from '../../modules/world/verification/InteractionEvidence.js';
import { IncrementalSha256 } from '../../modules/artifact/IncrementalSha256.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { createSceneFacade } from '../scene/SceneFacade.js';
import { createSceneLifecycle } from '../scene/SceneLifecycle.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { registerSceneSkills } from '../skills/packs/sceneSkills.js';
import { registerSpatialSkills } from '../skills/packs/spatialSkills.js';
import { registerInteractionSkills } from '../skills/packs/interactionSkills.js';
import { NativeEditableRegistry } from './NativeEditableRegistry.js';
import { parseNativeArticulation } from './NativeArticulation.js';
import { extractNativeStaticColliders } from './NativeEnvironmentGeometry.js';
import { analyzeNativePhysicsGeometry, containsNativeObject, overlapsNativeObject } from './NativePhysicsGeometry.js';
import { writeNativeSceneOverlay, prepareNativeSceneOverlay, restoreNativeSceneOverlay, exportNativeSceneOverlay, importNativeSceneOverlay } from './NativeSceneOverlay.js';

function nativePhysicsSignature(physics,surfaces,colliderSource,articulation=null){
  const definition=JSON.parse(JSON.stringify({physics,surfaces,colliderSource,...(articulation?{articulation}:{})}));
  return new IncrementalSha256().update(new TextEncoder().encode(canonicalAssetJson(definition))).digestHex();
}

const bindings = new WeakMap();
const fail = code => Object.assign(new Error(code), { code });
const nativeColliderSize = z.number().finite().positive().max(100);
const nativeColliderOffset = z.tuple([z.number().finite().min(-100).max(100), z.number().finite().min(-100).max(100), z.number().finite().min(-100).max(100)]).default(() => [0, 0, 0]);
const nativeColliderRotation = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
  .refine(rotation => Math.abs(Math.hypot(...rotation) - 1) < 1e-4);
const nativeBoxCollider = assetPhysicsSchema.shape.colliders.element.extend({ rotation: nativeColliderRotation.optional() });
const nativeRoundCollider = z.object({
  shape: z.enum(['capsule', 'cylinder']), radius: nativeColliderSize, halfHeight: nativeColliderSize,
  translation: nativeColliderOffset, rotation: nativeColliderRotation.optional(),
}).strict();
const nativeSurfaceSchema=z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  localPosition:nativeColliderOffset, size:z.tuple([nativeColliderSize,nativeColliderSize])}).strict();
const nativePhysicsSchema = assetPhysicsSchema.extend({
  body: z.enum(['fixed', 'dynamic', 'kinematic']),
  manipulable:z.boolean().optional(), lockTranslation:z.tuple([z.boolean(),z.boolean(),z.boolean()]).optional(),
  lockRotation:z.tuple([z.boolean(),z.boolean(),z.boolean()]).optional(),
  colliders: z.array(z.union([nativeBoxCollider, nativeRoundCollider])).min(1).max(64),
});

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
  // Explicit navigationRoot is a caller-authored proxy. Otherwise derive
  // navigation from the very same frozen physical environment inputs.
  const environmentNavigation = navigationRoot;
  const navigationColliders=navigationRoot?null:environmentColliders;
  bindings.set(nativeScene, true); // Reserve before asynchronous physics initialization.
  let assets, world, facade, frameId, closed = false;
  const injectedComponents = new Map();
  const componentId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
  const unsupported = code => async () => { throw fail(code); };
  const restoreMount = component => {
    component.object.removeFromParent();
    if (!component.originalParent) return;
    component.originalParent.add(component.object);
    const children = component.originalParent.children;
    const currentIndex = children.indexOf(component.object);
    children.splice(currentIndex, 1);
    children.splice(Math.min(component.originalIndex, children.length), 0, component.object);
  };
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
      ...(environmentNavigation ? { navigationRoot: environmentNavigation } : {navigationColliders}), dispose() {},
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
    const lifecycle = createSceneLifecycle(world);
    const nativeEditables = new NativeEditableRegistry(nativeScene,world);
    facade = createSceneFacade(world, { name, codeExecutor, codeGLTFLoader, lifecycle, nativeEditables });
    nativeScene.add(world.scene);
    const syncKinematicComponents = () => {
      for (const component of injectedComponents.values()) {
        if (component.bodyType !== 'kinematic') continue;
        const position = component.object.getWorldPosition(new THREE.Vector3());
        const rotation = component.object.getWorldQuaternion(new THREE.Quaternion());
        world.physics.setHeldTarget(component.id, position.toArray(), rotation.toArray());
      }
    };
    const writebackPhysicsComponents = () => world.physics.writeback({
      has: id => Boolean(injectedComponents.get(id)?.physics) && injectedComponents.get(id)?.bodyType !== 'kinematic',
      get: id => injectedComponents.get(id),
    });
    const frame = timestamp => {
      if (closed) throw fail('SCENE_CLOSED');
      // Do not call renderer.render: the original project owns every render pass.
      syncKinematicComponents();
      facade.frame(timestamp);
      writebackPhysicsComponents();
    };
    const step = () => {
      if (closed) throw fail('SCENE_CLOSED');
      syncKinematicComponents();
      const result = facade.step();
      writebackPhysicsComponents();
      return result;
    };
    const tick = timestamp => {
      if (closed) return;
      frame(timestamp);
      frameId = requestAnimationFrame(tick);
    };
    const removeComponent = component => {
      if (!component || injectedComponents.get(component.id) !== component) return false;
      if (!closed) lifecycle.assertIdle();
      world.interactions?.beforeRemove(component.id);
      injectedComponents.delete(component.id);
      clearInteractionEvidenceForTarget(world,component.id);
      world.audio?.unregisterEmitter(component.id);
      if (component.physics) world.physics.removeObject(component.id);
      if(component.bodyType==='fixed')world.navigation?.invalidate('native-fixed-removed');
      component.unregister?.();
      world.entities.unregister(component.id, { reason:'native-component-removed' });
      if (component.mounted) component.object.removeFromParent();
      if(!closed)lifecycle.incrementRevision();
      return true;
    };
    const analyzePhysics = object => {
      if(closed)throw fail('SCENE_CLOSED');
      if(!object?.isObject3D||object===nativeScene||!containsNativeObject(nativeScene,object)||
        overlapsNativeObject(world.scene,object))throw fail('NATIVE_COMPONENT_NOT_IN_HOST_SCENE');
      const existing=[...injectedComponents.values()].find(component=>component.physics&&overlapsNativeObject(component.object,object));
      if(existing)throw fail('NATIVE_PHYSICS_COMPONENT_OVERLAP');
      if([...staticMeshes,walkableMesh].filter(Boolean).some(mesh=>overlapsNativeObject(mesh,object)))
        throw fail('NATIVE_PHYSICS_ENVIRONMENT_OVERLAP');
      return analyzeNativePhysicsGeometry(object);
    };
    const registerComponent = ({ id, object, parent = world.scene, semantic = null, audio = false, audioOptions = {}, physics = null, actions = [], surfaces = [], parts = {} } = {}, mounted = true) => {
      if (closed) throw fail('SCENE_CLOSED');
      lifecycle.assertIdle();
      if (!componentId(id)) throw fail('NATIVE_COMPONENT_ID_INVALID');
      if (!(object instanceof THREE.Object3D) || !object.isObject3D) throw fail('NATIVE_COMPONENT_OBJECT_INVALID');
      if (!(parent instanceof THREE.Object3D) || !parent.isObject3D) throw fail('NATIVE_COMPONENT_PARENT_INVALID');
      if (injectedComponents.has(id) || [...injectedComponents.values()].some(component => component.object === object)) throw fail('NATIVE_COMPONENT_CONFLICT');
      if (mounted) {
        for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
          if (ancestor === object) throw fail('NATIVE_COMPONENT_PARENT_INVALID');
        }
      }
      if (!mounted) {
        let ancestor = object.parent;
        while (ancestor && ancestor !== nativeScene && ancestor !== world.scene) ancestor = ancestor.parent;
        if (ancestor !== nativeScene) throw fail('NATIVE_COMPONENT_NOT_IN_HOST_SCENE');
      }
      if (semantic != null && (typeof semantic !== 'object' || Array.isArray(semantic))) throw fail('NATIVE_COMPONENT_SEMANTIC_INVALID');
      if (!Array.isArray(actions)) throw fail('NATIVE_COMPONENT_ACTIONS_INVALID');
      if (world.entities.has(id) || world.store.has(id) || world.physics.entries.has(id)) throw fail('NATIVE_COMPONENT_CONFLICT');
      const parsedSurfaces=z.array(nativeSurfaceSchema).max(16).safeParse(surfaces);
      if(!parsedSurfaces.success||new Set(surfaces.map(s=>s.id)).size!==surfaces.length)throw fail('NATIVE_SURFACE_INVALID');
      if(surfaces.length&&physics?.body!=='fixed')throw fail('NATIVE_SURFACE_REQUIRES_FIXED');
      if(!parts||typeof parts!=='object'||Array.isArray(parts))throw fail('NATIVE_ARTICULATION_INVALID');
      const articulated=Object.keys(parts).length>0;
      if(articulated&&(mounted||physics?.body!=='fixed'||physics.colliders==='mesh-bounds'||surfaces.length))
        throw fail('NATIVE_ARTICULATION_REQUIRES_BOUND_FIXED_ROOT');
      let physicsSpec = null,colliderSource=null,articulation=null;
      if (physics != null) {
        colliderSource='declared';
        if([...injectedComponents.values()].some(component=>component.physics&&
            (overlapsNativeObject(component.object,object)||(mounted&&containsNativeObject(component.object,parent)))))
          throw fail('NATIVE_PHYSICS_COMPONENT_OVERLAP');
        if([...staticMeshes,walkableMesh].filter(Boolean).some(mesh=>overlapsNativeObject(mesh,object)||(mounted&&containsNativeObject(mesh,parent))))
          throw fail('NATIVE_PHYSICS_ENVIRONMENT_OVERLAP');
        if(physics.colliders==='mesh-bounds'){
          if(mounted)throw fail('NATIVE_PHYSICS_BOUNDS_BIND_ONLY');
          if(physics.body==='dynamic'&&physics.mass==null)throw fail('NATIVE_PHYSICS_MASS_REQUIRED');
          physics={...physics,colliders:analyzePhysics(object).colliders};
          colliderSource='mesh-bounds';
        }
        if(physics.carryable===true&&physics.body!=='dynamic')throw fail('NATIVE_CARRY_REQUIRES_DYNAMIC');
        if(physics.manipulable===true||physics.carryable===true){
          if(physics.body!=='dynamic')throw fail('NATIVE_MANIPULATION_REQUIRES_DYNAMIC');
          if(physics.mass==null)throw fail('NATIVE_PHYSICS_MASS_REQUIRED');
          if(mounted&&!containsNativeObject(nativeScene,parent))throw fail('NATIVE_COMPONENT_NOT_IN_HOST_SCENE');
        }
        const parsed = nativePhysicsSchema.safeParse(physics);
        if (!parsed.success) throw fail('NATIVE_PHYSICS_INVALID');
        if (!object.matrixAutoUpdate) throw fail('NATIVE_PHYSICS_MATRIX_AUTO_UPDATE_REQUIRED');
        if (object.matrixAutoUpdate) object.updateMatrix();
        const matrix = new THREE.Matrix4();
        if (mounted) {
          parent.updateWorldMatrix(true, false);
          matrix.multiplyMatrices(parent.matrixWorld, object.matrix);
        } else {
          object.updateWorldMatrix(true, false);
          matrix.copy(object.matrixWorld);
        }
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(position, rotation, scale);
        const reconstructed = new THREE.Matrix4().compose(position, rotation, scale);
        if (scale.toArray().some(value => Math.abs(value - 1) > 1e-6) ||
            matrix.elements.some((value, index) => Math.abs(value - reconstructed.elements[index]) > 1e-6)) {
          throw fail('NATIVE_PHYSICS_SCALE_UNSUPPORTED');
        }
        if(surfaces.length&&1-Math.abs(rotation.w)>1e-6)throw fail('NATIVE_SURFACE_ROTATION_UNSUPPORTED');
        physicsSpec = parsed.data;
        if(articulated)articulation=parseNativeArticulation(object,parts,nativePhysicsSchema);
        nativeEditables.assertPhysicsCompatible(object,physicsSpec.body);
      }
      const manifest=physicsSpec?{physics:physicsSpec,nativeNavigation:true,...(articulation?{parts:articulation.parts,nativeArticulation:true}:{})}:null;
      const component = { id, object, parent, mounted, originalParent: object.parent,
        originalIndex: object.parent?.children.indexOf(object) ?? -1,
        physics: false, bodyType: physicsSpec?.body ?? null, unregister: null, remove: () => removeComponent(component) };
      try {
        if (mounted) parent.add(object);
        world.entities.register({ id, object, source:'native', manifest, phase:'visual-mounted', transformAuthority:physicsSpec ? physicsSpec.body === 'kinematic' ? 'host' : 'physics' : 'host',
          capabilities:['semantic', ...(physicsSpec ? ['physics'] : []), ...(articulation?['articulation']:[]), ...(actions.length||articulation ? ['interaction'] : []), ...(semantic?.capabilities || [])],
          metadata:{label:semantic?.label??id,...(physicsSpec?{colliderSource,manipulable:physicsSpec.manipulable===true,carryable:physicsSpec.carryable===true,surfaces:parsedSurfaces.data,hostSceneUuid:nativeScene.uuid,bindingId:crypto.randomUUID(),physicsSignature:nativePhysicsSignature(physicsSpec,parsedSurfaces.data,colliderSource,articulation),...(articulation?{articulationRest:articulation.rest,articulationNodeUuids:Object.fromEntries(Object.entries(articulation.parts).map(([name,part])=>[name,object.getObjectByName(part.node).uuid]))}:{})}: {})} });
        if (physicsSpec) {
          world.physics.addObject(id, manifest, object);
          component.physics = true;
          world.entities.setPhase(id, 'physics-registered');
          if(physicsSpec.body==='fixed')world.navigation?.invalidate('native-fixed-registered');
        }
        if (audio) {
          if (!world.audio) throw fail('NATIVE_AUDIO_UNAVAILABLE');
          world.audio.registerEmitter(id, object, audioOptions);
        }
        component.unregister = facade.registerEntity({
          id, label: semantic?.label ?? id, description: semantic?.description ?? '',
          object, read: semantic?.read ?? (() => ({})),
        });
        for (const action of actions) {
          facade.registerAction({ ...action, target: id });
        }
        clearInteractionEvidenceForTarget(world,id);
        injectedComponents.set(id, component);
        lifecycle.incrementRevision();
        return Object.freeze({ id, object, remove: component.remove });
      } catch (error) {
        component.unregister?.();
        world.audio?.unregisterEmitter(id);
        if (component.physics) world.physics.removeObject(id);
        world.entities.unregister(id, { reason:'native-injection-failed' });
        if (mounted) restoreMount(component);
        throw error;
      }
    };
    const addComponent = options => registerComponent(options);
    const bindComponent = options => registerComponent(options, false);
    const native = { scene: nativeScene, renderer, camera, root: world.scene, addComponent, bindComponent, analyzePhysics, audio: world.audio,
      editables:Object.freeze({register:options=>nativeEditables.register(options),list:()=>nativeEditables.list(),
        getObject:id=>nativeEditables.objectFor(id)}) };
    const close = () => {
      if (closed) return;
      facade.close(); // Reject a close during a mutation before detaching anything.
      closed = true;
      if (frameId != null) cancelAnimationFrame(frameId);
      for (const component of [...injectedComponents.values()]) removeComponent(component);
      world.scene.removeFromParent();
      nativeEditables.dispose();
      try { world.dispose(); } finally {
        if (!assetModule) assets.loader.gltfLoader.dispose?.();
        bindings.delete(nativeScene);
      }
    };
    const handle = {
      ...facade,
      frame,
      step,
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
          commit: () => { if (closed) throw fail('SCENE_CLOSED');return prepared.commit(); },
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
      registerEditable:options=>nativeEditables.register(options),
      nativeEditables:()=>nativeEditables.list(),
      exportNativeEdits:()=>nativeEditables.export(),
      restoreNativeEdits:snapshot=>nativeEditables.restore(snapshot),
      capabilities: Object.freeze({ mode: 'native-scene', threeRevision: THREE.REVISION,
        sourceConversion: false, ownsRenderer: false, nativeProjectSave: false,
        environmentColliders: environmentColliders.length, navigationRegistered: Boolean(environmentNavigation||navigationColliders?.length),
        navigationSource:environmentNavigation?'explicit-proxy':'physics-colliders',
        nativeOverlayPersistence: Boolean(hostProjectId), audio: Boolean(world.audio) }),
    };
    if (onAttach) await onAttach({ scene: handle, native, three: THREE });
    world.simulation.play();
    if (autoStart) frameId = requestAnimationFrame(tick);
    // Runtime is exposed to the local Studio bridge, never serialized over MCP.
    return { scene: handle, world, close };
  } catch (error) {
    if (frameId != null) cancelAnimationFrame(frameId);
    for (const component of [...injectedComponents.values()].reverse()) {
      component.unregister?.();
      world.audio?.unregisterEmitter(component.id);
      if (component.physics) world.physics.removeObject(component.id);
      world.entities.unregister(component.id, { reason:'native-scene-attach-failed' });
      if (component.mounted) restoreMount(component);
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
