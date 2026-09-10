import { createArtifactModule } from '../../modules/artifact/ArtifactModule.js';
import { sha256ArtifactHash } from '../../modules/artifact/IncrementalSha256.js';
import { ConnectorArtifactClient } from '../../modules/generation/connector/ConnectorArtifactClient.js';
import { ConnectorClient } from '../../modules/generation/connector/ConnectorClient.js';
import { ProviderRegistry } from '../../modules/generation/providers/ProviderRegistry.js';
import { GenerationOrchestrator } from './GenerationOrchestrator.js';

const SAFE_ASSET_CHARS=/[^A-Za-z0-9_-]+/g;
const generatedAssetId=(prompt,instanceId='')=>{
  const base=String(instanceId || prompt || 'asset').trim().replace(SAFE_ASSET_CHARS,'_').replace(/^_+|_+$/g,'').slice(0,145) || 'asset';
  return `generated_${base}`;
};

export class GenerationRuntime extends GenerationOrchestrator {
  constructor({
    assetModule,
    artifactModule=null,
    events=null,
    version='dev',
    compilerProvider=null,
    compilerEndpoint='',
    connectorClient=undefined,
    connectorEndpoint='',
    providerRegistry=null,
    assetInputPolicy='any',
    ...orchestratorOptions
  }={}) {
    if (!assetModule?.configurePublication || typeof assetModule.publishAsset !== 'function') {
      throw new TypeError('GenerationRuntime requires AssetModule publication boundary');
    }
    const assetCatalog=assetModule.catalog;
    if (!assetCatalog?.resolveExisting || typeof assetModule.setCompilerEndpoint !== 'function') {
      throw new TypeError('GenerationRuntime requires a complete AssetModule');
    }
    const artifacts=artifactModule || createArtifactModule();

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

    assetModule.configurePublication({
      artifacts,
      compilerProvider,
      compilerEndpoint,
      events,
      version
    });
    super({
      providerRegistry:providers,
      connectorClient:connector,
      artifactRegistry:artifacts.registry,
      byteStore:artifacts.byteStore,
      publishAsset:assetModule.publishAsset,
      persistArtifact:(artifactId,cacheKey)=>artifacts.persistArtifact?.(artifactId,cacheKey),
      events,
      ...orchestratorOptions
    });

    this.artifacts=artifacts;
    this.assetInputPolicy=assetInputPolicy;
    this.assetModule=assetModule;
    this.assetCatalog=assetCatalog;
    this.connectorError=connectorError;
    this.connectorArtifactClient=connector ? new ConnectorArtifactClient({connectorClient:connector}) : null;
  }

  async initialize(options={}) {
    await this.artifacts.hydrate?.();
    return super.initialize(options);
  }

  async uploadInputArtifact(bytes,{mime='image/png'}={}) {
    if (!this.connectorArtifactClient || !this.connectorClient?.isPaired?.()) {
      const error=new Error('A paired Connector is required to publish a local input image');
      error.code='CONNECTION_REQUIRED';
      throw error;
    }
    const data=bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!data.byteLength) {
      const error=new Error('Local input image is empty');
      error.code='LOCAL_IMAGE_EMPTY';
      throw error;
    }
    const expectedHash=sha256ArtifactHash([data]);
    const uploaded=await this.connectorArtifactClient.upload(data,{mime});
    if (uploaded.hash!==expectedHash || uploaded.bytes!==data.byteLength || uploaded.mime!==mime) {
      const error=new Error('Connector input Artifact does not match the approved local image');
      error.code='LOCAL_IMAGE_UPLOAD_INTEGRITY_MISMATCH';
      throw error;
    }
    const existing=this.artifacts.registry.get(uploaded.id);
    if (existing && (existing.hash!==expectedHash || existing.bytes!==data.byteLength || existing.mime!==mime)) {
      const error=new Error('Local Artifact identity conflicts with Connector upload');
      error.code='LOCAL_IMAGE_ARTIFACT_CONFLICT';
      throw error;
    }
    const now=new Date().toISOString();
    if (!existing) {
      const connector=this.connectorClient.session()?.connector;
      this.artifacts.registry.register({
        id:uploaded.id,role:uploaded.role,type:'image',schema:{id:'agentscape.image',version:'1'},
        mime,format:'png',bytes:data.byteLength,hash:expectedHash,
        producer:{
          jobId:`local_${expectedHash.slice(7,23)}`,provider:'local-upload',
          operation:'local-upload.image.upload.v1',attempt:1
        },
        lineage:{parents:[]},createdAt:now,retention:{class:'project'},integrity:{state:'declared'},
        locations:connector ? [{
          id:`connector_${uploaded.id}`,kind:'connector',scope:'application',state:'available',verifiedAt:now,
          access:{kind:'connector-artifact',artifactId:uploaded.id,connector:{id:connector.id,instance:connector.instance}}
        }] : []
      });
    }
    const cacheKey=`cache_${uploaded.id}`;
    if (!this.artifacts.byteStore.get(cacheKey)) {
      const writer=this.artifacts.byteStore.begin({artifactId:uploaded.id,maxBytes:data.byteLength});
      try {
        await writer.write(data);
        await writer.commit({key:cacheKey,hash:expectedHash,mime,bytes:data.byteLength});
      } catch (error) {
        if (writer.state==='open') await writer.abort();
        throw error;
      }
      this.artifacts.registry.updateLocation(uploaded.id,{
        id:`local_${uploaded.id}`,kind:'local-cache',scope:'application',state:'available',verifiedAt:now,
        access:{kind:'cache-key',key:cacheKey}
      });
    }
    const verified=this.artifacts.registry.verifyIntegrity(uploaded.id,{
      hash:expectedHash,bytes:data.byteLength,mime,verifiedAt:now,method:'local-upload-sha256-v1'
    });
    await this.artifacts.persistArtifact?.(uploaded.id,cacheKey);
    return verified;
  }

  setCompilerEndpoint(endpoint='') {
    this.assetModule.setCompilerEndpoint(endpoint);
    return this;
  }

  canGenerateAsset(options={}) {
    if (this.assetInputPolicy==='approved-image') return false;
    return this.canGenerateTextAsset({provider:options.provider || null,imageProvider:options.imageProvider || null});
  }

  async generateAsset(prompt,options={}) {
    const text=String(prompt || '').trim();
    if (!text) throw new Error('Asset generation requires prompt');
    if (this.assetInputPolicy==='approved-image') return {
      status:'image_input_required',prompt:text,
      hint:'请在图片资产工作台选择并确认物体，生成入库后再由 Agent 放置。'
    };
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
    if (generated.status==='image_input_required') return {status:generated.status,query,assets:[],hint:generated.hint};
    if (generated.status==='generator_not_configured') return {status:generated.status,query,assets:[],hint:generated.hint};
    if (generated.status==='asset-rejected') return {status:'rejected',query,assets:[],admission:generated.admission,assetId:generated.id};
    return {status:'generated',query,assets:[generated]};
  }
}

export function attachGenerationRuntime(runtime,options={}) {
  if (!runtime?.assetModule) {
    throw new TypeError('attachGenerationRuntime requires a WorldRuntime domain shell');
  }
  if (runtime.generation) return runtime.generation;
  const generation=new GenerationRuntime({
    assetModule:runtime.assetModule,
    events:runtime.events,
    version:runtime.version,
    ...options
  });
  runtime.generation=generation;
  runtime.generationState={status:'connection-required',reason:generation.connectorClient ? 'PAIRING_REQUIRED' : 'CONNECTOR_NOT_CONFIGURED'};
  runtime.generationConnectorError=generation.connectorError;
  return generation;
}
