import { assertFindingRevision, normalizeFinding } from '../validation/Finding.js';
import { normalizeWorldIR } from './WorldIR.js';

export const WORLD_REVISION_CONTEXT_SCHEMA='agentscape.world-revision-context';
export const WORLD_REVISION_PROPOSAL_SCHEMA='agentscape.world-revision-proposal';
export const WORLD_REVISION_VERSION=1;

const clean=v=>typeof v==='string'?v.trim():'';
const finiteVec3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)?v.map(Number):null;

export function buildWorldRevisionContext(worldIR,findings=[]){
  const ir=normalizeWorldIR(worldIR);
  const normalized=(findings||[]).map((finding,index)=>normalizeFinding(finding,{index}));
  const baseRevisionId=ir.revision.id;
  assertFindingRevision(normalized,baseRevisionId);

  const seedEntityIds=new Set(normalized.flatMap((finding)=>finding.affectedObjects||[]).filter(Boolean));
  const contextEntityIds=new Set(seedEntityIds);
  for(const relation of ir.spatial.relations){
    if(seedEntityIds.has(relation.subject)||seedEntityIds.has(relation.object)){
      contextEntityIds.add(relation.subject); contextEntityIds.add(relation.object);
    }
  }
  for(const constraint of ir.spatial.constraints){
    if(seedEntityIds.has(constraint.subject)||seedEntityIds.has(constraint.object)){
      if(constraint.subject) contextEntityIds.add(constraint.subject);
      if(constraint.object) contextEntityIds.add(constraint.object);
    }
  }
  const knownEntityIds=new Set(ir.entities.map((entity)=>entity.id).filter(Boolean));
  const editableEntityIds=[...seedEntityIds].filter((id)=>knownEntityIds.has(id));
  const missingEntityIds=[...seedEntityIds].filter((id)=>!knownEntityIds.has(id));
  return {
    schema:WORLD_REVISION_CONTEXT_SCHEMA,schemaVersion:WORLD_REVISION_VERSION,
    baseRevisionId,
    findingIds:normalized.map((finding)=>finding.id),
    findings:structuredClone(normalized),
    affected:{
      seedEntityIds:[...seedEntityIds],
      contextEntityIds:[...contextEntityIds],
      editableEntityIds,
      missingEntityIds
    },
    subgraph:{
      entities:ir.entities.filter((entity)=>entity.id&&contextEntityIds.has(entity.id)).map((entity)=>structuredClone(entity)),
      spatial:{
        relations:ir.spatial.relations.filter((relation)=>contextEntityIds.has(relation.subject)||contextEntityIds.has(relation.object)).map((relation)=>structuredClone(relation)),
        constraints:ir.spatial.constraints.filter((constraint)=>contextEntityIds.has(constraint.subject)||contextEntityIds.has(constraint.object)).map((constraint)=>structuredClone(constraint))
      },
      interactions:ir.interactions.filter((item)=>[item.actorId,item.targetId,item.supportId].some((id)=>id&&contextEntityIds.has(id))).map((item)=>structuredClone(item)),
      acceptance:ir.acceptance.filter((item)=>[item.targetId,item.subject,item.object].some((id)=>id&&contextEntityIds.has(id))).map((item)=>structuredClone(item))
    },
    rulesReviewRequired:Boolean(ir.rules.length&&contextEntityIds.size)
  };
}

export function createWorldRevisionProposal(context,{nextRevisionId,reason='bounded finding repair',edits=[]}={}){
  if(context?.schema!==WORLD_REVISION_CONTEXT_SCHEMA||context.schemaVersion!==WORLD_REVISION_VERSION) throw new TypeError('Unsupported WorldRevision context');
  const nextId=clean(nextRevisionId);
  if(!nextId||nextId===context.baseRevisionId) throw new TypeError('World revision proposal requires a new nextRevisionId');
  if(!Array.isArray(edits)) throw new TypeError('World revision edits must be an array');
  const editable=new Set(context.affected?.editableEntityIds||[]);
  const seen=new Set();
  const normalized=edits.map((edit,index)=>{
    if(!edit||typeof edit!=='object'||Array.isArray(edit)) throw new TypeError(`World revision edit[${index}] must be an object`);
    const kind=clean(edit.kind),entityId=clean(edit.entityId);
    if(!entityId||!editable.has(entityId)){
      const error=new Error(`World revision edit outside affected subgraph: ${entityId||'$missing'}`);
      error.code='WORLD_REVISION_SCOPE_VIOLATION'; throw error;
    }
    const key=`${kind}:${entityId}`; if(seen.has(key)) throw new TypeError(`Duplicate world revision edit: ${key}`); seen.add(key);
    if(kind==='set-position'){
      const position=finiteVec3(edit.position); if(!position) throw new TypeError(`World revision edit[${index}] requires finite position[3]`);
      return {kind,entityId,position};
    }
    if(kind==='set-generation'){
      if(typeof edit.generate!=='boolean') throw new TypeError(`World revision edit[${index}] requires boolean generate`);
      return {kind,entityId,generate:edit.generate};
    }
    const error=new TypeError(`Unsupported world revision edit kind: ${kind}`); error.code='WORLD_REVISION_EDIT_UNSUPPORTED'; throw error;
  });
  return {
    schema:WORLD_REVISION_PROPOSAL_SCHEMA,schemaVersion:WORLD_REVISION_VERSION,
    status:'changed-plan-required',baseRevisionId:context.baseRevisionId,nextRevisionId:nextId,
    findingIds:[...(context.findingIds||[])],affectedEntityIds:[...(context.affected?.editableEntityIds||[])],
    reason:clean(reason)||'bounded finding repair',edits:normalized
  };
}

export function applyWorldRevisionProposal(worldIR,proposal,{acceptChangedPlan=false}={}){
  const ir=normalizeWorldIR(worldIR);
  if(proposal?.schema!==WORLD_REVISION_PROPOSAL_SCHEMA||proposal.schemaVersion!==WORLD_REVISION_VERSION) throw new TypeError('Unsupported WorldRevision proposal');
  if(proposal.baseRevisionId!==ir.revision.id){ const error=new Error(`World revision base mismatch: ${proposal.baseRevisionId} != ${ir.revision.id}`); error.code='WORLD_REVISION_BASE_MISMATCH'; throw error; }
  if(acceptChangedPlan!==true){ const error=new Error('World revision proposal requires explicit changed-plan acceptance'); error.code='WORLD_REVISION_CHANGE_NOT_ACCEPTED'; throw error; }
  const allowed=new Set(proposal.affectedEntityIds||[]);
  const next=structuredClone(ir);
  let changed=false;
  for(const edit of proposal.edits||[]){
    if(!allowed.has(edit.entityId)){ const error=new Error(`World revision edit outside accepted scope: ${edit.entityId}`); error.code='WORLD_REVISION_SCOPE_VIOLATION'; throw error; }
    const entity=next.entities.find((item)=>item.id===edit.entityId);
    if(!entity){ const error=new Error(`World revision entity missing: ${edit.entityId}`); error.code='WORLD_REVISION_ENTITY_MISSING'; throw error; }
    if(edit.kind==='set-position'){
      if(JSON.stringify(entity.transform?.position||null)!==JSON.stringify(edit.position)){ entity.transform||={}; entity.transform.position=[...edit.position]; changed=true; }
      continue;
    }
    if(edit.kind==='set-generation'){
      if(entity.asset.generate!==edit.generate){ entity.asset.generate=edit.generate; changed=true; }
      continue;
    }
    const error=new TypeError(`Unsupported world revision edit kind: ${edit.kind}`); error.code='WORLD_REVISION_EDIT_UNSUPPORTED'; throw error;
  }
  if(!changed){ const error=new Error('World revision proposal does not change the plan'); error.code='WORLD_REVISION_NO_CHANGE'; throw error; }
  next.revision={id:proposal.nextRevisionId,parentId:ir.revision.id,reason:proposal.reason};
  next.provenance={
    ...next.provenance,
    source:'finding-revision',
    sourceId:proposal.findingIds?.[0] || ir.revision.id,
    evidenceRefs:[...new Set([...(next.provenance.evidenceRefs||[]),...(proposal.findingIds||[])])]
  };
  return normalizeWorldIR(next);
}
