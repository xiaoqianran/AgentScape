import { HttpCompilerProvider } from '../../asset/compiler/providers/HttpCompilerProvider.js';
import { ConnectorClient } from '../connector/ConnectorClient.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { GenerationOrchestrator } from './GenerationOrchestrator.js';

const SAFE_ASSET_CHARS=/[^A-Za-z0-9_-]+/g;
const generatedAssetId=(prompt,instanceId='')=>{
  const base=String(instanceId || prompt || 'asset').trim().replace(SAFE_ASSET_CHARS,'_').replace(/^_+|_+$/g,'').slice(0,145) || 'asset';
  return `generated_${base}`;
};

export class GenerationRuntime extends GenerationOrchestrator {
  constructor({
    assetModule,
    assetManager,
    assetCatalog,
    compiledAssetStore,
    events=null,
    version='dev',
    compilerProvider=null,
    compilerEndpoint='',
    connectorClient=undefined,
    connectorEndpoint='',
    providerRegistry=null,
    ...orchestratorOptions
  }={}) {
    if (!assetModule?.configurePublication || typeof assetModule.publishAsset !== 'function') {
      throw new TypeError('GenerationRuntime requires AssetModule publication boundary');
    }
    if (!assetManager?.getManifest || !assetCatalog?.resolveExisting || !compiledAssetStore) {
      throw new TypeError('GenerationRuntime requires AssetManager, AssetCatalog, and CompiledAssetStore');
    }

    const providers=providerRegistry || new ProviderRegistry();
    let connector=connectorClient;
    let connectorError=null;
    if (connector===undefined) {
      connector=null;
      const endpoint=String(connectorEndpoint || '').trim();
      if (endpoint) {
        try { connector=new ConnectorClient({endpoint}); }
        catch (error) { connectorError={code:error.code || 'CONNECTOR_ENDPOINT_INVALID',message:error.message}; }
      }
    }

    const compiler=compilerProvider || new HttpCompilerProvider({endpoint:String(compilerEndpoint || '').trim()});
    let assetCompiler=null;
    const getAssetCompiler=async()=>{
      if (!assetCompiler) {
        const { AssetCompiler }=await import('../../asset/compiler/AssetCompiler.js');
        assetCompiler=new AssetCompiler({store:compiledAssetStore,provider:compiler,events,version});
      }
      return assetCompiler;
    };

    assetModule.configurePublication({getAssetCompiler,events});
    super({
      providerRegistry:providers,
      connectorClient:connector,
      artifactRegistry:assetModule.artifactRegistry,
      byteStore:assetModule.byteStore,
      publishAsset:assetModule.publishAsset,
      events,
      ...orchestratorOptions
    });

    this.assetManager=assetManager;
    this.assetCatalog=assetCatalog;
    this.compilerProvider=compiler;
    this.connectorError=connectorError;
    this.getAssetCompiler=getAssetCompiler;
  }

  setCompilerEndpoint(endpoint='') {
    this.compilerProvider?.setEndpoint?.(String(endpoint || '').trim());
    return this;
  }

  canGenerateAsset(options={}) {
    return this.canGenerateTextAsset({provider:options.provider || null,imageProvider:options.imageProvider || null});
  }

  async generateAsset(prompt,options={}) {
    const text=String(prompt || '').trim();
    if (!text) throw new Error('Asset generation requires prompt');
    if (!this.canGenerateAsset(options)) {
      return {
        status:'generator_not_configured',prompt:text,provider:options.provider || null,
        hint:'No Connector-discovered text-to-asset capability is currently available.'
      };
    }
    const assetId=String(options.assetId || options.id || generatedAssetId(text,options.instanceId)).trim();
    const produced=await this.generateTextAsset({
      prompt:text,assetId,label:options.label || text,
      ...(options.provider ? {provider:options.provider} : {}),
      ...(options.imageProvider ? {imageProvider:options.imageProvider} : {}),
      ...(options.timeoutMs != null ? {timeoutMs:options.timeoutMs} : {}),
      ...(options.pollIntervalMs != null ? {pollIntervalMs:options.pollIntervalMs} : {}),
      ...(options.options ? {options:options.options} : {}),
      ...(options.imageOptions ? {imageOptions:options.imageOptions} : {})
    });
    return {
      ...this.assetCatalog.summary(produced.manifest),
      status:produced.status,
      admission:produced.admission,
      generation:{route:produced.route || null,jobs:produced.jobs || null,artifactId:produced.artifactId || null}
    };
  }

  async resolveAssetRequest(request={}) {
    const query=request.query || request.type || request.assetId || '';
    const found=this.assetCatalog.resolveExisting(query,{assetId:request.assetId || null,limit:request.limit ?? 5});
    if (found.status==='found') return found;
    if (!request.generate) return found;
    const generated=await this.generateAsset(query,request);
    if (generated.status==='generator_not_configured') return {status:generated.status,query,assets:[],hint:generated.hint};
    if (generated.status==='asset-rejected') return {status:'rejected',query,assets:[],admission:generated.admission,assetId:generated.id};
    return {status:'generated',query,assets:[generated]};
  }
}

export function attachGenerationRuntime(runtime,options={}) {
  if (!runtime?.assetModule || !runtime?.assets || !runtime?.assetCatalog || !runtime?.compiledAssetStore) {
    throw new TypeError('attachGenerationRuntime requires a WorldRuntime domain shell');
  }
  if (runtime.generation) return runtime.generation;
  const generation=new GenerationRuntime({
    assetModule:runtime.assetModule,
    assetManager:runtime.assets,
    assetCatalog:runtime.assetCatalog,
    compiledAssetStore:runtime.compiledAssetStore,
    events:runtime.events,
    version:runtime.version,
    ...options
  });
  runtime.generation=generation;
  runtime.generationState={status:'connection-required',reason:generation.connectorClient ? 'PAIRING_REQUIRED' : 'CONNECTOR_NOT_CONFIGURED'};
  runtime.generationConnectorError=generation.connectorError;
  return generation;
}
