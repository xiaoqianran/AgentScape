import { applyWorldRevisionProposal, buildWorldRevisionContext, classifyWorldRevisionImpact } from './WorldRevision.js';
import { compileWorldIR } from './WorldCompilation.js';
import { buildAcceptanceEvidenceBundle, evaluateWorldAcceptance } from '../validation/WorldAcceptance.js';
import { admitWorldBehavior } from './WorldBehaviorCompiler.js';
import { admitWorldPhysics } from './WorldPhysicsAdmission.js';
import { preflightWorldPosition } from './WorldComposer.js';

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

const commitAuthority=(runtime,nextIR,compilation,pipeline)=>{
  runtime.currentWorldRevision={revision:clone(nextIR.revision),provenance:clone(nextIR.provenance)};
  runtime.restoredAcceptanceEvidence=null;
  runtime.lastAcceptanceBundle=clone(pipeline?.state?.artifacts?.acceptanceEvidence) || null;
  runtime.currentBehaviorBundle=clone(compilation.behaviorBundle);
  runtime.currentPhysicsRequirements=clone(compilation.physicsRequirements);
  runtime.loadRuleGraph?.(compilation.behaviorBundle.ruleGraph);
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

const vec3Equal=(a,b,tolerance=1e-6)=>Array.isArray(a)&&Array.isArray(b)&&a.length===3&&b.length===3&&a.every((value,index)=>Math.abs(value-b[index])<=tolerance);

const canIncrementPosition=(runtime,baseWorldIR,nextIR,impact)=>{
  if(impact.mode!=='incremental-position' || impact.affectedEntityIds.length!==1) return false;
  if(runtime.currentWorldRevision?.revision?.id!==baseWorldIR.revision?.id) return false;
  if(!runtime.store?.get || !runtime.assets?.getManifest || !runtime.physics?.manifestPoseClear || !runtime.physics?.setPosition || !runtime.validator?.run) return false;
  const id=impact.affectedEntityIds[0];
  if(nextIR.spatial.relations.some((relation)=>relation.subject===id || relation.object===id)) return false;
  const baseEntity=baseWorldIR.entities.find((entity)=>entity.id===id);
  if(!baseEntity?.asset?.assetId) return false;
  let record;
  try { record=runtime.store.get(id); } catch { return false; }
  if(!record || record.assetId!==baseEntity.asset.assetId || record.state?.heldBy) return false;
  let manifest;
  try { manifest=runtime.assets.getManifest(record.assetId); } catch { return false; }
  if(!(manifest.actions||[]).includes('move')) return false;
  const currentPosition=record.object?.position?.toArray?.();
  if(!Array.isArray(currentPosition)) return false;
  if(baseEntity.transform?.position && !vec3Equal(currentPosition,baseEntity.transform.position)) return false;
  return Boolean(currentResolvedAssets(runtime,nextIR));
};

const occupiedWorldPositions=(runtime,worldIR,excludeId)=>{
  const occupied=[];
  for(const entity of worldIR.entities){
    if(!entity.id || entity.id===excludeId) continue;
    let record,manifest;
    try { record=runtime.store.get(entity.id); manifest=runtime.assets.getManifest(record.assetId); } catch { return null; }
    const position=record.object?.position?.toArray?.();
    if(!Array.isArray(position) || position.length!==3 || !position.every(Number.isFinite)) return null;
    occupied.push({id:entity.id,manifest,position});
  }
  return occupied;
};

const applyCandidatePosition=(runtime,id,position)=>{
  const record=runtime.store.get(id);
  record.object.position.fromArray(position);
  runtime.physics.setPosition(id,position);
  runtime.navigation?.invalidateIfStatic?.(record,'world.revision.position');
  runtime.sceneGraph?.changed?.();
  runtime.sceneGraph?.update?.();
};

const worldAdmission=(validation,acceptance,{behaviorAdmission=null,physicsAdmission=null,layoutAdmission=null}={})=>{
  const hard=validation?.counts?.hard || 0;
  const advisory=validation?.counts?.advisory || 0;
  const behaviorRejected=behaviorAdmission?.status==='rejected';
  const physicsRejected=physicsAdmission?.status==='rejected';
  const layoutRejected=layoutAdmission?.status==='rejected';
  const layoutProvisional=layoutAdmission?.status==='provisional';
  const acceptanceRejected=acceptance?.status==='world-incomplete';
  return {
    status:behaviorRejected||physicsRejected||layoutRejected||hard||acceptanceRejected?'rejected':layoutProvisional||advisory?'provisional':'ready',
    reasons:[
      ...(behaviorRejected?[behaviorAdmission.reason || behaviorAdmission.issues?.[0]?.code || 'BEHAVIOR_REJECTED']:[]),
      ...(physicsRejected?[physicsAdmission.reason || physicsAdmission.issues?.[0]?.code || 'PHYSICS_REJECTED']:[]),
      ...(layoutRejected?[layoutAdmission.reason || 'LAYOUT_REJECTED']:[]),
      ...(layoutProvisional?[layoutAdmission.reason || 'LAYOUT_PROVISIONAL']:[]),
      ...(hard?[`VALIDATION_HARD:${hard}`]:[]),
      ...(advisory?[`VALIDATION_ADVISORY:${advisory}`]:[]),
      ...(acceptanceRejected?['WORLD_ACCEPTANCE_FAILED']:[])
    ],
    validation:{hard,advisory},
    ...(behaviorAdmission?{behavior:clone(behaviorAdmission)}:{}),
    ...(physicsAdmission?{physics:clone(physicsAdmission)}:{}),
    ...(layoutAdmission?{layout:clone(layoutAdmission)}:{}),
    ...(acceptance?{acceptance:clone(acceptance)}:{})
  };
};

const verifyIncrementalRevision=(runtime,{compilation,nextIR,revisionId,source,behaviorAdmission=null,physicsAdmission=null,layoutAdmission=null,timelineName,started})=>{
  const validation=runtime.validator.run({worldRevisionId:revisionId});
  const acceptance=compilation.acceptanceGraph
    ? evaluateWorldAcceptance(runtime,compilation.acceptanceGraph,{unresolvedMutations:undefined,worldRevisionId:revisionId,validationEvidence:validation})
    : null;
  const acceptanceEvidence=acceptance
    ? buildAcceptanceEvidenceBundle(compilation.acceptanceGraph,acceptance,{worldRevisionId:revisionId,source,provenance:nextIR.provenance})
    : null;
  if(acceptanceEvidence) runtime.trace?.emit?.('world.acceptance',{bundle:clone(acceptanceEvidence)},{actor:'world-recompiler'});

  const admission=worldAdmission(validation,acceptance,{behaviorAdmission,physicsAdmission,layoutAdmission});
  const artifacts={worldIR:clone(nextIR),compilation:clone(compilation),...(acceptanceEvidence?{acceptanceEvidence:clone(acceptanceEvidence)}:{})};
  const revisionFindings=[
    ...(validation?.findings || []).filter((finding)=>finding.severity==='hard'),
    ...(acceptanceEvidence?.findings || [])
  ];
  if(admission.status==='rejected' && revisionFindings.length) artifacts.revisionContext=buildWorldRevisionContext(nextIR,revisionFindings);
  return {
    admission,
    pipeline:{
      state:{artifacts,reports:{validation,...(behaviorAdmission?{behaviorAdmission:clone(behaviorAdmission)}:{}),...(physicsAdmission?{physicsAdmission:clone(physicsAdmission)}:{}),...(layoutAdmission?{layoutAdmission:clone(layoutAdmission)}:{}),worldAdmission:clone(admission),...(acceptance?{worldAcceptance:clone(acceptance)}:{})}},
      timeline:[{name:timelineName,elapsedMs:Math.round(performance.now()-started)}]
    }
  };
};

async function recompileInitialState(runtime,{nextIR,compilation,before,previous,baseRevisionId,revisionId,impact}){
  const started=performance.now();
  try{
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
    commitAuthority(runtime,nextIR,compilation,pipeline);
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


async function recompileAuthorityOnly(runtime,{nextIR,compilation,baseRevisionId,revisionId,impact}){
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
    const {admission,pipeline}=verifyIncrementalRevision(runtime,{
      compilation,nextIR,revisionId,source:`world-${impact.mode}-recompile`,...admissionContext,
      timelineName:`incremental_${label}_revision`,started
    });
    if(admission.status==='rejected'){
      return {
        status:'world-rejected',reason:admission.reasons[0]||'WORLD_REJECTED',rolledBack:false,
        baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),pipeline,
        recompile:{canonical:true,mode:impact.mode,freshVerification:true,committed:false,affectedEntityIds:[...impact.affectedEntityIds]}
      };
    }
    commitAuthority(runtime,nextIR,compilation,pipeline);
    return {
      status:`world-${admission.status}`,rolledBack:false,
      baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),pipeline,
      recompile:{canonical:true,mode:impact.mode,freshVerification:true,committed:true,affectedEntityIds:[...impact.affectedEntityIds]}
    };
  }catch(error){
    throw error;
  }
}


async function recompilePosition(runtime,{nextIR,compilation,before,previous,baseRevisionId,revisionId,impact}){
  const started=performance.now();
  const id=impact.affectedEntityIds[0];
  const entity=nextIR.entities.find((item)=>item.id===id);
  let record,manifest;
  try { record=runtime.store.get(id); manifest=runtime.assets.getManifest(record.assetId); }
  catch { return null; }
  const occupied=occupiedWorldPositions(runtime,nextIR,id);
  if(!occupied) return null;
  const position=entity?.transform?.position;
  const preflight=preflightWorldPosition(manifest,position,{
    layout:runtime.environment?.layout,occupied,
    poseClear:(candidateManifest,candidatePosition)=>runtime.physics.manifestPoseClear(candidateManifest,candidatePosition,{excludeIds:[id]})
  });
  const layoutAdmission={
    status:preflight.clear?(preflight.status || 'ready'):'rejected',
    ...(preflight.clear&&preflight.status==='provisional'?{reason:'ARTICULATED_LAYOUT_ROOT_ONLY'}:{}),
    ...(!preflight.clear?{reason:preflight.reason || 'WORLD_POSE_BLOCKED'}:{}),
    placements:preflight.clear?[{id,assetId:record.assetId,position:[...position],mode:'revision-explicit',coverage:preflight.coverage}]:[],
    issues:preflight.clear?[]:[{id,assetId:record.assetId,reason:preflight.reason || 'WORLD_POSE_BLOCKED',blockedBy:preflight.blockedBy || []}]
  };
  if(layoutAdmission.status==='rejected'){
    const admission=worldAdmission(null,null,{layoutAdmission});
    return {
      status:'world-rejected',reason:admission.reasons[0]||'LAYOUT_REJECTED',rolledBack:false,
      baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),
      pipeline:{
        state:{artifacts:{worldIR:clone(nextIR),compilation:clone(compilation)},reports:{layoutAdmission:clone(layoutAdmission),worldAdmission:clone(admission)}},
        timeline:[{name:'incremental_position_admission',elapsedMs:Math.round(performance.now()-started)}]
      },
      recompile:{canonical:true,mode:'incremental-position',freshVerification:false,committed:false,affectedEntityIds:[id]}
    };
  }

  try{
    applyCandidatePosition(runtime,id,position);

    const {admission,pipeline}=verifyIncrementalRevision(runtime,{
      compilation,nextIR,revisionId,source:'world-incremental-position-recompile',layoutAdmission,
      timelineName:'incremental_position_revision',started
    });
    if(admission.status==='rejected'){
      await runtime.restore(before);
      restoreAuthority(runtime,previous);
      return {
        status:'world-rejected',reason:admission.reasons[0]||'WORLD_REJECTED',rolledBack:true,
        baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),pipeline,
        recompile:{canonical:true,mode:'incremental-position',freshVerification:true,committed:false,affectedEntityIds:[id]}
      };
    }
    commitAuthority(runtime,nextIR,compilation,pipeline);
    return {
      status:`world-${admission.status}`,rolledBack:false,
      baseRevisionId,revisionId,worldIR:clone(nextIR),admission:clone(admission),pipeline,
      recompile:{canonical:true,mode:'incremental-position',freshVerification:true,committed:true,affectedEntityIds:[id]}
    };
  }catch(error){
    try { await runtime.restore(before); restoreAuthority(runtime,previous); }
    catch(rollbackError){
      const failure=new Error(`World revision incremental position failed and rollback failed: ${error.message}; rollback: ${rollbackError.message}`,{cause:error});
      failure.code='WORLD_RECOMPILE_ROLLBACK_FAILED'; failure.rollbackError=rollbackError; throw failure;
    }
    throw error;
  }
}

async function recompileFull(runtime,{nextIR,before,previous,baseRevisionId,revisionId}){
  try{
    runtime.loadRuleGraph?.([]);
    await runtime.clearObjects({silent:true});
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
    const result=await recompileAuthorityOnly(runtime,{nextIR,compilation,baseRevisionId,revisionId,impact});
    if(result) return result;
  }
  if(canIncrementPosition(runtime,baseWorldIR,nextIR,impact)){
    const result=await recompilePosition(runtime,{nextIR,compilation,before,previous,baseRevisionId,revisionId,impact});
    if(result) return result;
  }
  return recompileFull(runtime,{nextIR,before,previous,baseRevisionId,revisionId});
}
