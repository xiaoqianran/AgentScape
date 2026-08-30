import { WORLD_IR_TOOL_SCHEMA, WORLD_PLANNER_PROPOSAL_SCHEMA } from '../../../world/spec/WorldIRToolSchema.js';
import { buildWorldProposal } from '../../../world/spec/WorldPlannerProposal.js';
import { buildWorldRetryPlan } from '../../../world/compiler/WorldRetry.js';
import { recompileWorldRevision } from '../../../world/compiler/WorldRecompiler.js';
import { createWorldRevisionProposal, WORLD_REVISION_PROPOSAL_TOOL_SCHEMA, WORLD_REVISION_REQUEST_TOOL_SCHEMA } from '../../../world/spec/WorldRevision.js';
import { meta } from '../skillPrimitives.js';

const newWorldRevisionId=()=>{
  const id=globalThis.crypto?.randomUUID?.();
  if(!id){const error=new Error('Secure revision identity is unavailable');error.code='WORLD_PROPOSAL_ID_UNAVAILABLE';throw error;}
  return `world-${id}`;
};

const materializeRetryAssets=async(runtime,retry)=>{
  if(retry?.status!=='retry-proposed') return {status:'not-requested',plan:retry?.nextIR || null,assets:[]};
  if(typeof runtime.generation?.generateAsset!=='function') {
    return {status:'generation-failed',reason:'GENERATOR_UNAVAILABLE',plan:null,assets:[]};
  }
  const plan=structuredClone(retry.nextIR);
  const generated=[];
  for(const action of retry.actions || []) {
    if(action.kind!=='enable-generation') continue;
    const entity=plan.entities.find((item)=>(action.instanceId && item.id===action.instanceId) || (!action.instanceId && item.asset?.query===action.query));
    if(!entity){
      return {status:'generation-failed',reason:'RETRY_ENTITY_NOT_FOUND',plan:null,assets:generated,action:structuredClone(action)};
    }
    const asset=entity.asset || {};
    const prompt=asset.prompt || asset.query || asset.type || action.query || '';
    let produced;
    try {
      produced=await runtime.generation.generateAsset(prompt,{
        ...(entity.id ? {instanceId:entity.id} : {}),
        ...(asset.provider ? {provider:asset.provider} : {})
      });
    } catch(error) {
      return {
        status:'generation-failed',reason:error?.code || 'GENERATION_FAILED',plan:null,assets:generated,
        error:{code:error?.code || 'GENERATION_FAILED',message:error?.message || String(error)}
      };
    }
    const assetId=produced?.id || null;
    if(!assetId || runtime.assets?.has?.(assetId)!==true) {
      return {
        status:'generation-failed',reason:produced?.status || 'GENERATED_ASSET_NOT_PUBLISHED',plan:null,assets:generated,
        result:produced ? structuredClone(produced) : null
      };
    }
    entity.asset={...asset,assetId};
    generated.push({instanceId:entity.id || null,assetId,status:produced.status || 'generated'});
  }
  return {status:'generated',plan,assets:generated};
};

export function registerWorldSkills(add,runtime) {
  add('proposeWorldRevision', meta('针对最近一次 world-rejected 的 Runtime-issued revision context 提交 bounded typed edits。Runtime 决定 base/next revision、Finding scope 和 affectedEntityIds；本工具只生成 proposal，不修改 Scene。成功后必须 fresh-replan，再把返回 proposal 原样提交 recompileWorldRevision。', [], ['request'], { request:WORLD_REVISION_REQUEST_TOOL_SCHEMA }), (a,{context}) => {
    const repair=context?.worldRevisionRepair;
    if(!repair?.revisionContext){const error=new Error('No Runtime-issued world revision context is available');error.code='WORLD_REVISION_CONTEXT_REQUIRED';throw error;}
    const request=a.request || {};
    return {
      status:'world-revision-proposal-ready',
      proposal:createWorldRevisionProposal(repair.revisionContext,{
        nextRevisionId:newWorldRevisionId(),reason:request.reason,edits:request.edits
      })
    };
  });

  add('recompileWorldRevision', { ...meta('执行本次 Agent run 内由 proposeWorldRevision 刚刚颁发的 bounded proposal。base World IR 由 Runtime 隐藏持有，模型不能提供或替换；acceptChangedPlan=true 后才进入 canonical recompile + fresh verification，失败自动恢复原 scene。', ['world.write','asset.read','asset.write','physics.read'], ['proposal','acceptChangedPlan'], { proposal:WORLD_REVISION_PROPOSAL_TOOL_SCHEMA, acceptChangedPlan:{type:'boolean'} }), batchable:false, mutates:true }, async (a,{context}) => {
    const baseWorldIR=context?.worldRevisionBaseIR;
    if(!baseWorldIR){const error=new Error('No Runtime-issued base World IR is available');error.code='WORLD_REVISION_BASE_REQUIRED';throw error;}
    return recompileWorldRevision(runtime,{baseWorldIR,proposal:a.proposal,acceptChangedPlan:a.acceptChangedPlan===true});
  });


  add('proposeWorldIR', meta('把 Planner 的世界语义提案封装为 Runtime-issued revision/provenance，并执行 strict normalize/reference/canonical compile 预检；不修改 Scene。只有 status=world-proposal-ready 的 worldIR 才应提交 runWorldPipeline。模型不能自行指定 revision/provenance/parent lineage。', [], ['proposal'], { proposal:WORLD_PLANNER_PROPOSAL_SCHEMA }), (a,{context}) => {
    const lineage=context?.worldProposalLineage || {};
    return buildWorldProposal(a.proposal,{
      revisionId:newWorldRevisionId(),
      parentRevisionId:lineage.parentRevisionId,
      reason:lineage.reason,
      evidenceRefs:lineage.evidenceRefs
    });
  });

  add('runWorldPipeline', { ...meta('提交 strict World IR v1 到 canonical compiler：替换当前 world，而不是在旧 Scene 上追加；先暂停旧规则并清空旧 Scene，再统一解析资产、Behavior、Physics、Acceptance、实例化与验证。Agent 只执行 proposeWorldIR 已颁发的 revision/provenance；不支持的语义 fail-closed。若唯一 rejection 是可生成的 search miss，Runtime 最多自动重跑一次，只为缺失 asset 开启 generation。world-ready 才视为 verified；world-provisional 不冒充验证；world-rejected 精确恢复调用前 Scene 与 committed authority。', ['world.write', 'asset.read', 'asset.write', 'physics.read'], ['plan'], { plan: WORLD_IR_TOOL_SCHEMA }), mutates: true }, async (a) => {
    const before=runtime.snapshot();
    const authorityBefore=runtime.captureWorldAuthority?.() || null;
    const restoreBefore=async()=>{
      await runtime.restore(before);
      if(authorityBefore) runtime.restoreWorldAuthority?.(authorityBefore);
      else runtime.loadRuleGraph?.(runtime.currentBehaviorBundle?.ruleGraph || []);
    };
    const prepareCandidate=async()=>{
      runtime.loadRuleGraph?.([]);
      await runtime.clearObjects({silent:true});
    };
    const budget=2,attempts=[];
    let plan=a.plan;
    for (let attempt=1;attempt<=budget;attempt++) {
      await prepareCandidate();
      const pipeline=await runtime.worldPipeline.run(plan);
      const admission=pipeline.state?.reports?.worldAdmission;
      if (!admission) {
        await restoreBefore();
        const error=new Error('Canonical world pipeline produced no world admission');
        error.code='WORLD_PIPELINE_ADMISSION_MISSING';
        throw error;
      }
      const record={attempt,admission:structuredClone(admission)};
      attempts.push(record);
      if (admission.status!=='rejected') {
        return {status:`world-${admission.status}`,admission,pipeline,attempts,retry:attempts.length>1?attempts.at(-2).retry:null};
      }
      await restoreBefore();
      const retry=buildWorldRetryPlan(pipeline,{
        generatorConfigured:runtime.generation?.canGenerateAsset?.()===true,
        attempt,budget
      });
      record.retry=retry;
      if (retry.status!=='retry-proposed') {
        return {status:'world-rejected',reason:admission.reasons?.[0] || 'WORLD_REJECTED',rolledBack:true,admission,pipeline,attempts,retry};
      }
      const generation=await materializeRetryAssets(runtime,retry);
      record.generation=generation.status==='generated'
        ? {status:generation.status,assets:structuredClone(generation.assets)}
        : {status:generation.status,reason:generation.reason,...(generation.error?{error:generation.error}:{})};
      if(generation.status!=='generated') {
        const failedRetry={...retry,status:'generation-failed',retriable:false,generation:record.generation};
        record.retry=failedRetry;
        return {status:'world-rejected',reason:generation.reason || 'GENERATION_FAILED',rolledBack:true,admission,pipeline,attempts,retry:failedRetry};
      }
      plan=generation.plan;
    }
    throw new Error('World retry loop exceeded its fixed budget');
  });
}
