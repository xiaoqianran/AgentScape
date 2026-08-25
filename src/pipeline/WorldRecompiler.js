import { applyWorldRevisionProposal } from './WorldRevision.js';

export async function recompileWorldRevision(runtime,{baseWorldIR,proposal,acceptChangedPlan=false}={}){
  if(!runtime?.worldPipeline?.run) throw new Error('Canonical world pipeline unavailable');
  if(typeof runtime.snapshot!=='function'||typeof runtime.restore!=='function'||typeof runtime.clearObjects!=='function') throw new Error('Runtime revision recompile lifecycle unavailable');

  // The changed-plan gate and proposal scope are checked before any Runtime mutation.
  const nextIR=applyWorldRevisionProposal(baseWorldIR,proposal,{acceptChangedPlan});
  const before=runtime.snapshot();
  const previousBehaviorBundle=runtime.currentBehaviorBundle ? structuredClone(runtime.currentBehaviorBundle) : null;
  const restoreBehavior=()=>{ runtime.currentBehaviorBundle=previousBehaviorBundle ? structuredClone(previousBehaviorBundle) : null; runtime.loadRuleGraph?.(previousBehaviorBundle?.ruleGraph || []); };
  const baseRevisionId=nextIR.revision.parentId;
  const revisionId=nextIR.revision.id;
  try {
    runtime.currentBehaviorBundle=null;
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
      restoreBehavior();
      return {
        status:'world-rejected',reason:admission.reasons?.[0]||'WORLD_REJECTED',rolledBack:true,
        baseRevisionId,revisionId,worldIR:structuredClone(nextIR),admission:structuredClone(admission),pipeline,
        recompile:{canonical:true,freshVerification:true,committed:false}
      };
    }
    return {
      status:`world-${admission.status}`,rolledBack:false,
      baseRevisionId,revisionId,worldIR:structuredClone(nextIR),admission:structuredClone(admission),pipeline,
      recompile:{canonical:true,freshVerification:true,committed:true}
    };
  } catch(error){
    try { await runtime.restore(before); restoreBehavior(); }
    catch(rollbackError){
      const failure=new Error(`World revision recompile failed and rollback failed: ${error.message}; rollback: ${rollbackError.message}`,{cause:error});
      failure.code='WORLD_RECOMPILE_ROLLBACK_FAILED'; failure.rollbackError=rollbackError; throw failure;
    }
    throw error;
  }
}
