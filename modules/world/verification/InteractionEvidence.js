export const INTERACTION_EVIDENCE_SCHEMA='agentscape.interaction-evidence';
export const INTERACTION_EVIDENCE_VERSION=1;

const clean=(value)=>typeof value==='string'?value.trim():'';
const clone=(value)=>structuredClone(value);
const key=(revisionId,targetId,capability)=>`${revisionId}\u0000${targetId}\u0000${capability}`;
const store=(runtime)=>runtime.interactionEvidence ||= new Map();

const summarizeResult=(result)=>{
  if(!result||typeof result!=='object') return null;
  const summary={};
  for(const field of ['status','action','targetId','actorId','supportId','stateKey']){
    const value=clean(result[field]);
    if(value) summary[field]=value;
  }
  for(const field of ['targetReached','settled','supportVerified','heldRequired']){
    if(typeof result[field]==='boolean') summary[field]=result[field];
  }
  if(Object.prototype.hasOwnProperty.call(result,'value') && (result.value===null||['string','number','boolean'].includes(typeof result.value))) summary.value=result.value;
  return Object.keys(summary).length?summary:null;
};

export function clearInteractionEvidence(runtime){
  runtime?.interactionEvidence?.clear?.();
}

export function clearInteractionEvidenceForTarget(runtime,targetId){
  const target=clean(targetId);
  if(!target||!runtime?.interactionEvidence?.size) return;
  for(const [entryKey,evidence] of runtime.interactionEvidence){
    if(evidence?.targetId===target) runtime.interactionEvidence.delete(entryKey);
  }
}

export function recordInteractionEvidence(runtime,{targetId,capability,verified,source='runtime',commandId=null,result=null}={}){
  if(verified!==true) return null;
  const worldRevisionId=clean(runtime?.currentWorldRevision?.revision?.id);
  const target=clean(targetId),normalizedCapability=clean(capability).toUpperCase();
  if(!worldRevisionId||!target||!normalizedCapability) return null;
  const resultSummary=summarizeResult(result);
  const evidence={
    schema:INTERACTION_EVIDENCE_SCHEMA,schemaVersion:INTERACTION_EVIDENCE_VERSION,
    worldRevisionId,targetId:target,capability:normalizedCapability,verified:true,source,
    ...(clean(commandId)?{commandId:clean(commandId)}:{}),
    ...(resultSummary?{result:resultSummary}:{})
  };
  store(runtime).set(key(worldRevisionId,target,normalizedCapability),evidence);
  runtime.trace?.emit?.('interaction.verified',{evidence:clone(evidence)},{actor:'runtime'});
  return clone(evidence);
}

export function getInteractionEvidence(runtime,targetId,capability,{worldRevisionId=null}={}){
  const revisionId=clean(worldRevisionId)||clean(runtime?.currentWorldRevision?.revision?.id);
  const target=clean(targetId),normalizedCapability=clean(capability).toUpperCase();
  if(!revisionId||!target||!normalizedCapability) return null;
  const evidence=runtime?.interactionEvidence?.get?.(key(revisionId,target,normalizedCapability));
  return evidence?.verified===true ? clone(evidence) : null;
}
