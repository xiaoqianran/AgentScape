import * as z from 'zod/v4';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';
import { RenderingSystem } from '../../modules/world/runtime/systems/RenderingSystem.js';
import { findEnvironment } from '../../modules/world/content/environments.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { assetManifests } from '../../modules/asset/registry/manifests/index.js';
import { assetAdmission } from '../../modules/asset/model/admission.js';
import { recipeSchema, glbInputSchema, threeCodeInputSchema, compiledCodeInputSchema } from '../../modules/asset/model/AssetInputContracts.js';
import { prepareThreeCodeAsset, prepareEmbeddedCodeAsset } from '../programmatic-assets/ThreeCodeAsset.js';
import { mechanicalDraftSchema } from '../../modules/asset/model/MechanicalAssetDraft.js';
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
export const sceneAgentModelSchema = z.object({ id, asset: z.union([ref, recipeSchema, mechanicalDraftSchema]), level: z.enum(['visual', 'physical', 'interactive']).optional(), transform: sceneTransformSchema.optional(), position: sceneVector3Schema.optional() }).strict().refine(v => !v.transform || !v.position, 'Use transform or position');
const operations = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add'), model: modelSchema }).strict(),
  z.object({ type: z.literal('setTransform'), id, transform: sceneTransformSchema }).strict(),
  z.object({ type: z.literal('remove'), id }).strict(),
  z.object({ type: z.literal('replaceAsset'), id, asset: ref, level }).strict()
]);
const applySchema = z.object({ requestId: id.optional(), expectedRevision: z.number().int().nonnegative().optional(), operations: z.array(operations).min(1).max(32) }).strict();
const operationVector = sceneVector3Schema.refine(value => Math.hypot(...value) > 1e-6, 'Direction must be nonzero');
const affordanceTarget = z.string().regex(/^[A-Za-z][A-Za-z0-9_:-]{0,255}$/);
const physicalActions = new Set(['push', 'drag', 'rotate', 'slide', 'rotateJoint']);
export const sceneInteractionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), actor: id, position: sceneVector3Schema }).strict(),
  z.object({ action: z.literal('activate'), actor: id, target: affordanceTarget }).strict(),
  z.object({ action: z.literal('pickup'), actor: id, target: affordanceTarget }).strict(),
  z.object({ action: z.literal('place'), actor: id, target: affordanceTarget, surfaceId: id.optional() }).strict(),
  z.object({ action: z.enum(['open', 'close']), actor: id, target: affordanceTarget, partName: id.optional() }).strict(),
  z.object({ action: z.enum(['turn_on', 'turn_off', 'pull_out', 'return']), actor: id, target: affordanceTarget }).strict(),
  z.object({ action: z.literal('write'), actor: id, target: affordanceTarget, args: z.object({ text: z.string().max(100) }).strict() }).strict(),
  z.object({ action: z.enum(['push', 'drag']), actor: id, target: affordanceTarget, args: z.object({
    direction: operationVector.refine(value => Math.abs(value[1]) < 1e-6, 'Linear contact operations require a horizontal direction'),
    distance: z.number().positive().max(5), maxForce: z.number().positive().max(1000).default(100)
  }).strict() }).strict(),
  z.object({ action: z.literal('rotate'), actor: id, target: affordanceTarget, args: z.object({
    axis: operationVector, angle: z.number().finite().min(-Math.PI).max(Math.PI).refine(value => value !== 0),
    maxTorque: z.number().positive().max(1000).default(100)
  }).strict() }).strict(),
  z.object({ action: z.literal('slide'), actor: id, target: affordanceTarget, args: z.object({ part: id,
    target: z.number().finite().optional(), distance: z.number().finite().optional()
  }).strict().refine(value => (value.target != null) !== (value.distance != null), 'Use target or distance') }).strict(),
  z.object({ action: z.literal('rotateJoint'), actor: id, target: affordanceTarget, args: z.object({ part: id,
    target: z.number().finite().optional(), angle: z.number().finite().min(-Math.PI).max(Math.PI).optional()
  }).strict().refine(value => (value.target != null) !== (value.angle != null), 'Use target or angle') }).strict()
]);
const diagnostic = error => ({ code: error.code || 'INVALID_OPERATION', message: error.code || 'Operation failed', stage: 'scene', retryable: false });

/** One application service per existing Runtime. No entity or asset cache. */
export function createSceneFacade(world, { ownsWorld = false, name = 'Untitled World', codeExecutor = null, codeGLTFLoader = undefined } = {}) {
  if (services.has(world)) return services.get(world);
  let busy = false, closed = false, revision = 0, selectedActor = null;
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
      world.interactions.cancelPending('SCENE_CANCELLED'); world.locomotion.cancelAll('SCENE_CANCELLED');world.affordances.cancel('SCENE_CANCELLED');
    }
  };
  const handle = {
    actors() {
      assertOpen();
      const agents=world.store.list().filter(([,record])=>record.manifest?.type==='agent').map(([id])=>({id,position:world.physics.getPosition(id)}));
      return {agents,selected:agents.some(agent=>agent.id===selectedActor)?selectedActor:agents.length===1?agents[0].id:null};
    },
    selectActor(actor) {
      assertIdle();id.parse(actor);
      if(!handle.actors().agents.some(agent=>agent.id===actor))throw sceneError('ACTOR_NOT_AGENT');
      selectedActor=actor;world.events.emit('scene.actor.selected',{actor});return handle.actors();
    },
    inspect(target, options = {}) {
      assertOpen(); z.string().min(1).max(256).parse(target);
      const { actor } = z.object({ actor: id.optional() }).strict().parse(options);
      const inspection = world.affordances.inspect(target, { actorId: actor });
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
        style: styles.export(), actors:handle.actors(), affordances: world.affordances.list({ actorId: actor, limit: 100 }),
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
    async addModel(input, { signal } = {}) {
      assertIdle();
      if (typeof input?.asset !== 'string') {
        const source = input?.asset;
        if (['three-code','compiled-code'].includes(source?.kind)) {
          const code = source.kind==='three-code' ? threeCodeInputSchema.parse(source) : compiledCodeInputSchema.parse(source);
          const model = modelSchema.parse({ ...input, asset:'builtin://pending', level:input.level ?? (code.definition?.capabilityLevel || (code.definition ? 'physical' : 'visual')) });
          if (world.store.has(model.id)) throw sceneError('DUPLICATE_ID');
          return exclusive(async () => {
            const prepared = code.kind==='three-code'
              ? await prepareThreeCodeAsset(world.assetModule, codeExecutor, code, { signal, gltfLoader:codeGLTFLoader })
              : await prepareEmbeddedCodeAsset(world.assetModule, code, {gltfLoader:codeGLTFLoader});
            return prepared.install(async () => {
              if (signal?.aborted) throw sceneError('BUILD_CANCELLED');
              const added = await executeEdit({ type:'add', model:{...model,asset:prepared.asset} });
              return {...added, execution:{status:code.kind==='three-code'?'succeeded':'not-requested'}, buildValidation:prepared.validation};
            });
          });
        }
        const glb = source?.kind === 'glb' ? glbInputSchema.parse(source) : null;
        const machine = source?.schema === 'agentscape.mechanical-draft' ? mechanicalDraftSchema.parse(source) : null;
        const recipe = glb || machine ? null : recipeSchema.parse(source);
        const requested = input.level ?? (machine ? machine.motions.length ? 'interactive' : 'physical' : glb ? glb.review ? 'physical' : 'visual' : recipe.capabilities.level);
        const model = modelSchema.parse({ ...input, asset: 'builtin://pending', level: requested });
        if (world.store.has(model.id)) throw sceneError('DUPLICATE_ID');
        const sourceEnvironment = world.environment;
        return exclusive(async () => {
          const resolved = machine ? await world.assetModule.importMechanicalDraft(machine)
            : glb ? await world.assetModule.importGLB({ ...glb, level: requested }) : await world.assetModule.importRecipe(recipe);
          if(world.environment!==sourceEnvironment)throw sceneError('SCENE_WORLD_CHANGED');
          const asset = machine ? 'asset://sha256/' + resolved.manifest.id.slice('asset_'.length) : resolved.asset;
          return executeEdit({ type: 'add', model: { ...model, asset } });
        });
      }
      return single({ type: 'add', model: modelSchema.parse(input) });
    },
    async setTransform(input) { return single(operations.parse({ ...input, type: 'setTransform' })); },
    async remove(input) { return single(operations.parse({ ...input, type: 'remove' })); },
    async replaceAsset(input) { return single(operations.parse({ ...input, type: 'replaceAsset' })); },
    interact(input) {
      const args = sceneInteractionSchema.parse(input); assertIdle();
      const nativeAction = args.action === 'activate';
      if (nativeAction && !handle.actors().agents.some(agent=>agent.id===args.actor)) throw sceneError('ACTOR_NOT_AGENT');
      if (nativeAction && !world.environment?.interactions?.some(item=>item.id===args.target && typeof item.activate==='function')) {
        throw sceneError('INTERACTION_UNAVAILABLE');
      }
      const contract = 'target' in args ? world.affordances?.get?.(args.target) : null;
      const worldAction = Boolean(contract) && !nativeAction;
      if (worldAction && !contract.actions.includes(args.action)) throw sceneError('ACTION_UNSUPPORTED');
      if (!contract && ['turn_on', 'turn_off', 'pull_out', 'return', 'write'].includes(args.action)) throw sceneError('ACTION_UNSUPPORTED');
      if (jobs.size >= 128) { const terminal = [...jobs].find(([, job]) => job.status !== 'running'); if (terminal) jobs.delete(terminal[0]); else throw sceneError('JOB_LIMIT'); }
      const job = { id: `job_${crypto.randomUUID()}`, status: 'running', result: null };
      jobs.set(job.id, job); busy = true;
      const [skill, params] = args.action === 'navigate' ? ['navigateTo', { id: args.actor, end: args.position }]
        : args.action === 'pickup' ? ['approachAndPickup', { actorId: args.actor, targetId: args.target }]
        : args.action === 'place' ? ['approachAndPlace', { actorId: args.actor, supportId: args.target, surfaceId: args.surfaceId }]
        : ['approachAndInteract', { actorId: args.actor, targetId: args.target, action: args.action, partName: args.partName }];
      const physical = physicalActions.has(args.action);
      const operation = nativeAction ? world.mutate('scene:native-activate', () => world.commands.activateEnvironmentInteraction(args.target,{
        actorId:args.actor,requireReach:true
      })) : worldAction ? world.mutate(`scene:world-action:${args.action}`, () => world.commands.executeAffordance({
        targetId: args.target, actorId: args.actor, action: args.action, args: args.args || {}
      },{approach:true})) : physical ? world.mutate(`scene:${args.action}`, async () => {
        const value = await world.interactions.manipulate(args.actor, args.target, args.action, args.args);
        recordInteractionEvidence(world, { targetId:args.target, capability:args.action.toUpperCase(), verified:value.verified,
          source:'scene-api', commandId:job.id, result:value });
        return value;
      }) : tools.call(skill, params);
      job.promise = operation.then(value => {
        const activated = nativeAction && value.status === 'environment-interaction-activated';
        const outcome = nativeAction
          ? {state:value.verified === true ? 'verified' : activated ? 'unverified' : 'failed',verified:value.verified === true,physicsVerified:false}
          : worldAction
          ? { state:value.status === 'world-action-completed' && value.verified === true ? 'verified' : 'failed', verified:value.status === 'world-action-completed' && value.verified === true, physicsVerified:false }
          : physical ? { state:value.verified ? 'verified' : 'failed', verified:value.verified === true } : tools.executionPolicy(skill, value).outcome;
        job.status = job.cancelled ? 'cancelled' : (outcome.verified || activated) ? 'succeeded' : 'failed';
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
    /** Bounded streaming world archive; storage is an injected hash-block backend. */
    async exportWorld(storage, writer, options = {}) {
      return exclusive(async () => {
        const { exportWorld } = await import('./WorldIO.js');
        return result('exportWorld', await exportWorld(world, storage, writer, { name, ...options }));
      });
    },
    async prepareWorld(storage, root, options = {}) {
      assertIdle();
      const { prepareWorld } = await import('./WorldIO.js');
      const prepared = await prepareWorld(storage, root, { active:'bounded', ...options });
      // Never expose the private Runtime simply to commit a validated world.
      return { summary:prepared.summary, commit:()=>exclusive(()=>prepared.commit(world)), dispose:()=>prepared.dispose() };
    },
    async importWorld(storage, source, options = {}) {
      return exclusive(async () => {
        const { importWorld } = await import('./WorldIO.js');
        return result('importWorld', await importWorld(world, storage, source, { active:'bounded', ...options }));
      });
    },    async restoreSnapshot(snapshot, { prepared = false } = {}) {
      return exclusive(async () => {
        const copy = structuredClone(snapshot); world.serializer.validate(copy);
        if (copy.assets.length || (!prepared && (copy.configuration?.behaviorBundle || copy.configuration?.physicsRequirements || copy.metadata?.environmentState || copy.metadata?.worldRevision))) throw sceneError('UNSUPPORTED_SAVE');
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
    close() { if (closed) return; assertIdle(); closed = true; codeExecutor?.close(); unsubscribe.forEach(fn => fn()); if (ownsWorld) world.dispose(); }
  };
  async function single(op) { const batch = await handle.apply({ operations: [op] }); if (batch.status === 'failed') throw sceneError(batch.diagnostics[0].code); return batch.value.applied[0]; }
  function getJob(key) { const job = jobs.get(key); if (!job) throw sceneError('JOB_NOT_FOUND'); return job; }
  services.set(world, handle);
  world.skills?.register({name:'verifyScene',description:'Verify explicit postconditions against the live Runtime, including current relations and environment device states.',permissions:['world.read','physics.read'],required:['criteria'],properties:{criteria:{type:'array',minItems:1,maxItems:32}},
    handler:({criteria})=>{if(!Array.isArray(criteria)||!criteria.length||criteria.length>32)throw sceneError('INVALID_CRITERIA');return handle.verify(criteria).value;}});
  // Agent planning uses these same observations, jobs and verifier, with no shadow scene.
  world.skills?.register({name:'observeScene',description:'Observe all live objects, spatial relations and affordances from the shared Scene API. Use actor for reach checks; canApproach is a planning hint, not current availability.',permissions:['world.read','physics.read'],required:[],properties:{actor:{type:'string'}},
    handler:({actor},execution)=>handle.observe({actor:actor || execution.context.actor || undefined})});
  world.skills?.register({name:'interactScene',description:'Execute one discovered Scene interaction and await its verified Job result. For goal-driven tasks declare planSceneTask first and supply goalId. Environment actions automatically approach a reachable unoccluded pose.',permissions:['world.write','physics.read','spatial.read'],required:['interaction'],properties:{interaction:z.toJSONSchema(sceneInteractionSchema),goalId:{type:'string'}},mutates:true,manualMutation:true,batchable:false,
    handler:async({interaction},execution)=>{
      if(execution.context.signal?.aborted)throw sceneError('TASK_CANCELLED');
      const job=handle.interact(interaction),cancel=()=>handle.cancelJob(job.id);
      execution.context.signal?.addEventListener('abort',cancel,{once:true});
      if(execution.context.signal?.aborted)cancel();
      try{return (await handle.waitJob(job.id)).result;}finally{execution.context.signal?.removeEventListener('abort',cancel);}
    }});
  world.skills?.register({name:'planSceneTask',description:'Declare immutable verifiable task goals, not an action script. Each criterion is a live relation-exists or state-equals check; objectAnyOf allows equivalent observed supports. Optional dependencies order subgoals. Every action is replanned from fresh Scene observation.',permissions:['world.read'],required:['criteria'],properties:{criteria:{type:'array',minItems:1,maxItems:32,items:{type:'object'}},dependencies:{type:'object'}},
    handler:({criteria,dependencies={}})=>{
      if(!Array.isArray(criteria)||!criteria.length||criteria.length>32)throw sceneError('TASK_GOALS_INVALID');
      const graph=compileWorldAcceptance(criteria),ids=new Set(graph.checks.map(check=>check.id));
      for(const check of graph.checks) {
        if(!['relation-exists','state-equals'].includes(check.kind))throw sceneError('TASK_GOAL_KIND_UNSUPPORTED');
        for(const ref of [check.targetId,check.subject,check.object,...(check.objectAnyOf || [])].filter(Boolean))if(!world.store.has(ref)&&!world.affordances.get(ref))throw sceneError('TASK_GOAL_TARGET_UNKNOWN');
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
  return handle;
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
