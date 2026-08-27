import { validateAssetManifest } from '../schema.js';
import { AssetCatalog } from '../AssetCatalog.js';
import { createDefaultProviderRegistry } from '../../providers/ProviderRegistry.js';
import { assetAdmission } from '../admission.js';

const SAFE_ASSET_CHARS=/[^A-Za-z0-9_-]+/g;
const generatedAssetId=(prompt,instanceId='')=>{
  const base=String(instanceId || prompt || 'asset').trim().replace(SAFE_ASSET_CHARS,'_').replace(/^_+|_+$/g,'').slice(0,145) || 'asset';
  return `generated_${base}`;
};

export class AssetLibrary {
  constructor({ assetManager, catalog = null, generator = null, generationOrchestrator = null, events = null, providerRegistry = null, embodiedGenAdapter } = {}) {
    this.assetManager = assetManager;
    this.catalog = catalog || new AssetCatalog({ assetManager });
    this.generator = generator;
    this.generation = generationOrchestrator;
    this.events = events;
    this.providerRegistry = providerRegistry || createDefaultProviderRegistry({ generator, embodiedGenAdapter });
  }

  attachGeneration(orchestrator) {
    if (orchestrator != null && typeof orchestrator.generateTextAsset !== 'function') throw new Error('AssetLibrary generation orchestrator must implement generateTextAsset');
    this.generation=orchestrator || null;
    return this;
  }

  canGenerate(options={}) {
    if (this.generation?.canGenerateTextAsset?.({provider:options.provider||null,imageProvider:options.imageProvider||null})) return true;
    return Boolean(this.providerRegistry.resolveCapability({provider:options.provider||undefined,operation:options.operation||undefined,input:'text',output:'asset'}));
  }

  list() { return this.catalog.list(); }
  summary(manifest) { return this.catalog.summary(manifest); }
  search(query, options) { return this.catalog.search(query, options); }

  async resolve(query, options = {}) {
    const found = this.search(query, { limit: options.limit ?? 5 });
    if (found.length) return { status: 'found', query, assets: found };
    if (!options.generate) return { status: 'missing', query, assets: [] };
    const generated = await this.generate(query, options);
    if (generated.status === 'generator_not_configured') return { status: generated.status, query, assets: [], hint: generated.hint };
    if (generated.status === 'rejected') return { status:'rejected', query, assets:[], admission:generated.admission, assetId:generated.id };
    return { status: 'generated', query, assets: [generated] };
  }

  async generate(prompt, options = {}) {
    if (this.generation?.canGenerateTextAsset?.({provider:options.provider||null,imageProvider:options.imageProvider||null})) {
      const assetId=String(options.assetId || options.id || generatedAssetId(prompt,options.instanceId)).trim();
      const produced=await this.generation.generateTextAsset({
        prompt,assetId,label:options.label || prompt,
        ...(options.provider?{provider:options.provider}:{}),
        ...(options.imageProvider?{imageProvider:options.imageProvider}:{}),
        ...(options.timeoutMs!=null?{timeoutMs:options.timeoutMs}:{}),
        ...(options.pollIntervalMs!=null?{pollIntervalMs:options.pollIntervalMs}:{}),
        ...(options.options?{options:options.options}:{}),
        ...(options.imageOptions?{imageOptions:options.imageOptions}:{})
      });
      if (produced.status==='asset-rejected') return {status:'rejected',id:assetId,admission:produced.admission,generation:produced};
      const manifest=produced.manifest || (this.assetManager.has(assetId) ? this.assetManager.getManifest(assetId) : null);
      if (!manifest) throw new Error('GenerationOrchestrator completed without registering a runtime Asset manifest');
      const admission=produced.admission || assetAdmission(manifest,{generated:true});
      this.events?.emit('asset.registered',{assetId,generated:true,provider:manifest.provenance?.assetProduction?.sourceArtifact?.producer?.provider || null,admission:admission.status});
      return {...this.summary(manifest),admission,generation:{route:produced.route||null,jobs:produced.jobs||null,artifactId:produced.artifactId||null}};
    }
    if (options.provider && !this.providerRegistry.hasProvider(options.provider)) {
      throw new Error(`Asset Generator response requires manifest or a recognized provider payload contract; unknown provider: ${options.provider}`);
    }
    const capability = this.providerRegistry.resolveCapability({
      provider: options.provider || undefined,
      operation: options.operation || undefined,
      input: 'text',
      output: 'asset'
    });
    if (!capability) {
      return {
        status: 'generator_not_configured',
        prompt,
        provider: options.provider || null,
        hint: options.provider
          ? `Provider ${options.provider} has no available text-to-asset capability.`
          : 'Configure an Asset Generator endpoint before requesting missing assets.'
      };
    }
    const request = { prompt, ...options };
    if (options.provider) request.provider = capability.provider;
    const result = await this.providerRegistry.execute(capability, request);
    let manifest;
    if (result?.manifest) {
      manifest = validateAssetManifest(structuredClone(result.manifest));
      manifest.provenance={
        ...(manifest.provenance || {}),
        admission:assetAdmission(manifest,{generated:true})
      };
    } else {
      const responseCapability = result?.provider && result.provider !== capability.provider
        ? this.providerRegistry.resolveCapability({ provider: result.provider, input: 'text', output: 'asset' })
        : null;
      const consumerCapability = responseCapability || capability;
      try {
        manifest = validateAssetManifest(await this.providerRegistry.consume(consumerCapability, result, { request, options }));
      } catch (error) {
        if (/no registered consumer/.test(error?.message || '')) {
          throw new Error(`Asset Generator response requires manifest or a recognized provider payload; no consumer for ${consumerCapability.operation}`);
        }
        throw error;
      }
    }
    const admission=assetAdmission(manifest,{generated:true});
    if (admission.status==='rejected') return { status:'rejected', id:manifest.id, admission };
    this.assetManager.registerManifest(manifest);
    this.events?.emit('asset.registered', { assetId: manifest.id, generated: true, provider:manifest.provenance?.provider || null, admission:admission.status });
    return { ...this.summary(manifest), admission };
  }
}
