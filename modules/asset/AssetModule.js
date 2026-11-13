import { AssetCatalog } from './registry/AssetCatalog.js';
import { AssetRegistry } from './registry/AssetRegistry.js';
import { AssetLoader } from './loading/AssetLoader.js';
import { AssetProductionError, createAssetProducer } from './production/AssetProductionPipeline.js';
import { HttpCompilerProvider } from './production/compiler/providers/HttpCompilerProvider.js';
import { CompiledAssetStore } from './persistence/CompiledAssetStore.js';
import { AssetManifestStore } from './persistence/AssetManifestStore.js';
import { LocalAssetLibrary } from './persistence/LocalAssetLibrary.js';
import { LocalAssetLibraryStore } from './persistence/LocalAssetLibraryStore.js';
import { assetAdmission } from './model/admission.js';
import { mechanicalDraftSchema, mechanicalDraftToAssetRecipe, mechanicalDraftToManifest } from './model/MechanicalAssetDraft.js';
import { recipeSchema, canonicalAssetJson, assetDigest, assertEmbeddedGLB, interactionReviewSchema } from './model/AssetInputContracts.js';

export async function verifyAndUpdateAssetArticulation(assets,assetId,options) {
 const report=await assets.verifyArticulation(assetId,options);
 const manifest=assets.getManifest(assetId);
 manifest.verification={...(manifest.verification||{}),articulation:report};
 const quality=manifest.compiler?.quality;
 if(quality){
  quality.advisory=(quality.advisory||[]).filter(item=>!['ARTICULATION_UNVERIFIED','ARTICULATION_VERIFICATION_FAILED'].includes(item.code));
  if(!report.ok)quality.advisory.push({code:'ARTICULATION_VERIFICATION_FAILED',message:'运行时运动验证失败'});
  quality.status=quality.hard?.length?'rejected':quality.advisory.length?'provisional':'ready';
 }
 await assets.registerManifest(manifest,{replace:true});
 const admission=assetAdmission(manifest);
 return {...report,readiness:admission.status,admission};
}

export function createAssetModule({
  manifests,
  volatile = false,
  compiledStore = null,
  manifestStore = undefined,
  libraryStore = undefined,
  gltfLoader = undefined,
  now = () => Date.now()
} = {}) {
  const store = compiledStore || new CompiledAssetStore({ indexedDBImpl: volatile ? null : globalThis.indexedDB });
  const durableManifests = manifestStore === undefined
    ? (globalThis.indexedDB ? new AssetManifestStore() : null)
    : manifestStore;

  const registry = new AssetRegistry({ manifests });
  const loader = new AssetLoader({ registry, compiledStore:store, ...(gltfLoader ? {gltfLoader} : {}) });
  const catalog = new AssetCatalog({ registry });

  const durableLibrary = libraryStore === undefined
    ? new LocalAssetLibraryStore()
    : (libraryStore || new LocalAssetLibraryStore({ indexedDBImpl:null }));
  const library = new LocalAssetLibrary({
    assetRegistry:registry,
    compiledStore:store,
    store:durableLibrary,
    now:()=>new Date(now()).toISOString()
  });

  let producer = null;
  let hydrated = false;
  let configuredCompilerProvider = null;
  let configuredCompiler = null;
  let configuredCompilerGetter = null;
  let articulationVerifier = null;

  const persistManifest = async (manifest) => {
    if (manifest?.source?.kind !== 'compiled' || !durableManifests?.put) return false;
    await durableManifests.put(manifest);
    return true;
  };

  const configureCompiler = ({ provider = null, endpoint = '', events = null, version = 'dev' } = {}) => {
    configuredCompilerProvider = provider || new HttpCompilerProvider({ endpoint:String(endpoint || '').trim() });
    configuredCompiler = null;
    configuredCompilerGetter = async () => {
      if (!configuredCompiler) {
        const { AssetCompiler } = await import('./production/compiler/AssetCompiler.js');
        configuredCompiler = new AssetCompiler({ store, provider:configuredCompilerProvider, events, version });
      }
      return configuredCompiler;
    };
    return configuredCompilerGetter;
  };

  const module = {
    async readAssetBytes(id) {
      const manifest = registry.getManifest(id);
      if (manifest.source.kind === 'compiled') {
        const entry = await store.get(manifest.source.key);
        if (!entry?.bytes) throw new Error('RESOURCE_UNAVAILABLE');
        return entry.bytes.slice();
      }
      if (manifest.source.kind !== 'glb') throw new Error('RESOURCE_UNAVAILABLE');
      const { AssetCompiler } = await import('./production/compiler/AssetCompiler.js');
      return new AssetCompiler({ store }).fetchBytes(manifest.source.url);
    },
    async installPreparedAssets(entries, operation) {
      const added = [];
      try {
        const durableIds = new Set((await durableManifests?.list?.() || []).map(manifest => manifest.id));
        for (const entry of entries) if (!registry.has(entry.manifest.id) && durableIds.has(entry.manifest.id)) throw new Error('ASSET_ID_CONFLICT');
        // Check every identity before touching durable storage.
        for (const entry of entries) if (registry.has(entry.manifest.id)) {
          const existing = registry.getManifest(entry.manifest.id);
          const definition = Object.fromEntries(Object.keys(entry.expectedDefinition).map(key => [key, existing[key]]));
          if (canonicalAssetJson(definition) !== canonicalAssetJson(entry.expectedDefinition) || await assetDigest(await module.readAssetBytes(existing.id)) !== entry.expectedSourceHash) throw new Error('ASSET_ID_CONFLICT');
        }
        for (const entry of entries) {
          if (registry.has(entry.manifest.id)) continue;
          const key = entry.manifest.source.key, previous = await store.get(key);
          if (previous && await assetDigest(previous.bytes) !== await assetDigest(entry.bytes)) throw new Error('ASSET_ID_CONFLICT');
          added.push({ id: entry.manifest.id, key, bytesAdded: !previous });
          await store.put(key, entry.bytes, { manifestId: entry.manifest.id });
          await module.registerManifest(entry.manifest);
        }
        return await operation();
      } catch (error) {
        const failures = [];
        for (const entry of added.reverse()) try {
          registry.removeManifest(entry.id);
          await durableManifests?.delete?.(entry.id);
          if (entry.bytesAdded) await store.delete(entry.key);
        } catch (failure) { failures.push(failure); }
        if (failures.length) throw Object.assign(new AggregateError([error, ...failures], 'Project resource rollback failed'), { code: 'PROJECT_ROLLBACK_FAILED' });
        throw error;
      }
    },
    async importMechanicalDraft(input) {
      const draft=mechanicalDraftSchema.parse(input);
      const hash=await assetDigest(new TextEncoder().encode(canonicalAssetJson({draft,compiler:'mechanical-draft-v1'})));
      const id='asset_'+hash;
      if(registry.has(id)) {
        const manifest=registry.getManifest(id);
        return {manifest,admission:assetAdmission(manifest)};
      }
      const { compileRecipeGeometry } = await import('./production/AssetRecipe.js');
      const {bytes}=await compileRecipeGeometry(mechanicalDraftToAssetRecipe(draft));
      return module.importPackageAsset({id,bytes,definition:mechanicalDraftToManifest(draft)});
    },
    async importPackageAsset({ id, bytes, definition }) {
      assertEmbeddedGLB(bytes);
      if (registry.has(id)) throw Object.assign(new Error('Asset id already exists'), {code:'ASSET_ID_CONFLICT'});
      const { AssetCompiler } = await import('./production/compiler/AssetCompiler.js');
      const compiler = new AssetCompiler({ store, version: 'v2-input-1' });
      // Prepare bytes without publishing them. Failed physical checks must leave no binary.
      const output = definition.capabilityLevel === 'visual'
        ? await compiler.compileVisual({ bytes, assetId:id, label:definition.label, persist:false })
        : await compiler.compile({ bytes, assetId:id, sourceName:'package.glb', definition,
          authoringIntent:{usage:'interactive'}, persist:false });
      output.manifest.capabilityLevel = definition.capabilityLevel;
      if (Object.values(output.manifest.parts || {}).some(part=>part.joint && part.joint.type!=='fixed')) {
        if (!articulationVerifier) throw Object.assign(new Error('Runtime verification unavailable'), {code:'RUNTIME_VERIFICATION_UNAVAILABLE'});
        const report=await articulationVerifier.verify(id,{manifest:output.manifest,requireRegistration:true,requireSettled:true,
          instantiate:async()=>({object:await loader.gltfLoader.loadBytes(output.optimizedBytes)})});
        if (!report.ok) throw Object.assign(new Error('Package articulation failed validation'),
          {code:'ASSET_PHYSICS_VERIFICATION_FAILED',details:report});
        output.manifest.verification={articulation:report};
        output.manifest.compiler.quality.advisory=output.manifest.compiler.quality.advisory.filter(item=>item.code!=='ARTICULATION_UNVERIFIED');
        output.manifest.compiler.quality.status=output.manifest.compiler.quality.advisory.length?'provisional':'ready';
      }
      const previous=await store.get(id);
      if (previous) throw Object.assign(new Error('Compiled asset id already exists'), {code:'ASSET_ID_CONFLICT'});
      try {
        await store.put(id,output.optimizedBytes,{manifestId:id,quality:output.manifest.compiler.quality.status});
        await module.registerManifest(output.manifest);
      } catch (error) {
        registry.removeManifest(id);
        try {
          await durableManifests?.delete?.(id);
          await store.delete(id);
        } catch (rollbackError) {
          throw Object.assign(new AggregateError([error,rollbackError],'Package publish rollback failed'),
            {code:'ASSET_PUBLISH_ROLLBACK_FAILED'});
        }
        throw error;
      }
      return {manifest:output.manifest,admission:assetAdmission(output.manifest)};
    },
    async prepareInteraction({bytes,urdfBytes,name='import.glb'}) {
      if(!(bytes instanceof Uint8Array) || bytes.byteLength>32*1024*1024) throw Object.assign(new Error('Invalid GLB input'),{code:'ASSET_INPUT_INVALID'});
      bytes=bytes.slice();assertEmbeddedGLB(bytes);
      let partProposal=null,urdfHash=null;
      if(urdfBytes) {
        if(!(urdfBytes instanceof Uint8Array) || !urdfBytes.length || urdfBytes.length>1024*1024) throw Object.assign(new Error('Invalid URDF input'),{code:'ASSET_INPUT_INVALID'});
        urdfBytes=urdfBytes.slice();urdfHash=await assetDigest(urdfBytes);
        if(!configuredCompilerProvider?.runUrdfProposal || configuredCompilerProvider.isConfigured?.()===false) throw Object.assign(new Error('URDF requires the configured compiler provider'),{code:'URDF_PROVIDER_UNAVAILABLE'});
        const response=await configuredCompilerProvider.runUrdfProposal(urdfBytes);
        partProposal=response.partProposal;
        if(partProposal?.version!==1 || !Array.isArray(partProposal.parts) || partProposal.parts.length>32) throw Object.assign(new Error('Invalid URDF proposal'),{code:'CAPABILITY_PROPOSAL_INVALID'});
      }
      const {AssetCompiler}=await import('./production/compiler/AssetCompiler.js');
      return new AssetCompiler({store,version:'interaction-v1'}).proposeInteraction({bytes,sourceName:name,partProposal,urdfHash});
    },
    async screenInteraction({bytes,urdfBytes,name='import.glb',proposalId,hypothesisIds}={}) {
      assertEmbeddedGLB(bytes);
      if (!/^[a-f0-9]{64}$/.test(String(proposalId || ''))) throw Object.assign(new Error('Invalid proposal ID'),{code:'PROPOSAL_MISMATCH'});
      if (!articulationVerifier) throw Object.assign(new Error('Runtime verification unavailable'),{code:'RUNTIME_VERIFICATION_UNAVAILABLE'});
      // Recompute from *these bytes*, with the same name and optional URDF:
      // the client never provides joint frames, evidence or verification flags.
      const proposal=await module.prepareInteraction({bytes,urdfBytes,name});
      if (proposal.proposalId !== proposalId) throw Object.assign(new Error('Review does not match the imported source'),{code:'PROPOSAL_MISMATCH'});
      const hypotheses=proposal.kinematics?.hypotheses || [];
      const ids=hypothesisIds || hypotheses.slice(0,4).map(item=>item.id);
      if (!Array.isArray(ids) || ids.length > 4 || ids.some(id=>typeof id!=='string'))
        throw Object.assign(new Error('Invalid hypothesis selection'),{code:'HYPOTHESIS_SELECTION_INVALID'});
      if (!ids.length) return {schema:'agentscape.kinematic-screen',schemaVersion:1,
        proposalId,sourceHash:proposal.sourceHash,results:[],admission:'not-granted',
        interpretation:'simulation-only; no semantic authorization or real-world mechanism proof'};
      const {screenKinematicHypotheses}=await import('./production/verification/KinematicHypothesisScreen.js');
      return screenKinematicHypotheses({bytes,proposal,ids,loader:loader.gltfLoader,verifier:articulationVerifier});
    },
    async importReviewedGLB({bytes,urdfBytes,name='import.glb',review,level='physical'}) {
      review=interactionReviewSchema.parse(review);
      bytes=bytes.slice();urdfBytes=urdfBytes?.slice();
      const proposal=await module.prepareInteraction({bytes,urdfBytes,name});
      if(review.proposalId!==proposal.proposalId) throw Object.assign(new Error('Review does not match the imported source'),{code:'PROPOSAL_MISMATCH'});
      const hash=await assetDigest(new TextEncoder().encode(canonicalAssetJson({source:proposal.sourceHash,review,compiler:'interaction-v1'}))),assetId=`asset_${hash}`;
      if(registry.has(assetId)) return {asset:`asset://sha256/${hash}`,manifest:registry.getManifest(assetId),admission:assetAdmission(registry.getManifest(assetId))};
      if(!articulationVerifier) throw Object.assign(new Error('Runtime verification unavailable'),{code:'RUNTIME_VERIFICATION_UNAVAILABLE'});
      const {AssetCompiler}=await import('./production/compiler/AssetCompiler.js');
      const output=await new AssetCompiler({store,version:'interaction-v1'}).compile({bytes,assetId,sourceName:name,
        authoringIntent:{usage:'interactive'},interactionReview:review,
        partProposal:review.parts.length ? {version:1,source:'reviewed-capability-proposal',parts:review.parts.map(part=>({...part,actions:[],targets:{}}))} : null});
      try {
        if(Object.keys(output.manifest.parts || {}).length!==review.parts.length) throw Object.assign(new Error('Part review did not compile'),{code:'CAPABILITY_REVIEW_INVALID'});
        const report=await articulationVerifier.verify(assetId,{manifest:output.manifest,requireRegistration:true,verifyRigidBody:true,requireSettled:true,
          instantiate:async()=>({object:await loader.loadCompiled(output.manifest.source)})});
        if(!report.ok || !report.physicsRegistered || report.tested!==review.parts.length || report.parts.some(part=>!part.actions?.some(action=>action.moved))) throw Object.assign(new Error('Imported physics failed validation'),{code:'ASSET_PHYSICS_VERIFICATION_FAILED',details:report});
        output.manifest.verification={articulation:report};
        output.manifest.capabilityLevel=level;output.manifest.contentHash=hash;
        output.manifest.compiler.quality.advisory=output.manifest.compiler.quality.advisory.filter(item=>item.code!=='ARTICULATION_UNVERIFIED');
        output.manifest.compiler.quality.status=output.manifest.compiler.quality.advisory.length?'provisional':'ready';
        output.manifest.provenance.interactionSource={sourceHash:proposal.sourceHash,urdfHash:proposal.urdfHash,proposalId:proposal.proposalId};
        await module.registerManifest(output.manifest);
        return {asset:`asset://sha256/${hash}`,manifest:output.manifest,admission:assetAdmission(output.manifest)};
      } catch(error) { await store.delete?.(assetId);throw error; }
    },
    async importGLB({ bytes, level = 'visual', label = 'Imported model', review = null, urdfBytes, name }) {
      if(review) return module.importReviewedGLB({bytes,level,review,urdfBytes,name});
      if (level !== 'visual') throw Object.assign(new Error('GLB physical import requires an explicit compiled definition'), { code: 'CAPABILITY_UNAVAILABLE' });
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > 32 * 1024 * 1024) throw Object.assign(new Error('Invalid GLB input'), { code: 'ASSET_INPUT_INVALID' });
      // Own the input before asynchronous hashing; callers may reuse their buffer.
      bytes = bytes.slice();
      assertEmbeddedGLB(bytes);
      const hash = await assetDigest(bytes), assetId = `asset_${hash}`;
      if (registry.has(assetId)) return { asset: `asset://sha256/${hash}`, manifest: registry.getManifest(assetId), admission: assetAdmission(registry.getManifest(assetId)) };
      const { AssetCompiler } = await import('./production/compiler/AssetCompiler.js');
      const output = await new AssetCompiler({ store, version: 'v2-input-1' }).compileVisual({ bytes, assetId, label });
      output.manifest.contentHash = hash;
      await module.registerManifest(output.manifest);
      return { asset: `asset://sha256/${hash}`, manifest: output.manifest, admission: assetAdmission(output.manifest) };
    },
    async importRecipe(input) {
      const recipe = recipeSchema.parse(input);
      const hash = await assetDigest(new TextEncoder().encode(canonicalAssetJson({ recipe, compiler: 'v2-input-1' }))), assetId = `asset_${hash}`;
      if (registry.has(assetId)) return { asset: `asset://sha256/${hash}`, manifest: registry.getManifest(assetId), admission: assetAdmission(registry.getManifest(assetId)) };
      const { compileRecipeGeometry } = await import('./production/AssetRecipe.js');
      const { AssetCompiler } = await import('./production/compiler/AssetCompiler.js');
      const { bytes } = await compileRecipeGeometry(recipe);
      const compiler = new AssetCompiler({ store, version: 'v2-input-1' });
      const output = recipe.capabilities.level === 'visual' ? await compiler.compileVisual({ bytes, assetId, label: recipe.id })
        : await compiler.compile({ bytes, assetId, sourceName: 'recipe.glb', label: recipe.id,
          authoringIntent: { usage: recipe.capabilities.physics.body === 'dynamic' ? 'movable' : 'static' },
          definition: { type: 'prop', label: recipe.id, actions: recipe.capabilities.actions, physics: recipe.capabilities.physics, surfaces: recipe.capabilities.surfaces } });
      output.manifest.capabilityLevel = recipe.capabilities.level;
      output.manifest.contentHash = hash;
      output.manifest.provenance = { ...output.manifest.provenance, recipe };
      const admission = assetAdmission(output.manifest);
      if (admission.status === 'rejected') throw Object.assign(new Error('Recipe rejected'), { code: 'ASSET_REJECTED' });
      await module.registerManifest(output.manifest);
      return { asset: `asset://sha256/${hash}`, manifest: output.manifest, admission };
    },
    registry,
    loader,
    catalog,
    compiledStore:store,
    manifestStore:durableManifests,
    library,

    getManifest(assetId) {
      return registry.getManifest(assetId);
    },

    hasAsset(assetId) {
      return registry.has(assetId);
    },

    assertCompatibleManifest(manifest) {
      return registry.assertCompatibleManifest(manifest);
    },

    configureRenderer(renderer) {
      return loader.configureRenderer?.(renderer);
    },

    instantiate(assetId, options) {
      return loader.instantiate(assetId, options);
    },

    configureVerification({ articulationVerifier: verifier = null } = {}) {
      if (verifier != null && typeof verifier.verify !== 'function') {
        throw new TypeError('Asset articulation verifier must provide verify(assetId)');
      }
      articulationVerifier = verifier;
      return module;
    },

    async verifyArticulation(assetId, options) {
      if (!articulationVerifier) {
        const error = new Error('Asset articulation verification is not configured');
        error.code = 'ASSET_ARTICULATION_VERIFIER_UNAVAILABLE';
        throw error;
      }
      return options==null ? articulationVerifier.verify(assetId) : articulationVerifier.verify(assetId, options);
    },

    async verifyAndUpdateArticulation(assetId, options) {
      return verifyAndUpdateAssetArticulation(module,assetId,options);
    },

    async hydrate() {
      if (hydrated) return { manifests:registry.size, restored:false };
      if (!durableManifests?.list) {
        await library.hydrate();
        hydrated = true;
        return { manifests:registry.size, restored:false };
      }
      const persisted = await durableManifests.list();
      let restored = 0;
      for (const manifest of persisted) {
        const changed = registry.registerManifest(manifest);
        if (changed) restored += 1;
      }
      await library.hydrate();
      hydrated = true;
      return { manifests:persisted.length, restored };
    },

    async registerManifest(manifest, options = {}) {
      const changed = registry.registerManifest(manifest, options);
      await persistManifest(registry.getManifest(manifest.id));
      return changed;
    },

    async approveAsset(assetId, metadata = {}) {
      return library.approve(assetId, metadata);
    },

    async listApprovedAssets() {
      return library.list();
    },

    configureProduction({
      artifacts,
      getAssetCompiler = null,
      compilerProvider = null,
      compilerEndpoint = '',
      events = null,
      version = 'dev',
      idFactory = undefined
    } = {}) {
      if (!artifacts?.registry || !artifacts?.byteStore) {
        throw new AssetProductionError('ASSET_PRODUCTION_INVALID', 'Asset production requires an ArtifactModule boundary');
      }
      const compilerGetter = getAssetCompiler || configureCompiler({
        provider:compilerProvider,
        endpoint:compilerEndpoint,
        events,
        version
      });
      producer = createAssetProducer({
        artifactRegistry:artifacts.registry,
        byteStore:artifacts.byteStore,
        getAssetCompiler:compilerGetter,
        assetRegistry:registry,
        onManifestRegistered:persistManifest,
        events,
        now,
        ...(idFactory ? { idFactory } : {})
      });
      return module;
    },

    setCompilerEndpoint(endpoint = '') {
      configuredCompilerProvider?.setEndpoint?.(String(endpoint || '').trim());
      return module;
    },

    async produceAsset(request = {}) {
      if (!producer) {
        throw new AssetProductionError(
          'ASSET_PRODUCTION_NOT_CONFIGURED',
          'Asset production requires composition-time compiler configuration'
        );
      }
      return producer(request);
    }
  };

  return module;
}
