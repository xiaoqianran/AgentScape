import { ArtifactImporter } from "../artifacts/ArtifactImporter.js";
import { IncrementalSha256 } from "../artifacts/IncrementalSha256.js";
import { ConnectorArtifactClient } from "../connector/ConnectorArtifactClient.js";
import { ConnectorCapabilityAdapter } from "../connector/ConnectorCapabilityAdapter.js";
import { ConnectorJobClient } from "../connector/ConnectorJobClient.js";
import { GenerationJobReconciler } from "../jobs/GenerationJobReconciler.js";
import { connectorJobStatusIsRemoteTerminal, sanitizeJobData } from "../jobs/GenerationJobProjection.js";

const clone=(value)=>value==null?value:structuredClone(value);
const GENERATION_CATEGORY=/generation/i;
const IMAGE_GENERATION_CATEGORY=/image-generation/i;
const ASSET_GENERATION_CATEGORY=/asset-generation/i;
const SAFE_ROLE=/^[a-z0-9][a-z0-9._-]{0,95}$/i;
const PNG_MIME="image/png";
const GLB_MIME="model/gltf-binary";
const DEFAULT_POLL_INTERVAL_MS=1000;
const DEFAULT_GENERATION_TIMEOUT_MS=30*60*1000;
const PENDING_GENERATION_STATUSES=new Set(["generation-pending","generation-cancelling"]);
const FAILED_GENERATION_STATUSES=new Set(["generation-failed","generation-cancelled","generation-expired"]);
const MIME_DESCRIPTOR=Object.freeze({
  "model/gltf-binary":{type:"asset-bundle",format:"glb"},
  "application/json":{type:"metadata",format:"json"},
  "image/png":{type:"image",format:"png"},
  "image/jpeg":{type:"image",format:"jpeg"},
  "image/webp":{type:"image",format:"webp"},
  "application/xml":{type:"metadata",format:"xml"},
  "text/xml":{type:"metadata",format:"xml"},
  "text/plain":{type:"text",format:"text"},
  "model/obj":{type:"asset-source",format:"obj"}
});

export class GenerationOrchestrationError extends Error {
  constructor(code,message,details={}) {
    super(message);
    this.name="GenerationOrchestrationError";
    this.code=code;
    this.details=clone(details);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value!=="object") return value;
  const out={};
  for (const key of Object.keys(value).sort()) out[key]=stableValue(value[key]);
  return out;
}

function requestIdentity(request) {
  const safe={
    provider:String(request.provider||"").trim(),
    operation:String(request.operation||"").trim(),
    inputs:sanitizeJobData(request.inputs||{},"inputs"),
    profile:request.profile==null?null:String(request.profile),
    options:sanitizeJobData(request.options||{},"options"),
    outputRoles:[...new Set((request.outputRoles||[]).map(String).filter(Boolean))].sort(),
    parent:request.parent==null?null:sanitizeJobData(request.parent,"parent"),
    retention:request.retention==null?null:sanitizeJobData(request.retention,"retention"),
    metadata:request.metadata==null?null:sanitizeJobData(request.metadata,"metadata")
  };
  const hasher=new IncrementalSha256();
  hasher.update(new TextEncoder().encode(JSON.stringify(stableValue(safe))));
  const requestHash=hasher.digestArtifactHash();
  return {safe,requestHash,idempotencyKey:`idem_${requestHash.slice(7,47)}`};
}

function generationStatus(job) {
  const status=job?.status;
  if (["accepted","queued","running"].includes(status)) return "generation-pending";
  if (status==="connection_required") return "connection-required";
  if (status==="cancel_requested") return "generation-cancelling";
  if (status==="cancelled") return "generation-cancelled";
  if (status==="failed") return "generation-failed";
  if (status==="expired") return "generation-expired";
  if (status==="succeeded") return "provider-succeeded";
  return "generation-unknown";
}

function safeJobView(job) {
  if (!job) return null;
  return {
    status:generationStatus(job),jobId:job.id,provider:job.provider,operation:job.operation,
    phase:job.phase,stage:job.stage,progress:clone(job.progress),attempt:job.attempt,
    createdAt:job.createdAt,submittedAt:job.submittedAt,startedAt:job.startedAt,
    updatedAt:job.updatedAt,completedAt:job.completedAt,error:clone(job.error),
    artifacts:clone(job.result?.artifacts||[]),relations:clone(job.relations||[]),
    capability:{hash:job.capabilityHash,revision:job.capabilityRevision}
  };
}

function requireJobClient(client) {
  if (!client) throw new GenerationOrchestrationError("CONNECTION_REQUIRED","Generation Connector is not configured or paired");
  return client;
}

function capabilityDefault(capability,key) {
  const property=capability?.input?.schema?.properties?.[key];
  if (property?.default!==undefined) return clone(property.default);
  if (Array.isArray(property?.enum) && property.enum.length) return clone(property.enum[0]);
  return undefined;
}

function preferredProfile(capability) {
  const profiles=capability?.profiles || {};
  if (Object.prototype.hasOwnProperty.call(profiles,"recommended")) return "recommended";
  return Object.keys(profiles)[0] || null;
}

function requiredOutputRoles(capability) {
  const required=capability?.output?.required || [];
  return required.length ? [...required] : [...(capability?.output?.roles || [])];
}

function textInputs(capability,prompt) {
  const inputs={prompt};
  for (const key of capability?.input?.schema?.required || []) {
    if (key==="prompt") continue;
    const value=capabilityDefault(capability,key);
    if (value===undefined) {
      throw new GenerationOrchestrationError("GENERATION_CAPABILITY_INCOMPLETE",`Capability ${capability.operation} requires unsupported input ${key}`,{provider:capability.provider,operation:capability.operation,input:key});
    }
    inputs[key]=value;
  }
  return inputs;
}

function selectTextAssetRoute(providerRegistry,{provider=null,imageProvider=null}={}) {
  const capabilities=providerRegistry.findCapabilities({availableOnly:true})
    .filter((capability)=>GENERATION_CATEGORY.test(capability.category||""))
    .sort((a,b)=>`${a.provider}:${a.operation}`.localeCompare(`${b.provider}:${b.operation}`));
  const finalFilter=(capability)=>!provider || capability.provider===provider;
  const direct=capabilities.find((capability)=>finalFilter(capability)
    && ASSET_GENERATION_CATEGORY.test(capability.category||"")
    && capability.input?.types?.includes("text")
    && capability.output?.roles?.length);
  if (direct) return {kind:"direct",asset:direct};
  const asset=capabilities.find((capability)=>finalFilter(capability)
    && ASSET_GENERATION_CATEGORY.test(capability.category||"")
    && capability.input?.types?.includes("image")
    && capability.output?.roles?.length);
  const image=capabilities.find((capability)=>(!imageProvider || capability.provider===imageProvider)
    && IMAGE_GENERATION_CATEGORY.test(capability.category||"")
    && capability.input?.types?.includes("text")
    && capability.output?.roles?.length);
  return asset && image ? {kind:"composed",image,asset} : null;
}

function descriptorShapeForArtifact(summary) {
  const mime=String(summary?.mime||"").trim().toLowerCase();
  const shape=MIME_DESCRIPTOR[mime];
  if (!shape) throw new GenerationOrchestrationError("ARTIFACT_MIME_UNSUPPORTED","Generation result uses an unsupported artifact MIME",{artifactId:summary?.id||null,mime:mime||null});
  const role=String(summary?.role||"").trim();
  if (!SAFE_ROLE.test(role)) throw new GenerationOrchestrationError("ARTIFACT_DESCRIPTOR_INCOMPLETE","Generation result artifact role is missing or invalid",{artifactId:summary?.id||null});
  if (!summary?.hash || summary?.bytes==null) throw new GenerationOrchestrationError("ARTIFACT_DESCRIPTOR_INCOMPLETE","Generation result lacks hash/byte integrity metadata",{artifactId:summary?.id||null});
  return {...shape,mime,role};
}

export class GenerationOrchestrator {
  constructor({
    providerRegistry,connectorClient=null,capabilityAdapter=new ConnectorCapabilityAdapter(),
    jobClient=null,jobReconciler=null,artifactRegistry=null,byteStore=null,
    artifactImporter=null,publishAsset=null,
    events=null,now=()=>Date.now(),monotonic=()=>globalThis.performance?.now?.() ?? Date.now(),
    sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms)),pollIntervalMs=DEFAULT_POLL_INTERVAL_MS,
    generationTimeoutMs=DEFAULT_GENERATION_TIMEOUT_MS
  }={}) {
    if (!providerRegistry?.listProviders || !providerRegistry?.findCapabilities) {
      throw new GenerationOrchestrationError("GENERATION_ORCHESTRATOR_INVALID","GenerationOrchestrator requires ProviderRegistry");
    }
    this.providerRegistry=providerRegistry;
    this.connectorClient=connectorClient;
    this.capabilityAdapter=capabilityAdapter;
    this.jobClient=jobClient || (connectorClient ? new ConnectorJobClient({connectorClient,providerRegistry}) : null);
    this.jobReconciler=jobReconciler || (this.jobClient ? new GenerationJobReconciler({jobClient:this.jobClient}) : null);
    this.artifactRegistry=artifactRegistry || artifactImporter?.registry || null;
    this.byteStore=byteStore || artifactImporter?.byteStore || null;
    this.artifactImporter=artifactImporter || (connectorClient && this.artifactRegistry && this.byteStore ? new ArtifactImporter({
      registry:this.artifactRegistry,byteStore:this.byteStore,
      connectorArtifactClient:new ConnectorArtifactClient({connectorClient}),now
    }) : null);
    this.publishAsset=publishAsset;
    this.events=events;
    this.now=now;
    this.monotonic=monotonic;
    this.sleep=sleep;
    this.pollIntervalMs=Math.max(0,Number(pollIntervalMs)||0);
    this.generationTimeoutMs=Math.max(1,Number(generationTimeoutMs)||DEFAULT_GENERATION_TIMEOUT_MS);
  }

  canGenerateTextAsset(options={}) {
    return Boolean(this.jobClient && selectTextAssetRoute(this.providerRegistry,options));
  }

  async #runJobToSuccess(request,{timeoutMs=this.generationTimeoutMs,pollIntervalMs=this.pollIntervalMs}={}) {
    const timeout=Math.max(1,Number(timeoutMs)||this.generationTimeoutMs);
    const interval=Math.max(0,Number(pollIntervalMs)||0);
    const deadline=this.monotonic()+timeout;
    let view=await this.submitGenerationJob(request);
    while (PENDING_GENERATION_STATUSES.has(view.status)) {
      if (this.monotonic()>=deadline) {
        throw new GenerationOrchestrationError("GENERATION_TIMEOUT","Generation Job did not reach provider success before timeout",{jobId:view.jobId,provider:view.provider,operation:view.operation,timeoutMs:timeout});
      }
      if (interval) await this.sleep(Math.min(interval,Math.max(0,deadline-this.monotonic())));
      view=await this.getGenerationJob(view.jobId);
    }
    if (view.status==="provider-succeeded") return view;
    if (view.status==="connection-required") {
      throw new GenerationOrchestrationError("CONNECTION_REQUIRED","Generation Connector became unavailable while waiting for a Job",{jobId:view.jobId,provider:view.provider,operation:view.operation});
    }
    if (FAILED_GENERATION_STATUSES.has(view.status)) {
      throw new GenerationOrchestrationError("GENERATION_JOB_FAILED","Generation Job ended without a usable Artifact",{jobId:view.jobId,provider:view.provider,operation:view.operation,status:view.status,error:view.error||null});
    }
    throw new GenerationOrchestrationError("GENERATION_JOB_INVALID","Generation Job reached an unsupported orchestration state",{jobId:view.jobId,status:view.status});
  }

  async generateTextAsset(request={}) {
    const prompt=String(request.prompt||"").trim();
    const assetId=String(request.assetId||"").trim();
    if (!prompt) throw new GenerationOrchestrationError("GENERATION_PROMPT_REQUIRED","generateTextAsset requires prompt");
    if (!assetId) throw new GenerationOrchestrationError("ASSET_ID_REQUIRED","generateTextAsset requires assetId");
    const route=selectTextAssetRoute(this.providerRegistry,{provider:request.provider||null,imageProvider:request.imageProvider||null});
    if (!this.jobClient || !route) {
      throw new GenerationOrchestrationError("GENERATION_ROUTE_UNAVAILABLE","No available Connector route can produce a 3D asset from text",{provider:request.provider||null,imageProvider:request.imageProvider||null});
    }
    const wait={timeoutMs:request.timeoutMs??this.generationTimeoutMs,pollIntervalMs:request.pollIntervalMs??this.pollIntervalMs};
    if (route.kind==="direct") {
      const job=await this.#runJobToSuccess({
        provider:route.asset.provider,operation:route.asset.operation,inputs:textInputs(route.asset,prompt),
        profile:preferredProfile(route.asset),options:request.options||{},outputRoles:requiredOutputRoles(route.asset),
        metadata:{purpose:"world-asset",assetId}
      },wait);
      const produced=await this.generateAndCompileAsset({jobId:job.jobId,assetId,label:request.label||prompt});
      return {...produced,route:{kind:"direct",provider:route.asset.provider,operation:route.asset.operation},jobs:{asset:job.jobId}};
    }

    const imageJob=await this.#runJobToSuccess({
      provider:route.image.provider,operation:route.image.operation,inputs:textInputs(route.image,prompt),
      profile:preferredProfile(route.image),options:request.imageOptions||{},outputRoles:requiredOutputRoles(route.image),
      metadata:{purpose:"world-reference-image",assetId}
    },wait);
    const sourceRole=requiredOutputRoles(route.image)[0];
    const source=imageJob.artifacts.find((artifact)=>artifact.role===sourceRole && artifact.mime===PNG_MIME)
      || imageJob.artifacts.find((artifact)=>artifact.mime===PNG_MIME);
    if (!source?.id || !source.hash) {
      throw new GenerationOrchestrationError("GENERATION_SOURCE_ARTIFACT_INVALID","Text-to-image Job produced no lossless PNG Artifact suitable for 3D reconstruction",{jobId:imageJob.jobId,provider:imageJob.provider});
    }
    const assetInputs={sourceArtifact:{id:source.id,role:source.role,mime:source.mime,hash:source.hash}};
    for (const key of route.asset.input?.schema?.required || []) {
      if (key==="sourceArtifact") continue;
      const value=capabilityDefault(route.asset,key);
      if (value===undefined) {
        throw new GenerationOrchestrationError("GENERATION_CAPABILITY_INCOMPLETE",`Capability ${route.asset.operation} requires unsupported input ${key}`,{provider:route.asset.provider,operation:route.asset.operation,input:key});
      }
      assetInputs[key]=value;
    }
    const assetJob=await this.#runJobToSuccess({
      provider:route.asset.provider,operation:route.asset.operation,inputs:assetInputs,
      profile:preferredProfile(route.asset),options:request.options||{},outputRoles:requiredOutputRoles(route.asset),
      parent:{jobId:imageJob.jobId},metadata:{purpose:"world-asset",assetId}
    },wait);
    const produced=await this.generateAndCompileAsset({jobId:assetJob.jobId,assetId,label:request.label||prompt});
    return {
      ...produced,
      route:{kind:"text-image-3d",image:{provider:route.image.provider,operation:route.image.operation},asset:{provider:route.asset.provider,operation:route.asset.operation}},
      jobs:{image:imageJob.jobId,asset:assetJob.jobId},sourceArtifact:{id:source.id,role:source.role,mime:source.mime,hash:source.hash}
    };
  }

  async initialize({pair=false,pairingId=null}={}) {
    if (!this.connectorClient) return {status:"connection-required",reason:"CONNECTOR_NOT_CONFIGURED"};
    try {
      if (!this.connectorClient.isPaired?.()) {
        if (!pair) return {status:"connection-required",reason:"PAIRING_REQUIRED"};
        const pairing=await this.connectorClient.pair({pairingId});
        if (pairing.status==='approval_required') {
          return {status:"connection-required",reason:"APPROVAL_REQUIRED",pairingId:pairing.pairingId,connector:pairing.connector};
        }
      }
      const refreshed=await this.capabilityAdapter.refresh(this.connectorClient,this.providerRegistry);
      const bootstrapped=this.jobReconciler ? await this.jobReconciler.bootstrap() : {state:"ready",jobs:[]};
      return {
        status:"generation-ready",connector:this.connectorClient.session()?.connector||null,
        capabilityRevision:refreshed.snapshot.revision,providers:refreshed.snapshot.providers.length,
        jobs:bootstrapped.jobs?.length||0
      };
    } catch (error) {
      if (["CONNECTION_REQUIRED","PAIRING_REQUIRED"].includes(error?.code)) {
        return {status:"connection-required",reason:error.code};
      }
      throw error;
    }
  }

  listGenerationProviders({availableOnly=false}={}) {
    const providers=this.providerRegistry.listProviders({includeDisabled:!availableOnly})
      .map((provider)=>{
        const capabilities=(provider.capabilities||[]).filter((capability)=>GENERATION_CATEGORY.test(capability.category||""));
        if (!capabilities.length) return null;
        const source=this.providerRegistry.getProviderSource?.(provider.id)||null;
        return {
          id:provider.id,displayName:provider.displayName,status:provider.status,health:provider.health,
          operations:capabilities.filter((capability)=>!availableOnly||capability.status==="available").map((capability)=>capability.operation),
          connectionRequired:capabilities.some((capability)=>Boolean(capability.prerequisites?.connection)),
          capabilityRevision:source?.capabilityRevision||null,capabilityHash:source?.capabilityHash||null
        };
      })
      .filter((provider)=>provider && (!availableOnly || provider.status==="available" && provider.health!=="unavailable" && provider.operations.length));
    return {status:"providers-listed",providers};
  }

  connectorStatus() {
    const session=this.connectorClient?.session?.()||null;
    return {
      status:this.connectorClient?.isPaired?.() ? "paired" : "connection-required",
      connector:session?.connector||null,
      expiresAt:session?.expiresAt||null
    };
  }

  async pairConnector({pairingId=null}={}) {
    const state=await this.initialize({pair:true,pairingId});
    this.events?.emit?.("generation.state",clone(state));
    return state;
  }

  async revokeConnector() {
    if (!this.connectorClient) return {status:"connection-required",reason:"CONNECTOR_NOT_CONFIGURED"};
    const result=await this.connectorClient.revoke();
    const state={status:"connection-required",reason:result.status==="revoked"?"REVOKED":"PAIRING_REQUIRED"};
    this.events?.emit?.("generation.state",clone(state));
    return state;
  }

  listGenerationJobs() {
    const jobs=(this.jobClient?.listCached?.()||[]).map(safeJobView);
    return {status:this.connectorClient?.isPaired?.()?"jobs-listed":"connection-required",jobs};
  }

  async reconcileGenerationJobs() {
    if (!this.jobReconciler) return {status:"connection-required",jobs:this.listGenerationJobs().jobs};
    const result=await this.jobReconciler.bootstrap();
    const jobs=(result.jobs||this.jobClient.listCached?.()||[]).map(safeJobView);
    const status=result.state==="connection_required"?"connection-required":"jobs-reconciled";
    const payload={status,jobs,eventCursor:result.eventCursor??null};
    this.events?.emit?.("generation.jobs.reconciled",{status,count:jobs.length});
    return payload;
  }

  listGenerationCapabilities({provider=null,category=null,availableOnly=false}={}) {
    const capabilities=this.providerRegistry.findCapabilities({provider:provider||undefined,availableOnly})
      .filter((capability)=>GENERATION_CATEGORY.test(capability.category||""))
      .filter((capability)=>!category || capability.category===category)
      .map((capability)=>{
        const source=this.providerRegistry.getProviderSource?.(capability.provider)||null;
        return {
          provider:capability.provider,operation:capability.operation,version:capability.version,
          displayName:capability.displayName,category:capability.category,status:capability.status,
          input:{types:[...(capability.input?.types||[])],schema:clone(capability.input?.schema||null),limits:clone(capability.input?.limits||null)},
          output:{roles:[...(capability.output?.roles||[])],required:[...(capability.output?.required||[])],optional:[...(capability.output?.optional||[])]},
          profiles:clone(capability.profiles||{}),optionsSchema:clone(capability.optionsSchema||null),
          execution:clone(capability.execution),support:clone(capability.support),
          prerequisites:{connection:Boolean(capability.prerequisites?.connection),authMode:capability.prerequisites?.authMode||null,license:capability.prerequisites?.license||null},
          connectionRequired:Boolean(capability.prerequisites?.connection),
          capabilityRevision:source?.capabilityRevision||null,capabilityHash:source?.capabilityHash||null
        };
      });
    return {status:"capabilities-listed",capabilities};
  }

  async submitGenerationJob(request={}) {
    const client=requireJobClient(this.jobClient);
    const identity=requestIdentity(request);
    const requestHash=request.requestHash==null?identity.requestHash:String(request.requestHash).trim();
    const idempotencyKey=request.idempotencyKey==null?identity.idempotencyKey:String(request.idempotencyKey).trim();
    const cached=client.listCached?.()||[];
    const sameKey=cached.find((job)=>job.idempotencyKey===idempotencyKey);
    if (sameKey) {
      if (sameKey.requestHash!==requestHash) {
        throw new GenerationOrchestrationError("JOB_IDEMPOTENCY_CONFLICT","Idempotency key is already bound to a different generation request",{jobId:sameKey.id});
      }
      return {...safeJobView(sameKey),reused:true};
    }
    const job=await client.submit({...identity.safe,requestHash,idempotencyKey});
    this.events?.emit?.("generation.job.submitted",{jobId:job.id,provider:job.provider,operation:job.operation});
    return {...safeJobView(job),reused:false};
  }

  async getGenerationJob(jobId,{cachedOnly=false}={}) {
    const client=requireJobClient(this.jobClient);
    if (cachedOnly) {
      const cached=client.getCached?.(jobId);
      if (!cached) throw new GenerationOrchestrationError("JOB_NOT_FOUND","Generation Job is not available in the local projection",{jobId});
      return safeJobView(cached);
    }
    try {
      const job=await client.get(jobId);
      return safeJobView(job);
    } catch (error) {
      if (error?.code==="CONNECTION_REQUIRED") {
        const cached=client.getCached?.(jobId);
        if (cached) return {...safeJobView(cached),status:"connection-required",recoverable:true};
      }
      throw error;
    }
  }

  async cancelGenerationJob(jobId) {
    const client=requireJobClient(this.jobClient);
    const cached=client.getCached?.(jobId);
    if (cached?.status==="cancel_requested" || cached && connectorJobStatusIsRemoteTerminal(cached.status)) {
      return {...safeJobView(cached),reused:true};
    }
    const job=await client.cancel(jobId);
    this.events?.emit?.("generation.job.cancelled",{jobId:job.id,status:job.status});
    return {...safeJobView(job),reused:false};
  }

  #registerJobArtifact(job,summary) {
    const shape=descriptorShapeForArtifact(summary);
    const session=this.connectorClient?.session?.();
    if (!session || session.status!=="paired") {
      throw new GenerationOrchestrationError("CONNECTION_REQUIRED","A paired Connector session is required to import generation artifacts");
    }
    const descriptor={
      id:summary.id,role:shape.role,type:shape.type,
      schema:{id:"agentscape.artifact",version:"1"},displayName:`${job.provider} ${shape.role}`,
      mime:shape.mime,format:shape.format,bytes:summary.bytes,hash:summary.hash,
      producer:{
        jobId:job.id,provider:job.provider,operation:job.operation,attempt:job.attempt,
        revision:job.capabilityRevision,model:job.model,workflow:job.workflow
      },
      lineage:{parents:[]},createdAt:job.completedAt||job.updatedAt||job.createdAt,
      retention:{class:"session"},
      locations:[{
        id:"connector_source",kind:"connector",scope:"job",state:"available",
        access:{kind:"connector-artifact",artifactId:summary.id,connector:{id:session.connector.id,instance:session.connector.instance}}
      }]
    };
    return this.artifactRegistry.register(descriptor);
  }

  async importGenerationResult(jobId,{artifactId=null,role=null}={}) {
    if (!this.artifactImporter || !this.artifactRegistry) throw new GenerationOrchestrationError("ARTIFACT_IMPORTER_UNAVAILABLE","Generation Artifact importer is not configured with AgentScape Artifact state");
    const client=requireJobClient(this.jobClient);
    let job;
    try { job=await client.get(jobId); }
    catch (error) {
      if (error?.code==="CONNECTION_REQUIRED") job=client.getCached?.(jobId);
      else throw error;
    }
    if (!job) throw new GenerationOrchestrationError("JOB_NOT_FOUND","Generation Job is unavailable",{jobId});
    if (job.status!=="succeeded") {
      throw new GenerationOrchestrationError("JOB_NOT_READY","Provider Job has not produced importable results",{jobId,status:generationStatus(job)});
    }
    const artifacts=job.result?.artifacts||[];
    const summary=artifactId
      ? artifacts.find((artifact)=>artifact.id===artifactId)
      : role
        ? artifacts.find((artifact)=>artifact.role===role)
        : artifacts.find((artifact)=>artifact.mime==="model/gltf-binary") || artifacts[0];
    if (!summary) throw new GenerationOrchestrationError("ARTIFACT_NOT_FOUND","Generation Job result contains no matching Artifact",{jobId,artifactId,role});
    const descriptor=this.#registerJobArtifact(job,summary);
    const verifiedLocal=descriptor.integrity?.state==="verified" && descriptor.locations?.some((location)=>location.kind==="local-cache"&&location.state==="available");
    const imported=verifiedLocal ? {artifact:descriptor,reused:true} : await this.artifactImporter.import(summary.id);
    const artifact=imported.artifact;
    this.events?.emit?.("generation.artifact.imported",{jobId:job.id,artifactId:artifact.id,hash:artifact.hash});
    return {
      status:"artifact-imported",jobId:job.id,
      artifact:{
        id:artifact.id,role:artifact.role,mime:artifact.mime,format:artifact.format,
        bytes:artifact.bytes,hash:artifact.hash,integrity:artifact.integrity?.state,
        producer:clone(artifact.producer),lineage:clone(artifact.lineage)
      },
      reused:Boolean(imported.reused)
    };
  }

  async generateAndCompileAsset(request={}) {
    const assetId=String(request.assetId||"").trim();
    if (!assetId) throw new GenerationOrchestrationError("ASSET_ID_REQUIRED","generateAndCompileAsset requires assetId");
    const view=request.jobId
      ? await this.getGenerationJob(request.jobId)
      : await this.submitGenerationJob(request);
    if (view.status!=="provider-succeeded") return {...view,assetId};

    const imported=await this.importGenerationResult(view.jobId,{
      artifactId:request.artifactId||null,role:request.artifactRole||null
    });
    if (imported.artifact.mime!=="model/gltf-binary" || imported.artifact.format!=="glb") {
      throw new GenerationOrchestrationError("ARTIFACT_FORMAT_UNSUPPORTED","Asset compilation requires a verified GLB generation artifact",{artifactId:imported.artifact.id});
    }
    if (typeof this.publishAsset!=="function") {
      throw new GenerationOrchestrationError("ASSET_PUBLISHER_UNAVAILABLE","Generation asset publication is not configured");
    }
    const produced=await this.publishAsset({artifactId:imported.artifact.id,assetId,label:request.label});
    return {...produced,jobId:view.jobId,providerStatus:"provider-succeeded",artifactStatus:"artifact-imported"};
  }
}
