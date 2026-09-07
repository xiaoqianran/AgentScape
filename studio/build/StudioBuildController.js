const ACTIVE_STATUSES=new Set(['generation-pending','generation-cancelling']);
const TERMINAL_FAILURES=new Set(['generation-failed','generation-cancelled','generation-expired','connection-required']);

const clone=(value)=>value==null?value:structuredClone(value);

export function preferredProfile(capability) {
  const profiles=capability?.profiles||{};
  return Object.hasOwn(profiles,'recommended')?'recommended':Object.keys(profiles)[0]||null;
}

export function requiredOutputRoles(capability) {
  const required=capability?.output?.required||[];
  return required.length?[...required]:[...(capability?.output?.roles||[])];
}

export function selectBuildCapability(generation,{category,inputType,requiredRole=null}={}) {
  const capabilities=generation?.listGenerationCapabilities?.({availableOnly:true})?.capabilities||[];
  return capabilities.find((capability)=>String(capability.category||'').includes(category)
    && capability.input?.types?.includes(inputType)
    && (!requiredRole||capability.output?.roles?.includes(requiredRole)))||null;
}

export function buildInputs(capability,seed={}) {
  const inputs={...seed};
  for(const key of capability?.input?.schema?.required||[]){
    if(inputs[key]!==undefined) continue;
    const property=capability.input.schema.properties?.[key];
    if(property?.default!==undefined) inputs[key]=clone(property.default);
    else if(Array.isArray(property?.enum)&&property.enum.length) inputs[key]=clone(property.enum[0]);
    else {
      const error=new Error(`生成能力缺少必需输入：${key}`);
      error.code='GENERATION_CAPABILITY_INCOMPLETE';
      throw error;
    }
  }
  return inputs;
}

export class StudioBuildController {
  constructor({world,placement=null,openGeneratedWorld=null,log=()=>{},pollIntervalMs=1200}={}) {
    if(!world?.generation) throw new TypeError('StudioBuildController requires world.generation');
    this.world=world;
    this.generation=world.generation;
    this.placement=placement;
    this.openGeneratedWorld=typeof openGeneratedWorld==='function'?openGeneratedWorld:null;
    this.log=log;
    this.pollIntervalMs=Math.max(0,Number(pollIntervalMs)||0);
  }

  capabilities() {
    const paired=this.generation.connectorStatus?.().status==='paired';
    const all=this.generation.listGenerationCapabilities?.({availableOnly:false})?.capabilities||[];
    const discovered={
      image:all.some((capability)=>String(capability.category||'').includes('image-generation')&&capability.input?.types?.includes('text')),
      asset:all.some((capability)=>String(capability.category||'').includes('asset-generation')),
      world:all.some((capability)=>String(capability.category||'').includes('world-generation'))
    };
    return {
      paired,
      image:Boolean(selectBuildCapability(this.generation,{category:'image-generation',inputType:'text'})),
      asset:Boolean(this.generation.canGenerateAsset?.()),
      world:Boolean(this.generation.canGenerateTextWorld?.()),
      discovered
    };
  }

  async connect({pairingId=null}={}) {
    return this.generation.pairConnector({pairingId});
  }

  async #wait(jobId,{onProgress=()=>{}}={}) {
    for(;;){
      const job=await this.generation.getGenerationJob(jobId);
      onProgress(job);
      if(job.status==='provider-succeeded') return job;
      if(TERMINAL_FAILURES.has(job.status)){
        const error=new Error(job.error?.message||`生成任务未成功：${job.status}`);
        error.code=job.error?.code||'GENERATION_JOB_FAILED';
        error.job=job;
        throw error;
      }
      if(!ACTIVE_STATUSES.has(job.status)){
        const error=new Error(`生成任务进入未知状态：${job.status}`);
        error.code='GENERATION_JOB_INVALID';
        throw error;
      }
      if(this.pollIntervalMs) await new Promise((resolve)=>setTimeout(resolve,this.pollIntervalMs));
    }
  }

  async generateImage({prompt,onProgress=()=>{}}={}) {
    const text=String(prompt||'').trim();
    if(!text) throw new Error('请输入 Image prompt');
    const capability=selectBuildCapability(this.generation,{category:'image-generation',inputType:'text'});
    if(!capability){const error=new Error('当前没有可用的 Text → Image 能力');error.code='GENERATION_ROUTE_UNAVAILABLE';throw error;}
    const job=await this.generation.submitGenerationJob({
      provider:capability.provider,
      operation:capability.operation,
      inputs:buildInputs(capability,{prompt:text}),
      profile:preferredProfile(capability),
      outputRoles:requiredOutputRoles(capability),
      metadata:{purpose:'studio-build-image'}
    });
    onProgress(job);
    const completed=job.status==='provider-succeeded'?job:await this.#wait(job.jobId,{onProgress});
    const summary=completed.artifacts.find((artifact)=>String(artifact.mime||'').startsWith('image/'));
    if(!summary){const error=new Error('Image 任务没有产生图像 Artifact');error.code='GENERATION_ARTIFACT_MISSING';throw error;}
    const imported=await this.generation.importGenerationResult(completed.jobId,{artifactId:summary.id});
    return {kind:'image',status:'ready',jobId:completed.jobId,artifactId:imported.artifact.id,artifact:imported.artifact,prompt:text};
  }

  async generateAsset({prompt,assetId=null,onProgress=()=>{}}={}) {
    const text=String(prompt||'').trim();
    if(!text) throw new Error('请输入 3D Asset prompt');
    onProgress({phase:'generation'});
    const produced=await this.generation.generateAsset(text,{assetId:assetId||undefined,label:text});
    if(produced.status==='generator_not_configured'){
      const error=new Error(produced.hint||'当前没有可用的 3D 生成能力');
      error.code='GENERATION_ROUTE_UNAVAILABLE';
      throw error;
    }
    if(produced.status==='asset-rejected'){
      const error=new Error('生成资产未通过准入检查');
      error.code='ASSET_REJECTED';
      error.admission=produced.admission;
      throw error;
    }
    return {kind:'asset',status:produced.status,assetId:produced.id||assetId,asset:produced,prompt:text};
  }

  async generateAssetFromImage({imageResult,assetId=null,onProgress=()=>{}}={}) {
    const source=imageResult?.artifact;
    if(!source?.id||!source?.hash) throw new Error('缺少可用于 3D 重建的 Image Artifact');
    const capability=selectBuildCapability(this.generation,{category:'asset-generation',inputType:'image'});
    if(!capability){const error=new Error('当前没有可用的 Image → 3D 能力');error.code='GENERATION_ROUTE_UNAVAILABLE';throw error;}
    const targetId=String(assetId||`generated_${Date.now().toString(36)}`).trim();
    const job=await this.generation.submitGenerationJob({
      provider:capability.provider,
      operation:capability.operation,
      inputs:buildInputs(capability,{sourceArtifact:{id:source.id,role:source.role,mime:source.mime,hash:source.hash}}),
      profile:preferredProfile(capability),
      outputRoles:requiredOutputRoles(capability),
      parent:imageResult.jobId?{jobId:imageResult.jobId}:null,
      metadata:{purpose:'studio-build-image-to-asset',assetId:targetId}
    });
    onProgress(job);
    const completed=job.status==='provider-succeeded'?job:await this.#wait(job.jobId,{onProgress});
    const produced=await this.generation.generateAndCompileAsset({jobId:completed.jobId,assetId:targetId,label:imageResult.prompt||targetId});
    if(!['asset-ready','asset-provisional'].includes(produced.status)){
      const error=new Error(`生成资产未通过准入：${produced.status}`);
      error.code='ASSET_NOT_READY';
      throw error;
    }
    return {kind:'asset',status:produced.status,assetId:targetId,asset:produced,prompt:imageResult.prompt||'',sourceArtifactId:source.id};
  }

  async generateWorld({prompt,onProgress=()=>{}}={}) {
    const text=String(prompt||'').trim();
    if(!text) throw new Error('请输入 World prompt');
    onProgress({phase:'reference'});
    const result=await this.generation.generateTextWorldArtifacts({prompt:text});
    const manifest=result.artifacts?.['world-manifest'];
    if(!manifest?.artifact?.id){const error=new Error('World 生成结果缺少 world-manifest');error.code='WORLD_MANIFEST_MISSING';throw error;}
    return {
      kind:'world',status:result.status,prompt:text,
      manifestArtifactId:manifest.artifact.id,
      artifacts:Object.fromEntries(Object.entries(result.artifacts||{}).map(([role,value])=>[role,value.artifact?.id||null])),
      route:result.route,jobs:result.jobs
    };
  }

  async placeAsset(assetId) {
    if(!assetId) throw new Error('缺少可放置的 Asset ID');
    if(!this.placement?.placeAtCenter) throw new Error('当前 Studio 没有配置资产放置控制器');
    return this.placement.placeAtCenter(assetId);
  }

  async openWorld(manifestArtifactId) {
    if(!manifestArtifactId) throw new Error('缺少 World Manifest Artifact');
    if(!this.openGeneratedWorld) throw new Error('当前 Studio 不支持打开生成世界');
    return this.openGeneratedWorld(manifestArtifactId);
  }
}
