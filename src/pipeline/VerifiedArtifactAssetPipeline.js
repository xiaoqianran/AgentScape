import { assetAdmission } from '../assets/admission.js';
import { validateAssetManifest } from '../assets/schema.js';
import { requireSafeArtifactId } from '../artifacts/ArtifactDescriptor.js';

const SAFE_ASSET_ID=/^[A-Za-z0-9_-]{1,160}$/;
const CONTROL_RE=/[\u0000-\u001f\u007f]/;
const UNSAFE_TEXT_RE=/https?:\/\/|Bearer\s+|(?:^|\s)(?:[A-Za-z]:\\|\/)[^\s]+/i;
const clone=(value)=>value==null?value:structuredClone(value);
let fallbackSequence=0;

export class AssetProductionError extends Error {
  constructor(code,message,details={}) {
    super(message);
    this.name='AssetProductionError';
    this.code=code;
    this.details=clone(details);
  }
}

function requireAssetId(value) {
  const id=String(value??'').trim();
  if (!SAFE_ASSET_ID.test(id)) {
    throw new AssetProductionError('ASSET_ID_INVALID','Asset production requires a URL-safe AgentScape assetId');
  }
  return id;
}

function safeLabel(value,fallback) {
  const text=String(value??fallback??'').trim();
  if (!text || text.length>160 || CONTROL_RE.test(text) || UNSAFE_TEXT_RE.test(text)) {
    throw new AssetProductionError('ASSET_LABEL_INVALID','Asset production label is invalid or contains transport/path detail');
  }
  return text;
}

const defaultIdFactory=(kind)=>{
  const uuid=globalThis.crypto?.randomUUID?.()?.replaceAll('-','');
  return `${kind}_${uuid||`${Date.now()}_${++fallbackSequence}`}`;
};

function selectVerifiedCacheLocation(artifact) {
  return [...(artifact.locations||[])]
    .filter((location)=>location.kind==='local-cache' && location.state==='available' && location.access?.kind==='cache-key')
    .sort((a,b)=>a.id.localeCompare(b.id))[0] || null;
}

function safeProducer(artifact) {
  const producer=artifact.producer || {};
  return {
    jobId:producer.jobId || null,
    provider:producer.provider || null,
    operation:producer.operation || null,
    stage:producer.stage || null,
    attempt:producer.attempt || null,
    revision:producer.revision || null,
    model:clone(producer.model || null),
    workflow:clone(producer.workflow || null)
  };
}

function buildProvenance({artifact,assetId,admission}) {
  return {
    sourceArtifact:{
      id:artifact.id,
      hash:artifact.hash,
      bytes:artifact.bytes,
      mime:artifact.mime,
      producer:safeProducer(artifact)
    },
    assetId,
    admission:admission?{status:admission.status,reasons:[...(admission.reasons||[])]}:null
  };
}

export class VerifiedArtifactAssetPipeline {
  constructor({artifactRegistry,byteStore,assetCompiler,assetManager,events=null,now=()=>Date.now(),idFactory=defaultIdFactory}={}) {
    if (!artifactRegistry?.get || !artifactRegistry?.acquireLease || !artifactRegistry?.releaseLease) {
      throw new AssetProductionError('ASSET_PIPELINE_INVALID','VerifiedArtifactAssetPipeline requires ArtifactRegistry');
    }
    if (!byteStore?.get) throw new AssetProductionError('ASSET_PIPELINE_INVALID','VerifiedArtifactAssetPipeline requires a readable Artifact byte store');
    if (!assetCompiler?.compile) throw new AssetProductionError('ASSET_PIPELINE_INVALID','VerifiedArtifactAssetPipeline requires AssetCompiler');
    if (!assetManager?.registerManifest) throw new AssetProductionError('ASSET_PIPELINE_INVALID','VerifiedArtifactAssetPipeline requires AssetManager');
    this.artifactRegistry=artifactRegistry;
    this.byteStore=byteStore;
    this.assetCompiler=assetCompiler;
    this.assetManager=assetManager;
    this.events=events;
    this.now=now;
    this.idFactory=idFactory;
  }

  inspectInput({artifactId,assetId,label}={}) {
    const sourceArtifactId=requireSafeArtifactId(artifactId);
    const targetAssetId=requireAssetId(assetId);
    if (sourceArtifactId===targetAssetId) {
      throw new AssetProductionError('ASSET_IDENTITY_COLLISION','Artifact ID and AgentScape assetId must remain distinct identities',{artifactId:sourceArtifactId,assetId:targetAssetId});
    }
    const artifact=this.artifactRegistry.get(sourceArtifactId);
    if (!artifact) throw new AssetProductionError('ARTIFACT_NOT_FOUND','Source Artifact does not exist',{artifactId:sourceArtifactId});
    if (artifact.integrity?.state!=='verified') {
      throw new AssetProductionError('ARTIFACT_NOT_VERIFIED','Source Artifact must be independently verified before compilation',{artifactId:sourceArtifactId,integrity:artifact.integrity?.state||null});
    }
    if (artifact.mime!=='model/gltf-binary' || artifact.format!=='glb') {
      throw new AssetProductionError('ARTIFACT_FORMAT_UNSUPPORTED','AS-05 accepts verified GLB artifacts only',{artifactId:sourceArtifactId,mime:artifact.mime,format:artifact.format});
    }
    const location=selectVerifiedCacheLocation(artifact);
    if (!location) throw new AssetProductionError('ARTIFACT_LOCAL_BYTES_UNAVAILABLE','Verified Artifact has no available local-cache location',{artifactId:sourceArtifactId});
    const entry=this.byteStore.get(location.access.key);
    if (!entry?.data) throw new AssetProductionError('ARTIFACT_LOCAL_BYTES_UNAVAILABLE','Artifact local-cache entry is missing',{artifactId:sourceArtifactId,cacheKey:location.access.key});
    if (!(entry.data instanceof Uint8Array)) throw new AssetProductionError('ARTIFACT_CACHE_IDENTITY_MISMATCH','Artifact cache entry does not expose Uint8Array bytes',{artifactId:sourceArtifactId});
    const mismatches=[];
    if (entry.artifactId!==artifact.id) mismatches.push('artifactId');
    if (entry.hash!==artifact.hash) mismatches.push('hash');
    if (entry.bytes!==artifact.bytes || entry.data.byteLength!==artifact.bytes) mismatches.push('bytes');
    if (String(entry.mime||'').toLowerCase()!==artifact.mime) mismatches.push('mime');
    if (mismatches.length) {
      throw new AssetProductionError('ARTIFACT_CACHE_IDENTITY_MISMATCH','Artifact local-cache identity does not match verified descriptor',{
        artifactId:sourceArtifactId,cacheKey:location.access.key,mismatches
      });
    }
    return {
      artifact,
      location,
      entry,
      assetId:targetAssetId,
      label:safeLabel(label,artifact.displayName||targetAssetId),
      sourceName:`${artifact.id}.glb`
    };
  }

  async produce(request={}) {
    const input=this.inspectInput(request);
    if (this.assetManager.has?.(input.assetId)) {
      const existing=this.assetManager.getManifest(input.assetId);
      const source=existing?.provenance?.assetProduction?.sourceArtifact;
      if (source?.id===input.artifact.id && source?.hash===input.artifact.hash) {
        const admission=assetAdmission(existing,{generated:true});
        return {
          status:admission.status==='ready'?'asset-ready':admission.status==='provisional'?'asset-provisional':'asset-rejected',
          stage:'registered',registered:false,reused:true,
          artifactId:input.artifact.id,assetId:input.assetId,
          manifest:existing,compiler:{quality:clone(existing.compiler?.quality||null)},admission,
          provenance:buildProvenance({artifact:input.artifact,assetId:input.assetId,admission})
        };
      }
      throw new AssetProductionError('ASSET_ID_CONFLICT','AgentScape assetId is already registered from different provenance',{
        assetId:input.assetId,artifactId:input.artifact.id,
        existingArtifactId:source?.id||null,existingArtifactHash:source?.hash||null
      });
    }
    const leaseId=requireSafeArtifactId(this.idFactory('lease',input.artifact,input.assetId),'leaseId');
    let leaseHeld=false;
    try {
      this.artifactRegistry.acquireLease(input.artifact.id,{
        id:leaseId,
        holder:{kind:'application',id:input.assetId},
        reason:'asset-compile',
        createdAt:new Date(this.now()).toISOString()
      });
      leaseHeld=true;
      this.events?.emit?.('assetProduction.started',{
        artifactId:input.artifact.id,assetId:input.assetId,provider:input.artifact.producer?.provider||null
      });

      let compiled;
      try {
        compiled=await this.assetCompiler.compile({
          bytes:new Uint8Array(input.entry.data),
          sourceName:input.sourceName,
          assetId:input.assetId,
          label:input.label
        });
      } catch (error) {
        if (error?.code==='ASSET_COMPILE_REJECTED') {
          const admission={status:'rejected',reasons:['COMPILER_REJECTED']};
          const result={
            status:'asset-rejected',stage:'compiler',registered:false,
            artifactId:input.artifact.id,assetId:input.assetId,
            compiler:{quality:clone(error.details||null)},admission,
            provenance:buildProvenance({artifact:input.artifact,assetId:input.assetId,admission})
          };
          this.events?.emit?.('assetProduction.rejected',clone(result));
          return result;
        }
        throw new AssetProductionError('COMPILER_FAILED','AssetCompiler failed for a verified Artifact',{
          artifactId:input.artifact.id,assetId:input.assetId,cause:error?.code||error?.name||'Error'
        });
      }

      if (!compiled?.manifest) throw new AssetProductionError('COMPILER_FAILED','AssetCompiler returned no manifest',{artifactId:input.artifact.id,assetId:input.assetId});
      const manifest=clone(compiled.manifest);
      if (manifest.id!==input.assetId) {
        throw new AssetProductionError('COMPILER_IDENTITY_MISMATCH','AssetCompiler manifest id does not match requested assetId',{expected:input.assetId,actual:manifest.id||null});
      }
      const admission=assetAdmission(manifest,{generated:true});
      manifest.provenance={
        ...(manifest.provenance||{}),
        assetProduction:buildProvenance({artifact:input.artifact,assetId:input.assetId,admission}),
        admission:admission?{status:admission.status,reasons:[...(admission.reasons||[])]}:null
      };
      validateAssetManifest(manifest);

      if (admission.status==='rejected') {
        const result={
          status:'asset-rejected',stage:'admission',registered:false,
          artifactId:input.artifact.id,assetId:input.assetId,
          manifest,compiler:{quality:clone(compiled.quality||null)},admission,
          provenance:buildProvenance({artifact:input.artifact,assetId:input.assetId,admission})
        };
        this.events?.emit?.('assetProduction.rejected',clone(result));
        return result;
      }

      let registered;
      try {
        registered=this.assetManager.registerManifest(manifest);
      } catch (error) {
        throw new AssetProductionError('MANIFEST_REGISTRATION_FAILED','Compiled manifest could not be registered',{
          artifactId:input.artifact.id,assetId:input.assetId,cause:error?.code||error?.name||'Error'
        });
      }
      const status=admission.status==='ready'?'asset-ready':'asset-provisional';
      const result={
        status,stage:'registered',registered:Boolean(registered),
        artifactId:input.artifact.id,assetId:input.assetId,
        manifest:this.assetManager.getManifest?.(input.assetId)||clone(manifest),
        compiler:{quality:clone(compiled.quality||null)},admission,
        provenance:buildProvenance({artifact:input.artifact,assetId:input.assetId,admission})
      };
      this.events?.emit?.('assetProduction.registered',{
        artifactId:input.artifact.id,assetId:input.assetId,status,admission:admission.status,provider:input.artifact.producer?.provider||null
      });
      return result;
    } finally {
      if (leaseHeld) this.artifactRegistry.releaseLease(leaseId);
    }
  }
}
