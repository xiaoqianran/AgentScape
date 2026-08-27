import { AssetCatalog } from '../AssetCatalog.js';
import { assetAdmission } from '../admission.js';
import { validateAssetManifest } from '../schema.js';

const SAFE_ASSET_CHARS=/[^A-Za-z0-9_-]+/g;
const generatedAssetId=(prompt,instanceId='')=>{
  const base=String(instanceId || prompt || 'asset').trim().replace(SAFE_ASSET_CHARS,'_').replace(/^_+|_+$/g,'').slice(0,145) || 'asset';
  return `generated_${base}`;
};

export class AssetLibrary {
  constructor({ assetManager, catalog = null, generationPort = null, events = null } = {}) {
    if (!assetManager) throw new TypeError('AssetLibrary requires assetManager');
    this.assetManager = assetManager;
    this.catalog = catalog || new AssetCatalog({ assetManager });
    this.generationPort = generationPort;
    this.events = events;
  }

  attachGeneration(port) {
    if (port != null && (typeof port.canGenerate !== 'function' || typeof port.generate !== 'function')) {
      throw new TypeError('AssetLibrary generation port requires canGenerate() and generate()');
    }
    this.generationPort = port || null;
    return this;
  }

  canGenerate(options={}) { return Boolean(this.generationPort?.canGenerate(options)); }
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
    if (!this.canGenerate(options)) {
      return {
        status: 'generator_not_configured',
        prompt,
        provider: options.provider || null,
        hint: options.provider
          ? `Provider ${options.provider} has no available text-to-asset capability.`
          : 'Configure an Asset Generator before requesting missing assets.'
      };
    }

    const assetId=String(options.assetId || options.id || generatedAssetId(prompt,options.instanceId)).trim();
    const produced=await this.generationPort.generate(prompt,{
      ...options,
      assetId,
      label:options.label || prompt
    });
    if (produced?.status === 'unavailable') {
      return {
        status:'generator_not_configured',
        prompt,
        provider:options.provider || null,
        hint:produced.hint || 'No compatible Asset generation capability is available.'
      };
    }
    if (!produced?.manifest) throw new Error('Asset generation completed without a manifest');

    const manifest=validateAssetManifest(structuredClone(produced.manifest));
    const admission=produced.admission || assetAdmission(manifest,{generated:true});
    manifest.provenance={...(manifest.provenance || {}),admission};
    if (admission.status==='rejected') return {status:'rejected',id:manifest.id,admission};
    if (!this.assetManager.has(manifest.id)) this.assetManager.registerManifest(manifest);
    this.events?.emit('asset.registered',{
      assetId:manifest.id,
      generated:true,
      provider:manifest.provenance?.assetProduction?.sourceArtifact?.producer?.provider || manifest.provenance?.provider || null,
      admission:admission.status
    });
    return {
      ...this.summary(manifest),
      admission,
      ...(produced.generation ? {generation:produced.generation} : {})
    };
  }
}
