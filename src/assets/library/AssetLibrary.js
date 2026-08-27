import { validateAssetManifest } from '../schema.js';
import { createDefaultProviderRegistry } from '../../providers/ProviderRegistry.js';
import { assetAdmission } from '../admission.js';

const normalize = (value = '') => String(value).trim().toLowerCase();
const SEARCH_STOPWORDS=new Set(['a','an','the','of','to','for','in','on','with','and','or']);
const tokens = (value = '') => normalize(value)
  .split(/[^a-z0-9\u4e00-\u9fff]+/)
  .filter((token)=>token && !SEARCH_STOPWORDS.has(token) && (/[^a-z0-9]/.test(token) || token.length>=2));
const SAFE_ASSET_CHARS=/[^A-Za-z0-9_-]+/g;
const generatedAssetId=(prompt,instanceId='')=>{
  const base=String(instanceId || prompt || 'asset').trim().replace(SAFE_ASSET_CHARS,'_').replace(/^_+|_+$/g,'').slice(0,145) || 'asset';
  return `generated_${base}`;
};

export class AssetLibrary {
  constructor({ assetManager, generator = null, generationOrchestrator = null, events = null, providerRegistry = null, embodiedGenAdapter } = {}) {
    this.assetManager = assetManager;
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

  list() {
    return [...this.assetManager.manifests.values()].map((manifest) => this.summary(manifest));
  }

  summary(manifest) {
    return {
      id: manifest.id,
      type: manifest.type,
      label: manifest.label || manifest.id,
      description: manifest.description || '',
      tags: [...(manifest.tags || [])],
      actions: [...manifest.actions],
      source: manifest.source.kind
    };
  }

  search(query, { limit = 8 } = {}) {
    const q = normalize(query);
    if (!q) return this.list().slice(0, limit);
    const qTokens = tokens(q);
    const scored = [];
    for (const manifest of this.assetManager.manifests.values()) {
      const fields = [manifest.id, manifest.type, manifest.label, manifest.description, ...(manifest.tags || []), ...(manifest.aliases || [])]
        .filter(Boolean).map(normalize);
      let score = 0;
      for (const field of fields) {
        if (field === q) score += 12;
        else if (field.includes(q)) score += 6;
        for (const token of qTokens) if (field.includes(token)) score += 2;
      }
      if (score > 0) scored.push({ score, asset: this.summary(manifest) });
    }
    return scored.sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id)).slice(0, limit).map((x) => x.asset);
  }

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
