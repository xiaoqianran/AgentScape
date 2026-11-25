export const INTERACTION_EVIDENCE_SCHEMA='agentscape.interaction-evidence';
export const INTERACTION_EVIDENCE_VERSION=1;

const clean=(value)=>typeof value==='string'?value.trim():'';
const clone=(value)=>structuredClone(value);
const key=(revisionId,targetId,capability,source,partName=null)=>[revisionId,targetId,capability,source,...(partName?[partName]:[])].join('\u0000');
const store=(runtime)=>runtime.interactionEvidence ||= new Map();

const summarizeResult=(result)=>{
  if(!result||typeof result!=='object') return null;
  const summary={};
  for(const field of ['status','action','targetId','actorId','supportId','heldId','stateKey','evidenceKind','partName']){
    const value=clean(result[field]);
    if(value) summary[field]=value;
  }
  for(const field of ['targetReached','settled','supportVerified','heldRequired','physicsVerified']){
    if(typeof result[field]==='boolean') summary[field]=result[field];
  }
  for(const field of ['coordinate','target'])if(Number.isFinite(result[field]))summary[field]=result[field];
  if(Object.prototype.hasOwnProperty.call(result,'value') && (result.value===null||['string','number','boolean'].includes(typeof result.value))) summary.value=result.value;
  return Object.keys(summary).length?summary:null;
};

export function clearInteractionEvidence(runtime){
  runtime?.interactionEvidence?.clear?.();
}

export function clearInteractionEvidenceForTarget(runtime,targetId,{source=null,capability=null,partName=null}={}){
  const target=clean(targetId);
  if(!target||!runtime?.interactionEvidence?.size) return;
  for(const [entryKey,evidence] of runtime.interactionEvidence){
    if((evidence?.targetId===target||evidence?.result?.heldId===target)&&(!source||evidence.source===source)&&
      (!capability||evidence.capability===capability.toUpperCase())&&(!partName||evidence.partName===partName))runtime.interactionEvidence.delete(entryKey);
  }
}

export function recordInteractionEvidence(runtime,{targetId,capability,verified,source='runtime',commandId=null,result=null,partName=null}={}){
  if(verified!==true) return null;
  // Code Project and ad-hoc worlds have no World IR revision. Use a transient,
  // runtime-local evidence scope; it is not exported and cannot validate a reopened world.
  const worldRevisionId=clean(runtime?.currentWorldRevision?.revision?.id)
    || (runtime.interactionEvidenceScope ||= 'session:' + crypto.randomUUID());
  const target=clean(targetId),normalizedCapability=clean(capability).toUpperCase();
  if(!worldRevisionId||!target||!normalizedCapability) return null;
  const resultSummary=summarizeResult(result);
  const evidence={
    schema:INTERACTION_EVIDENCE_SCHEMA,schemaVersion:INTERACTION_EVIDENCE_VERSION,
    worldRevisionId,targetId:target,capability:normalizedCapability,verified:true,source,
    ...(partName?{partName}:{}),
    ...(clean(commandId)?{commandId:clean(commandId)}:{}),
    ...(resultSummary?{result:resultSummary}:{})
  };
  const evidenceKey=key(worldRevisionId,target,normalizedCapability,source,partName);
  store(runtime).delete(evidenceKey);store(runtime).set(evidenceKey,evidence);
  runtime.trace?.emit?.('interaction.verified',{evidence:clone(evidence)},{actor:'runtime'});
  return clone(evidence);
}

export function getInteractionEvidence(runtime,targetId,capability,{worldRevisionId=null,source=null,partName=null}={}){
  const revisionId=clean(worldRevisionId)||clean(runtime?.currentWorldRevision?.revision?.id)
    || runtime?.interactionEvidenceScope;
  const target=clean(targetId),normalizedCapability=clean(capability).toUpperCase();
  if(!revisionId||!target||!normalizedCapability) return null;
  if(source&&partName) {
    const evidence=runtime?.interactionEvidence?.get?.(key(revisionId,target,normalizedCapability,source,partName));
    return evidence?.verified===true ? clone(evidence) : null;
  }
  // Legacy unscoped lookup remains supported when no provider is requested.
  const matches=[...(runtime?.interactionEvidence?.values?.() || [])].filter(item=>
    item?.verified===true && item.worldRevisionId===revisionId
    && item.targetId===target && item.capability===normalizedCapability&&(!source||item.source===source)&&(!partName||item.partName===partName));
  return matches.length ? clone(matches[matches.length - 1]) : null;
}
