import { createRequestWindow } from './RequestWindow.js';
import { assetAdmission } from '../../modules/asset/model/admission.js';
import { recipeSchema, glbInputSchema, threeCodeInputSchema, compiledCodeInputSchema } from '../../modules/asset/model/AssetInputContracts.js';
import { mechanicalDraftSchema } from '../../modules/asset/model/MechanicalAssetDraft.js';
import { prepareThreeCodeAsset, prepareEmbeddedCodeAsset } from '../programmatic-assets/ThreeCodeAsset.js';
import { sceneTransformSchema } from './SceneProject.js';
import { applySchema, modelSchema, operations, ref, sceneError, diagnostic } from './SceneContracts.js';

/** Scene edit operations and request deduplication. All mutations remain in WorldRuntime. */
export function createSceneEditService(world, { exclusive, assertOpen, assertIdle, getRevision, result, codeExecutor, codeGLTFLoader }) {
  const requestWindow = createRequestWindow({ conflictCode:'REQUEST_CONFLICT', limitCode:'REQUEST_LIMIT' });
  const resolveAssetId = (asset, requested) => {
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
  const assertEditable = key => {
    if (!world.store.has(key)) throw sceneError('OBJECT_NOT_FOUND');
    if (world.store.get(key).state?.heldBy || world.interactions?.isHeld?.(key) || world.interactions?.carry?.agentHeld?.has(key)) throw sceneError('OBJECT_HELD');
  };
  const executeEditOperation = async (op, batchSnapshots = null) => {
    if (op.type === 'replaceAsset') {
      assertEditable(op.id); const key = resolveAssetId(op.asset, op.level);
      return result(op.type, await world.commands.replaceAsset(op.id, key), { id: op.id, admission: assetAdmission(world.assetModule.getManifest(key)) });
    }
    const snapshotOptions = batchSnapshots?.options() || undefined;
    const value = await world.mutate(`scene:${op.type}`, async () => {
      if (op.type === 'add') {
        if (world.store.has(op.model.id) || world.projectCapabilities.has(op.model.id)) throw sceneError('DUPLICATE_ID');
        const key = resolveAssetId(op.model.asset, op.model.level);
        const transform = op.model.transform || sceneTransformSchema.parse({ position: op.model.position });
        const spawned = await world.commands.spawn(key, { id: op.model.id, ...transform });
        return { id: op.model.id, spawned, admission: assetAdmission(world.assetModule.getManifest(key)) };
      }
      assertEditable(op.id);
      return op.type === 'remove' ? world.commands.remove(op.id) : world.commands.transform(op.id, op.transform, { source: 'scene-api' });
    }, {}, snapshotOptions);
    return result(op.type, value, { id: op.model?.id || op.id, admission: value?.admission || null });
  };
  const editor = {
    async apply(input) {
      const args = applySchema.parse(input), signature = JSON.stringify(args); assertOpen();
      const replay = requestWindow.replay(args.requestId, signature);
      if (replay) return structuredClone(await replay);
      if (args.requestId) requestWindow.ensureCapacity();
      const promise = exclusive(async () => {
        if (args.expectedRevision != null && args.expectedRevision !== getRevision()) throw sceneError('REVISION_CONFLICT');
        for (const op of args.operations) if (op.type === 'add') resolveAssetId(op.model.asset, op.model.level); else if (op.type === 'replaceAsset') resolveAssetId(op.asset, op.level);
        // Keep the documented partial-result semantics while coalescing spatial
        // relation rebuilds. Explicit graph reads inside an operation still update.
        return world.sceneGraph.batch(async () => {
          // Preserve per-operation history and partial failures. Reuse the
          // preceding after-snapshot only while the simulation tick is unchanged.
          let cachedSnapshot = null, cachedTick = null;
          const batchSnapshots = {
            options: () => ({
              beforeSnapshot: cachedTick === world.simulation?.tick ? cachedSnapshot : null,
              onSnapshot: snapshot => {
                cachedSnapshot = snapshot;
                cachedTick = world.simulation?.tick;
              }
            }),
            invalidate: () => { cachedSnapshot = null; cachedTick = null; }
          };
          const applied = [];
          for (let i = 0; i < args.operations.length; i++) {
            try {
              const op = args.operations[i];
              // replaceAsset has a nested Runtime transaction and must not reuse
              // a snapshot captured before that transaction.
              if (op.type === 'replaceAsset') batchSnapshots.invalidate();
              applied.push(await executeEditOperation(op, batchSnapshots));
              if (op.type === 'replaceAsset') batchSnapshots.invalidate();
            }
            catch (error) { return result('apply', { applied, failed: { index: i, diagnostic: diagnostic(error) }, notRun: args.operations.slice(i + 1).map((_, n) => i + n + 1) }, { status: 'failed', diagnostics: [diagnostic(error)] }); }
          }
          return result('apply', { applied, failed: null, notRun: [] });
        });
      });
      if (args.requestId) requestWindow.track(args.requestId, signature, promise);
      return structuredClone(await promise);
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
              const added = await executeEditOperation({ type:'add', model:{...model,asset:prepared.asset} });
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
          return executeEditOperation({ type: 'add', model: { ...model, asset } });
        });
      }
      return applySingleOperation({ type: 'add', model: modelSchema.parse(input) });
    },
    async setTransform(input) { return applySingleOperation(operations.parse({ ...input, type: 'setTransform' })); },
    async remove(input) { return applySingleOperation(operations.parse({ ...input, type: 'remove' })); },
    async replaceAsset(input) { return applySingleOperation(operations.parse({ ...input, type: 'replaceAsset' })); },
  };
  async function applySingleOperation(op) { const batch = await editor.apply({ operations: [op] }); if (batch.status === 'failed') throw sceneError(batch.diagnostics[0].code); return batch.value.applied[0]; }
  return { ...editor, dispose() { requestWindow.clear(); } };
}
