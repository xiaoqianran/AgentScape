import { createSceneEditService } from './SceneEditService.js';
import { describeCapabilities, inspectCapabilities } from './CapabilityResolver.js';
import { createSceneJobController } from './SceneJobController.js';
import { createScenePersistence } from './ScenePersistence.js';
import { sceneError, sceneInteractionSchema } from './SceneContracts.js';
import { SCENE_LEGACY_SKILLS } from './SceneSkillNames.js';
import * as z from 'zod/v4';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';
import { findEnvironment } from '../../modules/world/content/environments.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { ArticulationVerifier } from '../../modules/world/verification/ArticulationVerifier.js';
import { StyleSystem } from '../../modules/rendering/style/StyleSystem.js';
import { compileWorldAcceptance, evaluateWorldAcceptance } from '../../modules/world/verification/WorldAcceptance.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { registerSceneSkills } from '../skills/packs/sceneSkills.js';
import { registerSpatialSkills } from '../skills/packs/spatialSkills.js';
import { registerInteractionSkills } from '../skills/packs/interactionSkills.js';
import { AgentTools } from '../AgentTools.js';
import { parseSceneProject, sceneObjectIdSchema as id } from './SceneProject.js';

export { sceneError, sceneAgentModelSchema, sceneInteractionSchema } from './SceneContracts.js';
export { SCENE_LEGACY_SKILLS } from './SceneSkillNames.js';

const services = new WeakMap();

/** One application service per existing Runtime. No entity or asset cache. */
export function createSceneFacade(world, { ownsWorld = false, name = 'Untitled World', codeExecutor = null, codeGLTFLoader = undefined } = {}) {
  if (services.has(world)) return services.get(world);
  let busy = false, closed = false, revision = 0, selectedActor = null;
  const tools = new AgentTools(world, { profile: 'builder', source: 'scene-api' });
  const styles = new StyleSystem({ scene: world.scene, events: world.events, getRenderer: () => world.rendering?.renderer, getCamera: () => world.rendering?.camera });
  world.rendering?.attachStyleSystem?.(styles);
  const unsubscribe = ['history.recorded', 'history.applied', 'scene.restored'].map(event => world.events.on(event, () => { revision++; }));
  const assertOpen = () => { if (closed) throw sceneError('SCENE_CLOSED'); };
  const assertIdle = () => { assertOpen(); if (busy || world.mutationOwner) throw sceneError('SCENE_BUSY'); };
  const exclusive = async operation => { assertIdle(); busy = true; try { return await operation(); } finally { busy = false; } };
  const result = (operation, value, extra = {}) => ({ schema: 'agentscape.scene-result', schemaVersion: 1, operation, status: 'succeeded', revision,
    admission: null, verification: { status: 'not-requested', evidence: null }, diagnostics: [], value, ...extra });
  const edit = createSceneEditService(world, { exclusive, assertOpen, assertIdle, getRevision: () => revision, result, codeExecutor, codeGLTFLoader });
  const jobController = createSceneJobController(world, { tools, assertOpen, assertIdle, setBusy: value => { busy = value; }, actors: () => facade.actors(), onProjectAction: () => { revision++; }, result });
  const persistence = createScenePersistence(world, { name, styles, assertIdle, exclusive, result });
  const withListingCapabilities = listing => ({ ...listing,
    entities:listing.entities.map(entry => ({ ...entry, capabilities:describeCapabilities(entry) })) });
  const facade = {
    captureProjectState(capture) { return exclusive(capture); },
    registerEntity(definition) { assertOpen(); return world.projectCapabilities.registerEntity(definition); },
    registerAction(definition) { assertOpen(); return world.projectCapabilities.registerAction(definition); },
    registerStateMachine(definition) { assertOpen(); return world.projectCapabilities.registerStateMachine(definition); },
    actors() {
      assertOpen();
      const agents=world.store.list().filter(([,record])=>record.manifest?.type==='agent').map(([id])=>({id,position:world.physics.getPosition(id)}));
      return {agents,selected:agents.some(agent=>agent.id===selectedActor)?selectedActor:agents.length===1?agents[0].id:null};
    },
    selectActor(actor) {
      assertIdle();id.parse(actor);
      if(!facade.actors().agents.some(agent=>agent.id===actor))throw sceneError('ACTOR_NOT_AGENT');
      selectedActor=actor;world.events.emit('scene.actor.selected',{actor});return facade.actors();
    },
    inspect(target, options = {}) {
      assertOpen(); z.string().min(1).max(256).parse(target);
      const { actor } = z.object({ actor: id.optional() }).strict().parse(options);
      const inspection = inspectCapabilities(world, target, { actor });
      if (!inspection) throw sceneError('OBJECT_NOT_FOUND');
      return inspection;
    },
    observe(options = {}) {
      const { actor, offset, limit } = z.object({ actor: id.optional(),
        offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(1000).optional()
      }).strict().parse(options);
      assertOpen();
      // Explicit object pages do not derive the global graph or affordances.
      if (limit != null) {
        const page = world.store.page({ offset, limit });
        return { schema: 'agentscape.scene-object-page', schemaVersion: 1, revision,
          total: world.store.size, offset, nextOffset: page.nextOffset,
          objects: page.entries.map(([key, record]) => ({ ...world.observation.object(key), state: structuredClone(record.state),
            transform: { position: record.object.position.toArray(), quaternion: record.object.quaternion.toArray(), scale: record.object.scale.x },
            physicsRegistered: Boolean(world.physics.getPosition(key)) })) };
      }
      if (offset) throw sceneError('PAGE_LIMIT_REQUIRED');
      world.sceneGraph.update();
      const native = world.queries?.listEnvironmentInteractables?.({actorId:actor,radius:20});
      return { schema: 'agentscape.scene-observation', schemaVersion: 1, revision,
        style: styles.export(), actors:facade.actors(), affordances: withListingCapabilities(world.affordances.list({ actorId: actor, limit: 100 })),
        project: withListingCapabilities(world.projectCapabilities.list({ actor })),
        // Native interaction points are not Asset entities. Expose their stable
        // IDs and explicitly provisional evidence without claiming physics verification.
        nativeInteractions: {
          count:native?.items?.length || 0,
          items:(native?.items || []).slice(0,100),
          truncated:(native?.items?.length || 0)>100
        },
        objects: world.store.list().map(([key, record]) => ({ ...world.observation.object(key), state: structuredClone(record.state),
          transform: { position: record.object.position.toArray(), quaternion: record.object.quaternion.toArray(), scale: record.object.scale.x },
          physicsRegistered: Boolean(world.physics.getPosition(key)) })), relations: structuredClone(world.sceneGraph.list()) };
    },
    apply: input => edit.apply(input),
    // Compatibility entry for audited legacy adapters; public SDK types expose
    // intent-level methods. The same service lock and Runtime own execution.
    executeSkill(name, args) {
      if (!SCENE_LEGACY_SKILLS.includes(name)) throw sceneError('SKILL_FORBIDDEN');
      return exclusive(() => tools.call(name, args));
    },
    prepareAsset: input => edit.prepareAsset(input),
    screenAsset: input => edit.screenAsset(input),
    addModel: (input, options) => edit.addModel(input, options),
    setTransform: input => edit.setTransform(input),
    remove: input => edit.remove(input),
    replaceAsset: input => edit.replaceAsset(input),
    interact: input => jobController.interact(input),
    getJob: key => jobController.getJob(key),
    waitJob: key => jobController.waitJob(key),
    cancelJob: key => jobController.cancelJob(key),
    verify(criteria = [{ id: 'valid', kind: 'world-valid' }]) {
      assertIdle(); const evidence = evaluateWorldAcceptance(world, compileWorldAcceptance(criteria));
      return result('verify', evidence, { verification: { status: evidence.status === 'world-accepted' ? 'verified' : 'unverified', evidence } });
    },
    snapshot: () => persistence.snapshot(),
    save: options => persistence.save(options),
    exportWorld: (storage, writer, options) => persistence.exportWorld(storage, writer, options),
    prepareWorld: (storage, root, options) => persistence.prepareWorld(storage, root, options),
    importWorld: (storage, source, options) => persistence.importWorld(storage, source, options),
    restoreSnapshot: (snapshot, options) => persistence.restoreSnapshot(snapshot, options),
    setStyle: (input, options) => persistence.setStyle(input, options),
    importProject: input => persistence.importProject(input),
    frame(timestamp) { assertOpen(); jobController.cancelPending(); world.simulation.pump(timestamp); world.rendering?.render(timestamp); },
    step() { assertOpen(); jobController.cancelPending(); return world.simulation.step(); },
    close() { if (closed) return; assertIdle(); closed = true; codeExecutor?.close(); unsubscribe.forEach(fn => fn()); edit.dispose(); if (ownsWorld) world.dispose(); }
  };
  services.set(world, facade);
  world.skills?.register({name:'verifyScene',description:'Verify explicit postconditions against the live Runtime, including current relations and environment device states.',permissions:['world.read','physics.read'],required:['criteria'],properties:{criteria:{type:'array',minItems:1,maxItems:32}},
    handler:({criteria})=>{if(!Array.isArray(criteria)||!criteria.length||criteria.length>32)throw sceneError('INVALID_CRITERIA');return facade.verify(criteria).value;}});
  // Agent planning uses these same observations, jobs and verifier, with no shadow scene.
  world.skills?.register({name:'observeScene',description:'Observe all live objects, spatial relations and affordances from the shared Scene API. Use actor for reach checks; canApproach is a planning hint, not current availability.',permissions:['world.read','physics.read'],required:[],properties:{actor:{type:'string'}},
    handler:({actor},execution)=>facade.observe({actor:actor || execution.context.actor || undefined})});
  world.skills?.register({name:'interactScene',description:'Execute one discovered Scene interaction and await its verified Job result. For goal-driven tasks declare planSceneTask first and supply goalId. Environment actions automatically approach a reachable unoccluded pose.',permissions:['world.write','physics.read','spatial.read'],required:['interaction'],properties:{interaction:z.toJSONSchema(sceneInteractionSchema),goalId:{type:'string'}},mutates:true,manualMutation:true,batchable:false,
    handler:async({interaction},execution)=>{
      if(execution.context.signal?.aborted)throw sceneError('TASK_CANCELLED');
      const job=facade.interact(interaction),cancel=()=>facade.cancelJob(job.id);
      execution.context.signal?.addEventListener('abort',cancel,{once:true});
      if(execution.context.signal?.aborted)cancel();
      try{return (await facade.waitJob(job.id)).result;}finally{execution.context.signal?.removeEventListener('abort',cancel);}
    }});
  world.skills?.register({name:'planSceneTask',description:'Declare immutable verifiable task goals, not an action script. Each criterion is a live relation-exists or state-equals check; objectAnyOf allows equivalent observed supports. Optional dependencies order subgoals. Every action is replanned from fresh Scene observation.',permissions:['world.read'],required:['criteria'],properties:{criteria:{type:'array',minItems:1,maxItems:32,items:{type:'object'}},dependencies:{type:'object'}},
    handler:({criteria,dependencies={}})=>{
      if(!Array.isArray(criteria)||!criteria.length||criteria.length>32)throw sceneError('TASK_GOALS_INVALID');
      const graph=compileWorldAcceptance(criteria),ids=new Set(graph.checks.map(check=>check.id));
      for(const check of graph.checks) {
        if(!['relation-exists','state-equals'].includes(check.kind))throw sceneError('TASK_GOAL_KIND_UNSUPPORTED');
        for(const ref of [check.targetId,check.subject,check.object,...(check.objectAnyOf || [])].filter(Boolean))if(!world.store.has(ref)&&!world.affordances.get(ref)&&!world.projectCapabilities.has(ref))throw sceneError('TASK_GOAL_TARGET_UNKNOWN');
      }
      if(!dependencies || typeof dependencies!=='object' || Array.isArray(dependencies))throw sceneError('TASK_DEPENDENCIES_INVALID');
      const visiting=new Set(),done=new Set();
      const visit=key=>{if(visiting.has(key))throw sceneError('TASK_DEPENDENCY_CYCLE');if(done.has(key))return;visiting.add(key);
        const parents=dependencies[key] || [];if(!Array.isArray(parents)||parents.some(parent=>!ids.has(parent)))throw sceneError('TASK_DEPENDENCIES_INVALID');
        for(const parent of parents)visit(parent);visiting.delete(key);done.add(key);};
      for(const key of Object.keys(dependencies))if(!ids.has(key))throw sceneError('TASK_DEPENDENCIES_INVALID');
      for(const key of ids)visit(key);
      return {status:'scene-task-plan',criteria:graph.checks,dependencies:structuredClone(dependencies)};
    }});
  return facade;
}

/** @param {{project?: any, container?: HTMLElement|null, assetModule?: any, codeExecutor?: any, codeGLTFLoader?: any}} options */
export async function openScene({ project, container = null, assetModule = null, codeExecutor = null, codeGLTFLoader } = {}) {
  const definition = parseSceneProject(project);
  const assets = assetModule || createAssetModule({ volatile: true, manifests: Object.fromEntries(['agent', 'cup', 'table', 'chair'].map(key => [key, structuredClone(assetManifests[key])])), manifestStore: null, libraryStore: null });
  const environment = findEnvironment(definition.environment.id);
  if (!environment) throw sceneError('ENVIRONMENT_UNAVAILABLE');
  if (environment.cabin && typeof document === 'undefined') throw sceneError('ENVIRONMENT_REQUIRES_BROWSER');
  const factory = await environment.load();
  if (typeof factory !== 'function') throw sceneError('ENVIRONMENT_FACTORY_INVALID');
  const environmentFactory = (options) => factory({ loadAssets: false, ...options });
  const world = new WorldRuntime({ assetModule: assets, environmentFactory });
  assets.configureVerification({articulationVerifier:new ArticulationVerifier({assetRegistry:assets.registry,assetLoader:assets.loader})});
  if (container) world.attachRendering(new RenderingSystem({ container, scene: world.scene, events: world.events, rendererMode: 'webgl' }));
  world.skills = new SkillRegistry({ policy: world.policy, trace: world.trace, runtime: world });
  const add = (name, options, handler) => world.skills.register({ name, ...options, handler });
  registerSceneSkills(add, world); registerSpatialSkills(add, world); registerInteractionSkills(add, world);
  const scene = createSceneFacade(world, { ownsWorld: true, name: definition.name, codeExecutor, codeGLTFLoader });
  try {
    await world.init();
    for (let offset = 0; offset < definition.objects.length; offset += 32) {
      const initialized = await scene.apply({ operations: definition.objects.slice(offset, offset + 32).map(model => ({ type: 'add', model })) });
      if (initialized.status !== 'succeeded') throw sceneError(initialized.diagnostics[0].code);
    }
    if (definition.style) await scene.setStyle(definition.style);
    const camera = world.environment?.camera;
    world.rendering?.applyCameraState({
      position: camera?.position || [10, 10, 16],
      target: camera?.target || [0, 0.8, 3]
    });
    world.simulation.play();
    return scene;
  } catch (error) { if (world.sceneGraph) world.dispose(); else { world.rendering?.dispose(); world.physics.dispose(); } throw error; }
}
