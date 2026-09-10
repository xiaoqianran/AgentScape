import { PROMPT_HYBRID_WORLD_REQUEST_SCHEMA, PromptHybridWorldOrchestrator } from '../../generation/PromptHybridWorldOrchestrator.js';
import { meta, string } from '../skillPrimitives.js';

export function registerGenerationSkills(add,runtime,{promptHybridWorldOrchestrator = new PromptHybridWorldOrchestrator(runtime)} = {}) {
  const requireGeneration=()=>{
    if (!runtime.generation) {
      const error=new Error("Generation orchestration is unavailable");
      error.code="CONNECTION_REQUIRED";
      throw error;
    }
    return runtime.generation;
  };
  const isAssetGenerationRequest = (request={}) => {
    const operation=String(request.operation || '').trim();
    if (!operation) return false;
    const capabilities=runtime.generation?.listGenerationCapabilities?.({availableOnly:false})?.capabilities || [];
    const capability=capabilities.find((item)=>item.operation===operation);
    return String(capability?.category || '').includes('asset-generation') || /\.asset\./i.test(operation);
  };
  const requireApprovedAssetInput = (request={}) => {
    if (runtime.generation?.assetInputPolicy !== 'approved-image' || !isAssetGenerationRequest(request)) return;
    throw Object.assign(
      new Error('请先在图片资产工作台确认物体并生成入库；Agent 使用已发布资产。'),
      {code:'IMAGE_INPUT_REQUIRED'}
    );
  };
  const validateGenerationPayload=(a,requireTarget=false)=>{
    const generation=runtime.generation;
    return generation?.validateRequestPayload
      ? generation.validateRequestPayload(a,{requireTarget})
      : {ok:true};
  };
  add("listGenerationProviders", meta("列出可用于异步生成的 Provider；只返回安全的规范化能力摘要。", ["generation.read"], [], { availableOnly:{type:"boolean"} }), (a)=>requireGeneration().listGenerationProviders(a));
  add("listGenerationCapabilities", meta("列出规范化生成能力；不会暴露 Provider 私有 API、凭据或签名 URL。", ["generation.read"], [], { provider:string, category:string, availableOnly:{type:"boolean"} }), (a)=>requireGeneration().listGenerationCapabilities(a));
  add("submitGenerationJob", { ...meta("提交可能计费的异步生成 Job；立即返回本地 jobId/pending 状态，不等待 Provider 完成。", ["generation.submit"], ["provider","operation"], { provider:string, operation:string, inputs:{type:"object"}, profile:string, options:{type:"object"}, outputRoles:{type:"array",items:string}, parent:{type:"object"}, retention:{type:"object"}, metadata:{type:"object"}, idempotencyKey:string, requestHash:string }), batchable:false, validate:(a)=>validateGenerationPayload(a) }, (a)=>{ requireApprovedAssetInput(a); return requireGeneration().submitGenerationJob(a); });
  add("getGenerationJob", meta("读取并恢复异步生成 Job；provider-succeeded 只表示结果可导入，不等于 asset-ready。", ["generation.read"], ["jobId"], { jobId:string, cachedOnly:{type:"boolean"} }), (a)=>requireGeneration().getGenerationJob(a.jobId,{cachedOnly:a.cachedOnly===true}));
  add("cancelGenerationJob", { ...meta("请求取消外部生成 Job；不会回滚 Scene，也不会删除已经导入的 Artifact。", ["generation.cancel"], ["jobId"], { jobId:string }), batchable:false }, (a)=>requireGeneration().cancelGenerationJob(a.jobId));
  add("importGenerationResult", { ...meta("把 provider-succeeded Job 的 Artifact 经 hash/MIME/bytes 校验导入本地；artifact-imported 仍不等于 asset-ready。", ["generation.read","artifact.import"], ["jobId"], { jobId:string, artifactId:string, role:string }), batchable:false }, (a)=>requireGeneration().importGenerationResult(a.jobId,{artifactId:a.artifactId,role:a.role}));
  add("generateAndCompileAsset", { ...meta("异步生成资产的高层编排：可提交或恢复 Job；pending 时立即返回，结果可用后才导入 Artifact、Compiler 编译并经过 Admission。", ["generation.read","generation.submit","artifact.import","asset.write"], ["assetId"], { assetId:string, label:string, jobId:string, provider:string, operation:string, inputs:{type:"object"}, profile:string, options:{type:"object"}, outputRoles:{type:"array",items:string}, artifactId:string, artifactRole:string, idempotencyKey:string, requestHash:string }), batchable:false, validate:(a)=>validateGenerationPayload(a,true) }, (a)=>{ if (!a.jobId && runtime.generation?.assetInputPolicy === 'approved-image') throw Object.assign(new Error('请先在图片资产工作台确认物体并生成入库；Agent 只能恢复已有资产任务或使用已发布资产。'),{code:'IMAGE_INPUT_REQUIRED'}); return requireGeneration().generateAndCompileAsset(a); });
  add('buildGeneratedHybridWorld', {
    ...meta('产品级 Generated Hybrid World 入口：用 environmentPrompt 经现有 Connector capability 自动走文生图→图生世界并导入 verified artifacts，再把 proposal 封装成 Runtime-owned WorldIR，在生成背景的 observation anchor 上通过 canonical WorldBuilder 组合 executable assets。模型不能提供 revision/provenance、Job 成功状态、Artifact bytes/hash 或 spawn 结果；整个世界替换失败会恢复调用前 Environment 与 Scene。', ['generation.read','generation.submit','artifact.import','world.write','asset.read','asset.write','physics.read'], ['request'], {request:PROMPT_HYBRID_WORLD_REQUEST_SCHEMA}),
    batchable:false,mutates:true,history:false,manualMutation:true
  }, (a)=>promptHybridWorldOrchestrator.run(a.request));
}
