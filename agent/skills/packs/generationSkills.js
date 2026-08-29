import { sanitizeJobData } from '../../../generation/jobs/GenerationJobProjection.js';
import { meta, string } from '../skillPrimitives.js';

export function registerGenerationSkills(add,runtime) {
  const requireGeneration=()=>{
    if (!runtime.generation) {
      const error=new Error("Generation orchestration is unavailable");
      error.code="CONNECTION_REQUIRED";
      throw error;
    }
    return runtime.generation;
  };
  const validateGenerationPayload=(a,requireTarget=false)=>{
    if (requireTarget && !a.jobId && !(a.provider && a.operation)) return {ok:false,message:"jobId or provider+operation required"};
    try {
      for (const key of ["inputs","options","parent","retention","metadata"]) {
        if (a[key]!=null) sanitizeJobData(a[key],key);
      }
      return {ok:true};
    } catch { return {ok:false,message:"Generation request contains forbidden secret-like fields"}; }
  };
  add("listGenerationProviders", meta("列出可用于异步生成的 Provider；只返回安全的规范化能力摘要。", ["generation.read"], [], { availableOnly:{type:"boolean"} }), (a)=>requireGeneration().listGenerationProviders(a));
  add("listGenerationCapabilities", meta("列出规范化生成能力；不会暴露 Provider 私有 API、凭据或签名 URL。", ["generation.read"], [], { provider:string, category:string, availableOnly:{type:"boolean"} }), (a)=>requireGeneration().listGenerationCapabilities(a));
  add("submitGenerationJob", { ...meta("提交可能计费的异步生成 Job；立即返回本地 jobId/pending 状态，不等待 Provider 完成。", ["generation.submit"], ["provider","operation"], { provider:string, operation:string, inputs:{type:"object"}, profile:string, options:{type:"object"}, outputRoles:{type:"array",items:string}, parent:{type:"object"}, retention:{type:"object"}, metadata:{type:"object"}, idempotencyKey:string, requestHash:string }), batchable:false, validate:(a)=>validateGenerationPayload(a) }, (a)=>requireGeneration().submitGenerationJob(a));
  add("getGenerationJob", meta("读取并恢复异步生成 Job；provider-succeeded 只表示结果可导入，不等于 asset-ready。", ["generation.read"], ["jobId"], { jobId:string, cachedOnly:{type:"boolean"} }), (a)=>requireGeneration().getGenerationJob(a.jobId,{cachedOnly:a.cachedOnly===true}));
  add("cancelGenerationJob", { ...meta("请求取消外部生成 Job；不会回滚 Scene，也不会删除已经导入的 Artifact。", ["generation.cancel"], ["jobId"], { jobId:string }), batchable:false }, (a)=>requireGeneration().cancelGenerationJob(a.jobId));
  add("importGenerationResult", { ...meta("把 provider-succeeded Job 的 Artifact 经 hash/MIME/bytes 校验导入本地；artifact-imported 仍不等于 asset-ready。", ["generation.read","artifact.import"], ["jobId"], { jobId:string, artifactId:string, role:string }), batchable:false }, (a)=>requireGeneration().importGenerationResult(a.jobId,{artifactId:a.artifactId,role:a.role}));
  add("generateAndCompileAsset", { ...meta("异步生成资产的高层编排：可提交或恢复 Job；pending 时立即返回，结果可用后才导入 Artifact、Compiler 编译并经过 Admission。", ["generation.read","generation.submit","artifact.import","asset.write"], ["assetId"], { assetId:string, label:string, jobId:string, provider:string, operation:string, inputs:{type:"object"}, profile:string, options:{type:"object"}, outputRoles:{type:"array",items:string}, artifactId:string, artifactRole:string, idempotencyKey:string, requestHash:string }), batchable:false, validate:(a)=>validateGenerationPayload(a,true) }, (a)=>requireGeneration().generateAndCompileAsset(a));
}
