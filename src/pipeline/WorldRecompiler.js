import { applyWorldRevisionProposal, buildWorldRevisionContext, classifyWorldRevisionImpact } from './WorldRevision.js';
import { compileWorldIR } from './WorldCompilation.js';
import { buildAcceptanceEvidenceBundle, evaluateWorldAcceptance } from '../validation/WorldAcceptance.js';
import { admitWorldBehavior } from './WorldBehaviorCompiler.js';
import { admitWorldPhysics } from './WorldPhysicsAdmission.js';

const clone=(value)=>value==null?value:structuredClone(value);
const scalarStateEqual=(left={},right={})=>{
  const a=Object.keys(left).sort(),b=Object.keys(right).sort();
  return a.length===b.length && a.every((key,index)=>key===b[index] && Object.is(left[key],right[key]));
};

const captureAuthority=(runtime)=>({
  revision:clone(runtime.currentWorldRevision),
  behavior:clone(runtime.currentBehaviorBundle),
  physics:clone(runtime.currentPhysicsRequirements),
  acceptance:clone(runtime.lastAcceptanceBundle),
  restoredAcceptance:clone(runtime.restoredAcceptanceEvidence)
});

const restoreAuthority=(runtime,previous)=>{
  runtime.currentWorldRevision=clone(previous.revision) || null;
  runtime.currentBehaviorBundle=clone(previous.behavior) || null;
  runtime.currentPhysicsRequirements=clone(previous.physics) || null;
  runtime.lastAcceptanceBundle=clone(previous.acceptance) || null;
  runtime.restoredAcceptanceEvidence=clone(previous.restoredAcceptance) || null;
  runtime.loadRuleGraph?.(previous.behavior?.ruleGraph || []);
};

const canIncrementState=(runtime,baseWorldIR,impact)=>{
  if(impact.mode!=='incremental-state') return false;
  if(runtime.currentWorldRevision?.revision?.id!==baseWorldIR.revision?.id) return false;
  if(!runtime.store?.get || !runtime.restoreObjectState || !runtime.validator?.run) return false;
  for(const id of impact.affectedEntityIds){
    const entity=baseWorldIR.entities.find((item)=>item.id===id);
    if(!entity?.asset?.assetId) return false;
    let record;
    try { record=runtime.store.get(id); } catch { return false; }
    if(!record || record.assetId!==entity.asset.assetId) return false;
    if(!scalarStateEqual(record.state || {},entity.initialState || {})) return false;
  }
  return true;
};

const currentResolvedAssets=(runtime,worldIR)=>{
  if(!runtime.store?.get || !runtime.assets?.getManifest) return null;
  const resolved=[];
  for(const entity of worldIR.entities){
    if(!entity.id) continue;
    let record;
    try { record=runtime.store.get(entity.id); } catch { return null; }
    if(!record?.assetId) return null;
    if(entity.asset?.assetId && entity.asset.assetId!==record.assetId) return null;
    try { runtime.assets.getManifest(record.assetId); } catch { return null; }
    resolved.push({id:entity.id,assetId:record.assetId});
  }
  return resolved;
};

const canIncrementAuthority=(runtime,baseWorldIR,nextIR,impact)=>{
  if(!['incremental-behavior','incremental-physics'].includes(impact.mode)) return false;
  if(runtime.currentWorldRevision?.revision?.id!==baseWorldIR.revision?.id) return false;
  if(!runtime.validator?.run) return false;
  if(impact.mode==='incremental-physics' && !runtime.physics?.backend) return false;
  return Boolean(currentResolvedAssets(runtime,nextIR));
};

const worldAdmission=(validation,acceptance,{behaviorAdmission=null,physicsAdmission=null}={})=>{
  const hard=validation?.counts?.hard || 0;
  const advisory=validation?.counts?.advisory || 0;
  const behaviorRejected=behaviorAdmission?.status==='rejected';
  const physicsRejected=physicsAdmission?.status==='rejected';
  const acceptanceRejected=acceptance?.status==='world-incomplete';
  return {
    status:behaviorRejected||physicsRejected||hard||acceptanceRejected?'rejected':advisory?'provisional':'ready',
    reasons:[
      ...(behaviorRejected?[behaviorAdmission.reason || behaviorAdmission.issues?.[0]?.code || 'BEHAVIOR_REJECTED']:[]),
      ...(physicsRejected?[physicsAdmission.reason || physicsAdmission.issues?.[0]?.code || 'PHYSICS_REJECTED']:[]),
      ...(hard?[`VALIDATION_HARD:${hard}`]:[]),
      ...(advisory?[`VALIDATION_ADVISORY:${advisory}`]:[]),
      ...(acceptanceRejected?['WORLD_ACCEPTANCE_FAILED']:[])
    ],
    validation:{hard,advisory},
    ...(behaviorAdmission?{behavior:clone(behaviorAdmission)}:{}),
    ...(physicsAdmission?{physics:clone(physicsAdmission)}:{}),
    ...(acceptance?{acceptance:clone(acceptance)}:{})
  };
};

const verifyIncrementalRevision=(runtime,{compilation,nextIR,revisionId,source,behaviorAdmission=null,physicsAdmission=null,timelineName,started})=>{
  const validation=runtime.validator.run();
  const acceptance=compilation.acceptanceGraph
    ? evaluateWorldAcceptance(runtime,compilation.acceptanceGraph,{unresolvedMutations:undefined})
    : null;
  const acceptanceEvidence=acceptance
    ? buildAcceptanceEvidenceBundle(compilation.acceptanceGraph,acceptance,{worldRevisionId:revisionId,source,provenance:nextIR.provenance})
    : null;
  runtime.lastAcceptanceBundle=acceptanceEvidence?clone(acceptanceEvidence):null;
  if(acceptanceEvidence) runtime.trace?.emit?.('world.acceptance',{bundle:clone(acceptanceEvidence)},{actor:'world-recompiler'});

  const admission=worldAdmission(validation,acceptance,{behaviorAdmission,physicsAdmission});
  const artifacts={worldIR:clone(nextIR),compilation:clone(compilation),...(acceptanceEvidence?{acceptanceEvidence:clone(acceptanceEvidence)}:{})};
  const revisionFindings=[
    ...(validation?.findings || []).filter((finding)=>finding.severity==='hard'),
    ...(acceptanceEvidence?.findings || [])
  ];
  if(admission.status==='rejected' && revisionFindings.length) artifacts.revisionContext=buildWorldRevisionContext(nextIR,revisionFindings);
  return {
    admission,
    pipeline:{
      state:{artifacts,reports:{validation,...(behaviorAdmission?{behaviorAdmission:clone(behaviorAdmission)}:{}),...(physicsAdmission?{physicsAdmission:clone(physicsAdmission)}:{}),worldAdmission:clone(admission),...(acceptance?{worldAcceptance:clone(acceptance)}:{})}},
      timeline:[{name:timelineName,elapsedMs:Math.round(performance.now()-started)}]
    }
  };
};

async function recompileInitialState(runtime,{nextIR,compilation,before,previous,baseRevisionId,revisionId,impact}){
  const started=performance.now();
  try{
    runtime.currentWorldRevision={revision:clone(nextIR.revision),provenance:clone(nextIR.provenance)};
    runtime.restoredAcceptanceEvidence=null;
    runtime.currentBehaviorBundle=clone(compilation.behaviorBundle);
    runtime.currentPhysicsRequirements=clone(compilation.physicsRequirements);
    runtime.loadRuleGraph?.(compilation.behaviorBundle.ruleGraph);

    for(const edit of impact.affectedEntityIds){
      const entity=nextIR.entities.find((item)=>item.id===edit);
      runtime.restoreObjectState(edit,entity.initialState || {});
    }
    runtime.sceneGraph?.changed?.();
    runtime.sceneGraph?.update?.();

    const {admission,pipeline}=verifyIncrementalRevision(runtime,{
      compilation,nextIR,revisionId,source:'world-incremental-state-recompile',timelineName:'incremental_state_revision',started
    });

    if(admission.status==='rejected'){
      await runtime.restore(before);
      restoreAuthority(runtime,previous);
      return {
        status:'world-rejected',reason:admission.reasons[0]||'WORLD_REJECTED',rolledBack:true,
        baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),pipeline,
        recompile:{canonical:true,mode:'incremental-state',freshVerification:true,committed:false,affectedEntityIds:[...impact.affectedEntityIds]}
      };
    }
    return {
      status:`world-${admission.status}`,rolledBack:false,
      baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),pipeline,
      recompile:{canonical:true,mode:'incremental-state',freshVerification:true,committed:true,affectedEntityIds:[...impact.affectedEntityIds]}
    };
  }catch(error){
    try { await runtime.restore(before); restoreAuthority(runtime,previous); }
    catch(rollbackError){
      const failure=new Error(`World revision incremental recompile failed and rollback failed: ${error.message}; rollback: ${rollbackError.message}`,{cause:error});
      failure.code='WORLD_RECOMPILE_ROLLBACK_FAILED'; failure.rollbackError=rollbackError; throw failure;
    }
    throw error;
  }
}


async function recompileAuthorityOnly(runtime,{nextIR,compilation,previous,baseRevisionId,revisionId,impact}){
  const started=performance.now();
  const resolvedAssets=currentResolvedAssets(runtime,nextIR);
  if(!resolvedAssets) return null;

  const isBehavior=impact.mode==='incremental-behavior';
  const reportKey=isBehavior?'behaviorAdmission':'physicsAdmission';
  const admissionResult=isBehavior
    ? admitWorldBehavior(compilation.behaviorBundle,{resolvedAssets,getManifest:(assetId)=>runtime.assets.getManifest(assetId)})
    : admitWorldPhysics(compilation.physicsRequirements,{backend:runtime.physics.backend,resolvedAssets,getManifest:(assetId)=>runtime.assets.getManifest(assetId)});
  const admissionContext=isBehavior?{behaviorAdmission:admissionResult}:{physicsAdmission:admissionResult};
  const label=isBehavior?'behavior':'physics';

  if(admissionResult.status==='rejected'){
    const admission=worldAdmission(null,null,admissionContext);
    return {
      status:'world-rejected',reason:admission.reasons[0]||`${label.toUpperCase()}_REJECTED`,rolledBack:false,
      baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),
      pipeline:{
        state:{artifacts:{worldIR:clone(nextIR),compilation:clone(compilation)},reports:{[reportKey]:clone(admissionResult),worldAdmission:clone(admission)}},
        timeline:[{name:`incremental_${label}_admission`,elapsedMs:Math.round(performance.now()-started)}]
      },
      recompile:{canonical:true,mode:impact.mode,freshVerification:false,committed:false,affectedEntityIds:[...impact.affectedEntityIds]}
    };
  }

  try{
    runtime.currentWorldRevision={revision:clone(nextIR.revision),provenance:clone(nextIR.provenance)};
    runtime.restoredAcceptanceEvidence=null;
    runtime.currentBehaviorBundle=clone(compilation.behaviorBundle);
    runtime.currentPhysicsRequirements=clone(compilation.physicsRequirements);
    runtime.loadRuleGraph?.(compilation.behaviorBundle.ruleGraph);

    const {admission,pipeline}=verifyIncrementalRevision(runtime,{
      compilation,nextIR,revisionId,source:`world-${impact.mode}-recompile`,...admissionContext,
      timelineName:`incremental_${label}_revision`,started
    });
    if(admission.status==='rejected'){
      restoreAuthority(runtime,previous);
      return {
        status:'world-rejected',reason:admission.reasons[0]||'WORLD_REJECTED',rolledBack:true,
        baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),pipeline,
        recompile:{canonical:true,mode:impact.mode,freshVerification:true,committed:false,affectedEntityIds:[...impact.affectedEntityIds]}
      };
    }
    return {
      status:`world-${admission.status}`,rolledBack:false,
      baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),pipeline,
      recompile:{canonical:true,mode:impact.mode,freshVerification:true,committed:true,affectedEntityIds:[...impact.affectedEntityIds]}
    };
  }catch(error){
    restoreAuthority(runtime,previous);
    throw error;
  }
}

async function recompileFull(runtime,{nextIR,before,previous,baseRevisionId,revisionId}){
  try{
    runtime.currentBehaviorBundle=null;
    runtime.currentPhysicsRequirements=null;
    runtime.loadRuleGraph?.([]);
    await runtime.clearObjects();
    const pipeline=await runtime.worldPipeline.run(nextIR);
    const admission=pipeline?.state?.reports?.worldAdmission;
    if(!admission){
      const error=new Error('Canonical recompile produced no world admission');
      error.code='WORLD_RECOMPILE_ADMISSION_MISSING';
      throw error;
    }
    if(admission.status==='rejected'){
      await runtime.restore(before);
      restoreAuthority(runtime,previous);
      return {
        status:'world-rejected',reason:admission.reasons?.[0]||'WORLD_REJECTED',rolledBack:true,
        baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),pipeline,
        recompile:{canonical:true,mode:'full',freshVerification:true,committed:false}
      };
    }
    return {
      status:`world-${admission.status}`,rolledBack:false,
      baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),pipeline,
      recompile:{canonical:true,mode:'full',freshVerification:true,committed:true}
    };
  }catch(error){
    try { await runtime.restore(before); restoreAuthority(runtime,previous); }
    catch(rollbackError){
      const failure=new Error(`World revision recompile failed and rollback failed: ${error.message}; rollback: ${rollbackError.message}`,{cause:error});
      failure.code='WORLD_RECOMPILE_ROLLBACK_FAILED'; failure.rollbackError=rollbackError; throw failure;
    }
    throw error;
  }
}

export async function recompileWorldRevision(runtime,{baseWorldIR,proposal,acceptChangedPlan=false}={}){
  if(!runtime?.worldPipeline?.run) throw new Error('Canonical world pipeline unavailable');
  if(typeof runtime.snapshot!=='function'||typeof runtime.restore!=='function'||typeof runtime.clearObjects!=='function') throw new Error('Runtime revision recompile lifecycle unavailable');

  // Scope/change acceptance and canonical IR validation happen before any Runtime mutation.
  const nextIR=applyWorldRevisionProposal(baseWorldIR,proposal,{acceptChangedPlan});
  const compilation=compileWorldIR(nextIR);
  const impact=classifyWorldRevisionImpact(proposal);
  const before=runtime.snapshot();
  const previous=captureAuthority(runtime);
  const baseRevisionId=nextIR.revision.parentId;
  const revisionId=nextIR.revision.id;

  if(canIncrementState(runtime,baseWorldIR,impact)){
    return recompileInitialState(runtime,{nextIR,compilation,before,previous,baseRevisionId,revisionId,impact});
  }
  if(canIncrementAuthority(runtime,baseWorldIR,nextIR,impact)){
    const result=await recompileAuthorityOnly(runtime,{nextIR,compilation,previous,baseRevisionId,revisionId,impact});
    if(result) return result;
  }
  return recompileFull(runtime,{nextIR,before,previous,baseRevisionId,revisionId});
}
