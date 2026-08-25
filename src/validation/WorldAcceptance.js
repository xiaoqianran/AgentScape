import { compileAcceptanceFindings } from './Finding.js';

const SCHEMA='agentscape.world-acceptance';
const VERSION=1;
const scalar=v=>v===null||typeof v==='string'||typeof v==='number'||typeof v==='boolean';
const clean=v=>typeof v==='string'?v.trim():'';

export function compileWorldAcceptance(criteria=[]){
  if(!Array.isArray(criteria)) throw new TypeError('Acceptance criteria must be an array');
  const ids=new Set();
  const checks=criteria.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item)) throw new TypeError(`Acceptance[${index}] must be an object`);
    const id=clean(item.id),kind=clean(item.kind||'world-valid');
    if(!id||ids.has(id)) throw new TypeError(`Acceptance[${index}] requires unique id`); ids.add(id);
    if(!['world-valid','object-exists','state-equals','interaction-verified','no-unresolved'].includes(kind)) throw new TypeError(`Acceptance[${index}] unsupported kind: ${kind}`);
    const check={id,kind};
    if(['object-exists','state-equals','interaction-verified'].includes(kind)) check.targetId=clean(item.targetId);
    if(kind==='state-equals'){ check.stateKey=clean(item.stateKey); check.value=item.value; if(!check.targetId||!check.stateKey||!Object.prototype.hasOwnProperty.call(item,'value')||!scalar(item.value)) throw new TypeError(`Acceptance[${index}] state-equals requires targetId/stateKey/scalar value`); }
    if(kind==='interaction-verified'){ check.capability=clean(item.capability).toUpperCase(); if(!check.targetId||!check.capability) throw new TypeError(`Acceptance[${index}] interaction-verified requires targetId/capability`); }
    if(kind==='object-exists'&&!check.targetId) throw new TypeError(`Acceptance[${index}] object-exists requires targetId`);
    if(clean(item.description)) check.description=clean(item.description);
    return check;
  });
  return {schema:SCHEMA,schemaVersion:VERSION,checks};
}

export function evaluateWorldAcceptance(runtime,graph,{unresolvedMutations=undefined}={}){
  if(graph?.schema!==SCHEMA||graph.schemaVersion!==VERSION) throw new TypeError('Unsupported WorldAcceptance graph');
  const evidence=graph.checks.map(check=>{
    if(check.kind==='world-valid'){
      const validation=runtime?.validator?.run?.();
      return validation?.ok===true ? {id:check.id,kind:check.kind,verified:true,evidence:{validation:structuredClone(validation)}} : {id:check.id,kind:check.kind,verified:false,reason:'WORLD_VALIDATION_FAILED',evidence:validation?structuredClone(validation):null};
    }
    if(check.kind==='object-exists'){
      const exists=Boolean(runtime?.store?.get?.(check.targetId));
      return {id:check.id,kind:check.kind,verified:exists,targetId:check.targetId,...(!exists?{reason:'OBJECT_NOT_FOUND'}:{})};
    }
    if(check.kind==='state-equals'){
      const value=runtime?.store?.get?.(check.targetId)?.state?.[check.stateKey];
      return {id:check.id,kind:check.kind,verified:Object.is(value,check.value),targetId:check.targetId,stateKey:check.stateKey,expected:check.value,actual:value,...(!Object.is(value,check.value)?{reason:'STATE_MISMATCH'}:{})};
    }
    if(check.kind==='interaction-verified'){
      const observed=runtime?.store?.get?.(check.targetId)?.state?.lastVerifiedAction;
      const verified=String(observed||'').toUpperCase()===check.capability;
      return {id:check.id,kind:check.kind,verified,targetId:check.targetId,expected:check.capability,actual:observed,...(!verified?{reason:'INTERACTION_NOT_VERIFIED'}:{})};
    }
    if (!Array.isArray(unresolvedMutations)) return {id:check.id,kind:check.kind,verified:false,reason:'EVIDENCE_MISSING'};
    const verified=unresolvedMutations.length===0;
    return {id:check.id,kind:check.kind,verified,...(!verified?{reason:'UNRESOLVED_MUTATIONS',unresolvedCount:unresolvedMutations.length}:{})};
  });
  const failed=evidence.filter(x=>!x.verified);
  return {schema:SCHEMA,schemaVersion:VERSION,status:failed.length?'world-incomplete':'world-accepted',checks:evidence,verifiedCount:evidence.length-failed.length,failedCount:failed.length};
}

export {SCHEMA as WORLD_ACCEPTANCE_SCHEMA,VERSION as WORLD_ACCEPTANCE_VERSION};


export function buildAcceptanceEvidenceBundle(graph,result,{worldRevisionId=null,source='runtime',provenance=null}={}){
  if(graph?.schema!==SCHEMA||graph.schemaVersion!==VERSION) throw new TypeError('Unsupported WorldAcceptance graph');
  if(!result||typeof result!=='object') throw new TypeError('WorldAcceptance result is required');
  return {
    schema:'agentscape.acceptance-evidence',schemaVersion:1,required:true,
    source,
    ...(worldRevisionId?{worldRevisionId}:{}),
    ...(provenance?{provenance:structuredClone(provenance)}:{}),
    criteria:structuredClone(graph.checks),
    result:structuredClone(result),
    findings:compileAcceptanceFindings(result,{worldRevisionId})
  };
}
