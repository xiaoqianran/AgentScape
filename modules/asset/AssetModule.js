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
import { recipeSchema, canonicalAssetJson, assetDigest, assertEmbeddedGLB } from './model/AssetInputContracts.js';

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
    async importPackageAsset({ id, bytes, definition }) {
      assertEmbeddedGLB(bytes);
      const { AssetCompiler } = await import('./production/compiler/AssetCompiler.js');
      const compiler = new AssetCompiler({ store, version: 'v2-input-1' });
      const output = definition.capabilityLevel === 'visual'
        ? await compiler.compileVisual({ bytes, assetId: id, label: definition.label })
        : await compiler.compile({ bytes, assetId: id, sourceName: 'package.glb', definition, authoringIntent: { usage: 'interactive' } });
      output.manifest.capabilityLevel = definition.capabilityLevel;
      await module.registerManifest(output.manifest);
      return { manifest: output.manifest, admission: assetAdmission(output.manifest) };
    },
    async importGLB({ bytes, level = 'visual', label = 'Imported model' }) {
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
