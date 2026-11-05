import * as z from 'zod/v4';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { assetAdmission } from '../../modules/asset/model/admission.js';
import { recipeSchema, glbInputSchema } from '../../modules/asset/model/AssetInputContracts.js';
import { ArticulationVerifier } from '../../modules/world/verification/ArticulationVerifier.js';
import { StyleSystem } from '../../modules/rendering/style/StyleSystem.js';
import { compileWorldAcceptance, evaluateWorldAcceptance } from '../../modules/world/verification/WorldAcceptance.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { registerSceneSkills } from '../skills/packs/sceneSkills.js';
import { registerSpatialSkills } from '../skills/packs/spatialSkills.js';
import { registerInteractionSkills } from '../skills/packs/interactionSkills.js';
import { AgentTools } from '../AgentTools.js';
import { recordInteractionEvidence } from '../../modules/world/verification/InteractionEvidence.js';
import { parseSceneProject, sceneObjectIdSchema as id, sceneTransformSchema, sceneVector3Schema } from './SceneProject.js';

export const sceneError = (code, message = code) => Object.assign(new Error(message), { code });
const services = new WeakMap();
export const SCENE_LEGACY_SKILLS = Object.freeze(['spawnAsset', 'moveObject', 'rotateObject', 'scaleObject', 'transformObject', 'removeObject', 'duplicateObject', 'replaceAsset', 'navigateTo', 'approachAndInteract', 'approachAndPickup', 'approachAndPlace', 'evaluateWorldAcceptance', 'pickup', 'drop', 'place', 'open', 'close', 'dropHeld']);
const ref = z.string().regex(/^(builtin:\/\/[a-zA-Z][a-zA-Z0-9_-]{0,63}|asset:\/\/sha256\/[a-f0-9]{64})$/);
const level = z.enum(['visual', 'physical', 'interactive']).default('physical');
const modelSchema = z.object({ id, asset: ref, level, transform: sceneTransformSchema.optional(), position: sceneVector3Schema.optional() }).strict().refine(v => !v.transform || !v.position, 'Use transform or position');
export const sceneAgentModelSchema = z.object({ id, asset: z.union([ref, recipeSchema]), level: z.enum(['visual', 'physical', 'interactive']).optional(), transform: sceneTransformSchema.optional(), position: sceneVector3Schema.optional() }).strict().refine(v => !v.transform || !v.position, 'Use transform or position');
const operations = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add'), model: modelSchema }).strict(),
  z.object({ type: z.literal('setTransform'), id, transform: sceneTransformSchema }).strict(),
  z.object({ type: z.literal('remove'), id }).strict(),
  z.object({ type: z.literal('replaceAsset'), id, asset: ref, level }).strict()
]);
const applySchema = z.object({ requestId: id.optional(), expectedRevision: z.number().int().nonnegative().optional(), operations: z.array(operations).min(1).max(32) }).strict();
const operationVector = sceneVector3Schema.refine(value => Math.hypot(...value) > 1e-6, 'Direction must be nonzero');
const physicalActions = new Set(['push', 'drag', 'rotate', 'slide', 'rotateJoint']);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), actor: id, position: sceneVector3Schema }).strict(),
  z.object({ action: z.literal('pickup'), actor: id, target: id }).strict(),
  z.object({ action: z.literal('place'), actor: id, target: id, surfaceId: id.optional() }).strict(),
  z.object({ action: z.enum(['open', 'close']), actor: id, target: id, partName: id.optional() }).strict(),
  z.object({ action: z.enum(['push', 'drag']), actor: id, target: id, args: z.object({
    direction: operationVector.refine(value => Math.abs(value[1]) < 1e-6, 'Linear contact operations require a horizontal direction'),
    distance: z.number().positive().max(5), maxForce: z.number().positive().max(1000).default(100)
  }).strict() }).strict(),
  z.object({ action: z.literal('rotate'), actor: id, target: id, args: z.object({
    axis: operationVector, angle: z.number().finite().min(-Math.PI).max(Math.PI).refine(value => value !== 0),
    maxTorque: z.number().positive().max(1000).default(100)
  }).strict() }).strict(),
  z.object({ action: z.literal('slide'), actor: id, target: id, args: z.object({ part: id,
    target: z.number().finite().optional(), distance: z.number().finite().optional()
  }).strict().refine(value => (value.target != null) !== (value.distance != null), 'Use target or distance') }).strict(),
  z.object({ action: z.literal('rotateJoint'), actor: id, target: id, args: z.object({ part: id,
    target: z.number().finite().optional(), angle: z.number().finite().min(-Math.PI).max(Math.PI).optional()
  }).strict().refine(value => (value.target != null) !== (value.angle != null), 'Use target or angle') }).strict()
]);
const diagnostic = error => ({ code: error.code || 'INVALID_OPERATION', message: error.code || 'Operation failed', stage: 'scene', retryable: false });

/** One application service per existing Runtime. No entity or asset cache. */
export function createSceneFacade(world, { ownsWorld = false, name = 'Untitled World', maxObjects = 32 } = {}) {
  if (services.has(world)) return services.get(world);
  let busy = false, closed = false, revision = 0;
  const jobs = new Map(), requests = new Map();
  const tools = new AgentTools(world, { profile: 'builder', source: 'scene-api' });
  const styles = new StyleSystem({ scene: world.scene, events: world.events, getRenderer: () => world.rendering?.renderer, getCamera: () => world.rendering?.camera });
  world.rendering?.attachStyleSystem?.(styles);
  const unsubscribe = ['history.recorded', 'history.applied', 'scene.restored'].map(event => world.events.on(event, () => { revision++; }));
  const assertOpen = () => { if (closed) throw sceneError('SCENE_CLOSED'); };
  const assertIdle = () => { assertOpen(); if (busy || world.mutationOwner) throw sceneError('SCENE_BUSY'); };
  const exclusive = async operation => { assertIdle(); busy = true; try { return await operation(); } finally { busy = false; } };
  const result = (operation, value, extra = {}) => ({ schema: 'agentscape.scene-result', schemaVersion: 1, operation, status: 'succeeded', revision,
    admission: null, verification: { status: 'not-requested', evidence: null }, diagnostics: [], value, ...extra });
  const assetId = (asset, requested) => {
    ref.parse(asset);
    let key = asset.startsWith('builtin://') ? asset.slice(10) : `asset_${asset.slice('asset://sha256/'.length)}`;
    if (!world.assetModule.hasAsset(key) && asset.startsWith('asset://sha256/')) {
      const published = `pa_${asset.slice('asset://sha256/'.length)}`;
      if (world.assetModule.hasAsset(published)) key = published;
    }
    if (!world.assetModule.hasAsset(key)) throw sceneError('ASSET_UNAVAILABLE');
    const manifest = world.assetModule.getManifest(key);
    const physicalParts=Object.values(manifest.parts || {}).some(part=>part.physics?.colliders?.length && part.joint);
    if (requested !== 'visual' && !manifest.physics?.colliders?.length && !physicalParts) throw sceneError('CAPABILITY_UNAVAILABLE');
    if (requested === 'interactive' && !manifest.actions?.length && !physicalParts && manifest.physics?.body!=='dynamic') throw sceneError('CAPABILITY_UNAVAILABLE');
    if (assetAdmission(manifest).status === 'rejected') throw sceneError('ASSET_REJECTED');
    return key;
  };
  const editable = key => {
    if (!world.store.has(key)) throw sceneError('OBJECT_NOT_FOUND');
    if (world.store.get(key).state?.heldBy || world.interactions?.isHeld?.(key) || world.interactions?.carry?.agentHeld?.has(key)) throw sceneError('OBJECT_HELD');
  };
  const executeEdit = async op => {
    if (op.type === 'replaceAsset') {
      editable(op.id); const key = assetId(op.asset, op.level);
      return result(op.type, await world.commands.replaceAsset(op.id, key), { id: op.id, admission: assetAdmission(world.assetModule.getManifest(key)) });
    }
    const value = await world.mutate(`scene:${op.type}`, async () => {
      if (op.type === 'add') {
        if (world.store.list().length >= maxObjects) throw sceneError('OBJECT_LIMIT');
        if (world.store.has(op.model.id)) throw sceneError('DUPLICATE_ID');
        const key = assetId(op.model.asset, op.model.level);
        const transform = op.model.transform || sceneTransformSchema.parse({ position: op.model.position });
        const spawned = await world.commands.spawn(key, { id: op.model.id, ...transform });
        return { id: op.model.id, spawned, admission: assetAdmission(world.assetModule.getManifest(key)) };
      }
      editable(op.id);
      return op.type === 'remove' ? world.commands.remove(op.id) : world.commands.transform(op.id, op.transform, { source: 'scene-api' });
    });
    return result(op.type, value, { id: op.model?.id || op.id, admission: value?.admission || null });
  };
  const cancelPending = () => {
    if ([...jobs.values()].some(job => job.status === 'running' && job.cancelled)) {
      world.interactions.cancelPending('SCENE_CANCELLED'); world.locomotion.cancelAll('SCENE_CANCELLED');
    }
  };
  const handle = {
    inspect(target, options = {}) {
      assertOpen(); z.string().min(1).max(256).parse(target);
      const { actor } = z.object({ actor: id.optional() }).strict().parse(options);
      const inspection = world.affordances.inspect(target, { actorId: actor });
      if (!inspection) throw sceneError('OBJECT_NOT_FOUND');
      return inspection;
    },
    observe(options = {}) {
      const { actor } = z.object({ actor: id.optional() }).strict().parse(options);
      assertOpen(); world.sceneGraph.update();
      return { schema: 'agentscape.scene-observation', schemaVersion: 1, revision,
        style: styles.export(), affordances: world.affordances.list({ actorId: actor, limit: 100 }),
        objects: world.store.list().map(([key, record]) => ({ ...world.observation.object(key), state: structuredClone(record.state),
          transform: { position: record.object.position.toArray(), quaternion: record.object.quaternion.toArray(), scale: record.object.scale.x },
          physicsRegistered: Boolean(world.physics.getPosition(key)) })), relations: structuredClone(world.sceneGraph.list()) };
    },
    async apply(input) {
      const args = applySchema.parse(input), signature = JSON.stringify(args); assertOpen();
      if (args.requestId && requests.has(args.requestId)) {
        const previous = requests.get(args.requestId);
        if (previous.signature !== signature) throw sceneError('REQUEST_CONFLICT');
        return structuredClone(await previous.promise);
      }
      if (args.requestId && requests.size >= 256) throw sceneError('REQUEST_LIMIT');
      const promise = exclusive(async () => {
        if (args.expectedRevision != null && args.expectedRevision !== revision) throw sceneError('REVISION_CONFLICT');
        for (const op of args.operations) if (op.type === 'add') assetId(op.model.asset, op.model.level); else if (op.type === 'replaceAsset') assetId(op.asset, op.level);
        const applied = [];
        for (let i = 0; i < args.operations.length; i++) {
          try { applied.push(await executeEdit(args.operations[i])); }
          catch (error) { return result('apply', { applied, failed: { index: i, diagnostic: diagnostic(error) }, notRun: args.operations.slice(i + 1).map((_, n) => i + n + 1) }, { status: 'failed', diagnostics: [diagnostic(error)] }); }
        }
        return result('apply', { applied, failed: null, notRun: [] });
      });
      if (args.requestId) requests.set(args.requestId, { signature, promise });
      return structuredClone(await promise);
    },
    // Compatibility entry for audited legacy adapters; public SDK types expose
    // intent-level methods. The same service lock and Runtime own execution.
    executeSkill(name, args) {
      if (!SCENE_LEGACY_SKILLS.includes(name)) throw sceneError('SKILL_FORBIDDEN');
      return exclusive(() => tools.call(name, args));
    },
    async prepareAsset(input) {
      const source=glbInputSchema.omit({review:true}).parse(input);
      return exclusive(()=>world.assetModule.prepareInteraction(source));
    },
    async addModel(input) {
      assertIdle();
      if (typeof input?.asset !== 'string') {
        const source = input?.asset;
        const glb = source?.kind === 'glb' ? glbInputSchema.parse(source) : null;
        const recipe = glb ? null : recipeSchema.parse(source);
        const requested = input.level ?? (glb ? glb.review ? 'physical' : 'visual' : recipe.capabilities.level);
        const model = modelSchema.parse({ ...input, asset: 'builtin://pending', level: requested });
        return exclusive(async () => {
          const resolved = glb ? await world.assetModule.importGLB({ ...glb, level: requested }) : await world.assetModule.importRecipe(recipe);
          return executeEdit({ type: 'add', model: { ...model, asset: resolved.asset } });
        });
      }
      return single({ type: 'add', model: modelSchema.parse(input) });
    },
    async setTransform(input) { return single(operations.parse({ ...input, type: 'setTransform' })); },
    async remove(input) { return single(operations.parse({ ...input, type: 'remove' })); },
    async replaceAsset(input) { return single(operations.parse({ ...input, type: 'replaceAsset' })); },
    interact(input) {
      const args = actionSchema.parse(input); assertIdle();
      if (jobs.size >= 128) { const terminal = [...jobs].find(([, job]) => job.status !== 'running'); if (terminal) jobs.delete(terminal[0]); else throw sceneError('JOB_LIMIT'); }
      const job = { id: `job_${crypto.randomUUID()}`, status: 'running', result: null };
      jobs.set(job.id, job); busy = true;
      const [skill, params] = args.action === 'navigate' ? ['navigateTo', { id: args.actor, end: args.position }]
        : args.action === 'pickup' ? ['approachAndPickup', { actorId: args.actor, targetId: args.target }]
        : args.action === 'place' ? ['approachAndPlace', { actorId: args.actor, supportId: args.target, surfaceId: args.surfaceId }]
        : ['approachAndInteract', { actorId: args.actor, targetId: args.target, action: args.action, partName: args.partName }];
      const physical = physicalActions.has(args.action);
      const operation = physical ? world.mutate(`scene:${args.action}`, async () => {
        const value = await world.interactions.manipulate(args.actor, args.target, args.action, args.args);
        recordInteractionEvidence(world, { targetId:args.target, capability:args.action.toUpperCase(), verified:value.verified,
          source:'scene-api', commandId:job.id, result:value });
        return value;
      }) : tools.call(skill, params);
      job.promise = operation.then(value => {
        const outcome = physical ? { state:value.verified ? 'verified' : 'failed', verified:value.verified === true } : tools.executionPolicy(skill, value).outcome;
        job.status = job.cancelled ? 'cancelled' : outcome.verified ? 'succeeded' : 'failed';
        job.result = result('interact', value, { status: job.status, verification: { status: !job.cancelled && outcome.verified ? 'verified' : 'unverified', evidence: value }, outcome });
      }).catch(error => { job.status = job.cancelled ? 'cancelled' : 'failed'; job.result = result('interact', null, { status: job.status, diagnostics: [diagnostic(error)] }); })
        .finally(() => { clearTimeout(job.timer); busy = false; });
      job.timer = setTimeout(() => handle.cancelJob(job.id), 60_000); job.timer.unref?.();
      return { id: job.id, status: job.status };
    },
    getJob(key) { assertOpen(); const job = getJob(key); return structuredClone({ id: job.id, status: job.status, result: job.result }); },
    async waitJob(key) { assertOpen(); const job = getJob(key); await job.promise; return handle.getJob(key); },
    cancelJob(key) { assertOpen(); const job = getJob(key); if (job.status === 'running') { job.cancelled = true; cancelPending(); } return { id: job.id, status: job.status, cancellationRequested: Boolean(job.cancelled) }; },
    verify(criteria = [{ id: 'valid', kind: 'world-valid' }]) {
      assertIdle(); const evidence = evaluateWorldAcceptance(world, compileWorldAcceptance(criteria));
      return result('verify', evidence, { verification: { status: evidence.status === 'world-accepted' ? 'verified' : 'unverified', evidence } });
    },
    snapshot() { assertIdle(); return world.serialize({ name }); },
    async save(options = {}) {
      return exclusive(async () => {
        const { exportScenePackage } = await import('./ScenePackage.js');
        return result('save', await exportScenePackage(world, { ...options, name, style: styles.export() }));
      });
    },
    async restoreSnapshot(snapshot, { prepared = false } = {}) {
      return exclusive(async () => {
        const copy = structuredClone(snapshot); world.serializer.validate(copy);
        if (copy.assets.length || (!prepared && (copy.configuration?.behaviorBundle || copy.configuration?.physicsRequirements || copy.metadata?.environmentState || copy.metadata?.worldRevision))) throw sceneError('UNSUPPORTED_SAVE');
        if (copy.objects.length > maxObjects) throw sceneError('OBJECT_LIMIT');
        for (const object of copy.objects) { id.parse(object.id); if (!world.assetModule.hasAsset(object.assetId)) throw sceneError('ASSET_UNAVAILABLE'); }
        await world.restore(copy); return result('restore', { objects: copy.objects.length });
      });
    },
    async setStyle(input, options = {}) { return exclusive(async () => result('setStyle', await styles.set(input, options))); },
    async importProject(input) {
      return exclusive(async () => {
        const { importScenePackageInto } = await import('./ScenePackage.js');
        return result('importProject', await importScenePackageInto(world, input, { getStyle: () => styles.export(), applyStyle: pack => pack ? styles.set(pack) : styles.clear() }));
      });
    },
    frame(timestamp) { assertOpen(); cancelPending(); world.simulation.pump(timestamp); world.rendering?.render(timestamp); },
    step() { assertOpen(); cancelPending(); return world.simulation.step(); },
    close() { if (closed) return; assertIdle(); closed = true; unsubscribe.forEach(fn => fn()); if (ownsWorld) world.dispose(); }
  };
  async function single(op) { const batch = await handle.apply({ operations: [op] }); if (batch.status === 'failed') throw sceneError(batch.diagnostics[0].code); return batch.value.applied[0]; }
  function getJob(key) { const job = jobs.get(key); if (!job) throw sceneError('JOB_NOT_FOUND'); return job; }
  services.set(world, handle);
  return handle;
}

/** @param {{project?: any, container?: HTMLElement|null, assetModule?: any}} options */
export async function openScene({ project, container = null, assetModule = null } = {}) {
  const definition = parseSceneProject(project);
  const assets = assetModule || createAssetModule({ volatile: true, manifests: Object.fromEntries(['agent', 'cup', 'table', 'chair'].map(key => [key, structuredClone(assetManifests[key])])), manifestStore: null, libraryStore: null });
  const world = new WorldRuntime({ assetModule: assets, environmentFactory: () => createMonumentHall({ loadAssets: false }) });
  assets.configureVerification({articulationVerifier:new ArticulationVerifier({assetRegistry:assets.registry,assetLoader:assets.loader})});
  if (container) world.attachRendering(new RenderingSystem({ container, scene: world.scene, events: world.events, rendererMode: 'webgl' }));
  world.skills = new SkillRegistry({ policy: world.policy, trace: world.trace, runtime: world });
  const add = (name, options, handler) => world.skills.register({ name, ...options, handler });
  registerSceneSkills(add, world); registerSpatialSkills(add, world); registerInteractionSkills(add, world);
  const scene = createSceneFacade(world, { ownsWorld: true, name: definition.name });
  try {
    await world.init();
    if (definition.objects.length) { const initialized = await scene.apply({ operations: definition.objects.map(model => ({ type: 'add', model })) }); if (initialized.status !== 'succeeded') throw sceneError(initialized.diagnostics[0].code); }
    if (definition.style) await scene.setStyle(definition.style);
    world.rendering?.applyCameraState({ position: [10, 10, 16], target: [0, 0.8, 3] }); world.simulation.play();
    return scene;
  } catch (error) { if (world.sceneGraph) world.dispose(); else { world.rendering?.dispose(); world.physics.dispose(); } throw error; }
}
