import { assetAdmission } from '../assets/admission.js';
import { validateAssetManifest } from '../assets/schema.js';
import { HttpAssetGenerator } from '../assets/gateway/HttpAssetGenerator.js';
import { HttpCompilerProvider } from '../compiler/providers/HttpCompilerProvider.js';
import { ConnectorClient } from '../connector/ConnectorClient.js';
import { GenerationOrchestrator } from '../generation/GenerationOrchestrator.js';
import { createDefaultProviderRegistry } from '../providers/ProviderRegistry.js';

const readSetting = (storage, key) => {
  try { return storage?.getItem?.(key) || ''; }
  catch { return ''; }
};

const SAFE_ASSET_CHARS=/[^A-Za-z0-9_-]+/g;
const generatedAssetId=(prompt,instanceId='')=>{
  const base=String(instanceId || prompt || 'asset').trim().replace(SAFE_ASSET_CHARS,'_').replace(/^_+|_+$/g,'').slice(0,145) || 'asset';
  return `generated_${base}`;
};

export function createLegacyAssetAuthoring({ assetManager, catalog, generationPort, events = null }) {
  if (!assetManager?.registerManifest || !catalog?.search || !generationPort?.generate) {
    throw new TypeError('Legacy Asset authoring requires Asset state, Catalog, and generation port');
  }

  const canGenerateAsset=(options={})=>Boolean(generationPort.canGenerate?.(options));
  const generateAsset=async(prompt,options={})=>{
    if(!canGenerateAsset(options)){
      return {
        status:'generator_not_configured',prompt,provider:options.provider || null,
        hint:options.provider
          ? `Provider ${options.provider} has no available text-to-asset capability.`
          : 'Configure an Asset Generator before requesting missing assets.'
      };
    }
    const assetId=String(options.assetId || options.id || generatedAssetId(prompt,options.instanceId)).trim();
    const produced=await generationPort.generate(prompt,{...options,assetId,label:options.label || prompt});
    if(produced?.status==='unavailable'){
      return {
        status:'generator_not_configured',prompt,provider:options.provider || null,
        hint:produced.hint || 'No compatible Asset generation capability is available.'
      };
    }
    if(!produced?.manifest) throw new Error('Asset generation completed without a manifest');
    const manifest=validateAssetManifest(structuredClone(produced.manifest));
    const admission=produced.admission || assetAdmission(manifest,{generated:true});
    manifest.provenance={...(manifest.provenance || {}),admission};
    if(admission.status==='rejected') return {status:'rejected',id:manifest.id,admission};
    if(!assetManager.has(manifest.id)) assetManager.registerManifest(manifest);
    events?.emit('asset.registered',{
      assetId:manifest.id,generated:true,
      provider:manifest.provenance?.assetProduction?.sourceArtifact?.producer?.provider || manifest.provenance?.provider || null,
      admission:admission.status
    });
    return {
      ...catalog.summary(manifest),admission,
      ...(produced.generation ? {generation:produced.generation} : {})
    };
  };
  const resolveAssetRequest=async(request={})=>{
    const query=request.query || request.type || request.assetId || '';
    const found=catalog.resolveExisting(query,{assetId:request.assetId || null,limit:request.limit ?? 5});
    if(found.status==='found') return found;
    if(!request.generate) return found;
    const generated=await generateAsset(query,request);
    if(generated.status==='generator_not_configured') return {status:generated.status,query,assets:[],hint:generated.hint};
    if(generated.status==='rejected') return {status:'rejected',query,assets:[],admission:generated.admission,assetId:generated.id};
    return {status:'generated',query,assets:[generated]};
  };
  return { canGenerateAsset, generateAsset, resolveAssetRequest };
}

export function createLegacyAssetGenerationPort({ providerRegistry, generation, assetManager }) {
  if (!providerRegistry?.resolveCapability || !providerRegistry?.execute || !providerRegistry?.consume) {
    throw new TypeError('Legacy Asset generation requires ProviderRegistry');
  }
  if (!assetManager?.getManifest) throw new TypeError('Legacy Asset generation requires AssetManager');

  const orchestrated = (options = {}) => generation?.canGenerateTextAsset?.({
    provider: options.provider || null,
    imageProvider: options.imageProvider || null
  }) === true;

  return {
    canGenerate(options = {}) {
      if (orchestrated(options)) return true;
      return Boolean(providerRegistry.resolveCapability({
        provider: options.provider || undefined,
        operation: options.operation || undefined,
        input: 'text',
        output: 'asset'
      }));
    },

    async generate(prompt, options = {}) {
      if (orchestrated(options)) {
        const produced = await generation.generateTextAsset({
          prompt,
          assetId: options.assetId,
          label: options.label || prompt,
          ...(options.provider ? { provider: options.provider } : {}),
          ...(options.imageProvider ? { imageProvider: options.imageProvider } : {}),
          ...(options.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
          ...(options.pollIntervalMs != null ? { pollIntervalMs: options.pollIntervalMs } : {}),
          ...(options.options ? { options: options.options } : {}),
          ...(options.imageOptions ? { imageOptions: options.imageOptions } : {})
        });
        const manifest = produced.manifest || (assetManager.has(options.assetId) ? assetManager.getManifest(options.assetId) : null);
        if (!manifest) throw new Error('GenerationOrchestrator completed without a runtime Asset manifest');
        return {
          manifest,
          admission: produced.admission || null,
          generation: {
            route: produced.route || null,
            jobs: produced.jobs || null,
            artifactId: produced.artifactId || null
          }
        };
      }

      if (options.provider && !providerRegistry.hasProvider(options.provider)) {
        throw new Error(`Asset Generator response requires manifest or a recognized provider payload contract; unknown provider: ${options.provider}`);
      }
      const capability = providerRegistry.resolveCapability({
        provider: options.provider || undefined,
        operation: options.operation || undefined,
        input: 'text',
        output: 'asset'
      });
      if (!capability) {
        return {
          status: 'unavailable',
          hint: options.provider
            ? `Provider ${options.provider} has no available text-to-asset capability.`
            : 'Configure an Asset Generator endpoint before requesting missing assets.'
        };
      }

      const request = { prompt, ...options };
      if (options.provider) request.provider = capability.provider;
      const result = await providerRegistry.execute(capability, request);
      if (result?.manifest) return { manifest: result.manifest };

      const responseCapability = result?.provider && result.provider !== capability.provider
        ? providerRegistry.resolveCapability({ provider: result.provider, input: 'text', output: 'asset' })
        : null;
      const consumerCapability = responseCapability || capability;
      try {
        return {
          manifest: await providerRegistry.consume(consumerCapability, result, { request, options })
        };
      } catch (error) {
        if (/no registered consumer/.test(error?.message || '')) {
          throw new Error(`Asset Generator response requires manifest or a recognized provider payload; no consumer for ${consumerCapability.operation}`);
        }
        throw error;
      }
    }
  };
}

export function attachLegacyAuthoring(runtime, {
  storage = globalThis.localStorage ?? null,
  compilerProvider = null,
  assetGenerator = null,
  connectorClient = undefined,
  providerRegistry = null,
  generationOptions = {}
} = {}) {
  if (!runtime?.assetModule?.configurePublication || typeof runtime.assetModule.publishAsset !== 'function' || !runtime?.assets || !runtime?.assetCatalog || !runtime?.compiledAssetStore || !runtime?.events) {
    throw new TypeError('Legacy authoring requires a WorldRuntime domain shell');
  }
  if (runtime.authoring) return runtime.authoring;

  const compiler = compilerProvider || new HttpCompilerProvider({
    endpoint: readSetting(storage, 'agentscape.compilerEndpoint')
  });
  const generator = assetGenerator || new HttpAssetGenerator({
    endpoint: readSetting(storage, 'agentscape.assetGeneratorEndpoint')
  });
  const providers = providerRegistry || createDefaultProviderRegistry({ generator });

  let connector = connectorClient;
  let connectorError = null;
  if (connector === undefined) {
    connector = null;
    const endpoint = readSetting(storage, 'agentscape.connectorEndpoint');
    if (endpoint) {
      try { connector = new ConnectorClient({ endpoint }); }
      catch (error) {
        connectorError = {
          code: error.code || 'CONNECTOR_ENDPOINT_INVALID',
          message: error.message
        };
      }
    }
  }

  let assetCompiler = null;
  const getAssetCompiler = async () => {
    if (!assetCompiler) {
      const { AssetCompiler } = await import('../compiler/AssetCompiler.js');
      assetCompiler = new AssetCompiler({
        store: runtime.compiledAssetStore,
        provider: compiler,
        events: runtime.events,
        version: runtime.version
      });
    }
    return assetCompiler;
  };

  runtime.assetModule.configurePublication({
    getAssetCompiler,
    events: runtime.events
  });
  const generation = new GenerationOrchestrator({
    providerRegistry: providers,
    connectorClient: connector,
    artifactRegistry: runtime.assetModule.artifactRegistry,
    byteStore: runtime.assetModule.byteStore,
    publishAsset: runtime.assetModule.publishAsset,
    events: runtime.events,
    ...generationOptions
  });
  const generationPort = createLegacyAssetGenerationPort({
    providerRegistry: providers,
    generation,
    assetManager: runtime.assets
  });
  const assetAuthoring = createLegacyAssetAuthoring({
    assetManager: runtime.assets,
    catalog: runtime.assetCatalog,
    generationPort,
    events: runtime.events
  });

  const authoring = {
    compilerProvider: compiler,
    assetGenerator: generator,
    assetCatalog: runtime.assetCatalog,
    providerRegistry: providers,
    generation,
    generationPort,
    ...assetAuthoring,
    connectorError,
    getAssetCompiler,
    async initialize({ pair = true, pairingId = null } = {}) {
      let state = {
        status: 'connection-required',
        reason: connector ? 'PAIRING_REQUIRED' : 'CONNECTOR_NOT_CONFIGURED'
      };
      if (connector) {
        try { state = await generation.initialize({ pair, pairingId }); }
        catch (error) {
          state = {
            status: 'connection-required',
            reason: error.code || 'CONNECTOR_INITIALIZATION_FAILED'
          };
        }
      }
      runtime.generationState = state;
      runtime.events.emit('generation.state', structuredClone(state));
      return state;
    }
  };

  runtime.authoring = authoring;
  runtime.compilerProvider = compiler;
  runtime.assetGenerator = generator;
  runtime.generation = generation;
  runtime.generationConnectorError = connectorError;
  runtime.generationState = {
    status: 'connection-required',
    reason: connector ? 'PAIRING_REQUIRED' : 'CONNECTOR_NOT_CONFIGURED'
  };
  runtime.getAssetCompiler = getAssetCompiler;
  return authoring;
}
