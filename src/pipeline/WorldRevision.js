import { assertFindingRevision, normalizeFinding } from '../validation/Finding.js';
import { normalizeWorldIR } from './WorldIR.js';

export const WORLD_REVISION_CONTEXT_SCHEMA='agentscape.world-revision-context';
export const WORLD_REVISION_PROPOSAL_SCHEMA='agentscape.world-revision-proposal';
export const WORLD_REVISION_VERSION=1;

const clean=v=>typeof v==='string'?v.trim():'';
const finiteVec3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)?v.map(Number):null;

const text={type:'string',minLength:1};
const scalar={anyOf:[{type:'string'},{type:'number'},{type:'boolean'},{type:'null'}]};
const strict=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const assetSchema=strict({assetId:text,query:text,prompt:text,type:text,generate:{type:'boolean'},provider:text});
assetSchema.anyOf=[{required:['assetId']},{required:['query']},{required:['prompt']},{required:['type']}];
const physicsRequirementSchema=strict({
  bodyClass:{type:'string',enum:['rigid','articulated','character','soft','cloth']},
  requiredCapabilities:{type:'array',items:text,uniqueItems:true},
  executionMode:{type:'string',enum:['realtime','validation-only']},
  qualityPolicy:strict({deterministicRequired:{type:'boolean'},realtimeRequired:{type:'boolean'},fallbackPolicy:{type:'string',enum:['deny']}})
});
export const WORLD_REVISION_EDIT_TOOL_SCHEMA={oneOf:[
  strict({kind:{type:'string',enum:['set-position']},entityId:text,position:{type:'array',items:{type:'number'},minItems:3,maxItems:3}},['kind','entityId','position']),
  strict({kind:{type:'string',enum:['set-generation']},entityId:text,generate:{type:'boolean'}},['kind','entityId','generate']),
  strict({kind:{type:'string',enum:['replace-asset']},entityId:text,asset:assetSchema},['kind','entityId','asset']),
  strict({kind:{type:'string',enum:['set-initial-state']},entityId:text,state:{type:'object',additionalProperties:scalar}},['kind','entityId','state']),
  strict({kind:{type:'string',enum:['set-capability-intent']},entityId:text,capabilities:{type:'array',items:text,uniqueItems:true}},['kind','entityId','capabilities']),
  strict({kind:{type:'string',enum:['set-physics-requirement']},entityId:text,requirement:{anyOf:[physicsRequirementSchema,{type:'null'}]}},['kind','entityId','requirement'])
]};
export const WORLD_REVISION_REQUEST_TOOL_SCHEMA=strict({reason:{type:'string'},edits:{type:'array',items:WORLD_REVISION_EDIT_TOOL_SCHEMA,minItems:1}},['edits']);
export const WORLD_REVISION_PROPOSAL_TOOL_SCHEMA=strict({
  schema:{type:'string',enum:[WORLD_REVISION_PROPOSAL_SCHEMA]},schemaVersion:{type:'integer',enum:[WORLD_REVISION_VERSION]},
  status:{type:'string',enum:['changed-plan-required']},baseRevisionId:text,nextRevisionId:text,
  findingIds:{type:'array',items:text,uniqueItems:true},affectedEntityIds:{type:'array',items:text,uniqueItems:true},
  reason:text,edits:{type:'array',items:WORLD_REVISION_EDIT_TOOL_SCHEMA,minItems:1}
},['schema','schemaVersion','status','baseRevisionId','nextRevisionId','findingIds','affectedEntityIds','reason','edits']);

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


const normalizeEditedEntity=(context,entityId,mutate)=>{
  const source=context.subgraph?.entities?.find((entity)=>entity.id===entityId);
  if(!source){const error=new Error(`World revision context entity missing: ${entityId}`);error.code='WORLD_REVISION_CONTEXT_ENTITY_MISSING';throw error;}
  const candidate=structuredClone(source);
  mutate(candidate);
  return normalizeWorldIR({
    schema:'agentscape.world-ir',schemaVersion:1,
    revision:{id:context.baseRevisionId},provenance:{source:'world-revision-normalization'},intent:{name:'World Revision'},
    entities:[candidate],spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[]
  }).entities[0];
};

export function createWorldRevisionProposal(context,{nextRevisionId,reason='bounded finding repair',edits=[]}={}){
  if(context?.schema!==WORLD_REVISION_CONTEXT_SCHEMA||context.schemaVersion!==WORLD_REVISION_VERSION) throw new TypeError('Unsupported WorldRevision context');
  const nextId=clean(nextRevisionId);
  if(!nextId||nextId===context.baseRevisionId) throw new TypeError('World revision proposal requires a new nextRevisionId');
  if(!Array.isArray(edits)) throw new TypeError('World revision edits must be an array');
  if(!edits.length) throw new TypeError('World revision proposal requires at least one edit');
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
    if(kind==='replace-asset'){
      if(!edit.asset||typeof edit.asset!=='object'||Array.isArray(edit.asset)) throw new TypeError(`World revision edit[${index}] requires asset object`);
      const entity=normalizeEditedEntity(context,entityId,(candidate)=>{candidate.asset=structuredClone(edit.asset);});
      return {kind,entityId,asset:structuredClone(entity.asset)};
    }
    if(kind==='set-initial-state'){
      if(!edit.state||typeof edit.state!=='object'||Array.isArray(edit.state)) throw new TypeError(`World revision edit[${index}] requires state object`);
      const entity=normalizeEditedEntity(context,entityId,(candidate)=>{candidate.initialState=structuredClone(edit.state);});
      return {kind,entityId,state:structuredClone(entity.initialState)};
    }
    if(kind==='set-capability-intent'){
      if(!Array.isArray(edit.capabilities)) throw new TypeError(`World revision edit[${index}] requires capabilities array`);
      const entity=normalizeEditedEntity(context,entityId,(candidate)=>{candidate.capabilityIntent=structuredClone(edit.capabilities);});
      return {kind,entityId,capabilities:[...entity.capabilityIntent]};
    }
    if(kind==='set-physics-requirement'){
      if(edit.requirement!==null&&(!edit.requirement||typeof edit.requirement!=='object'||Array.isArray(edit.requirement))) throw new TypeError(`World revision edit[${index}] requires requirement object or null`);
      const entity=normalizeEditedEntity(context,entityId,(candidate)=>{
        if(edit.requirement===null) delete candidate.physicsRequirement;
        else candidate.physicsRequirement=structuredClone(edit.requirement);
      });
      return {kind,entityId,requirement:entity.physicsRequirement?structuredClone(entity.physicsRequirement):null};
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


const REVISION_EDIT_DOMAINS={
  'set-initial-state':['state','acceptance'],
  'set-position':['transform','layout','spatial','physics','navigation','acceptance'],
  'set-generation':['asset','generation','layout','behavior','physics','acceptance'],
  'replace-asset':['asset','generation','layout','behavior','physics','spatial','navigation','acceptance'],
  'set-capability-intent':['behavior','acceptance'],
  'set-physics-requirement':['physics','acceptance']
};

export function classifyWorldRevisionImpact(proposal={}){
  const edits=Array.isArray(proposal.edits)?proposal.edits:[];
  const editKinds=[...new Set(edits.map((edit)=>clean(edit.kind)).filter(Boolean))];
  const affectedEntityIds=[...new Set(edits.map((edit)=>clean(edit.entityId)).filter(Boolean))];
  const domains=[...new Set(editKinds.flatMap((kind)=>REVISION_EDIT_DOMAINS[kind]||['unknown']))];
  const stateOnly=edits.length>0 && domains.every((domain)=>['state','acceptance'].includes(domain));
  const behaviorOnly=edits.length>0 && domains.every((domain)=>['behavior','acceptance'].includes(domain));
  return {mode:stateOnly?'incremental-state':behaviorOnly?'incremental-behavior':'full',editKinds,affectedEntityIds,domains};
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
    if(edit.kind==='replace-asset'){
      if(JSON.stringify(entity.asset)!==JSON.stringify(edit.asset)){ entity.asset=structuredClone(edit.asset); changed=true; }
      continue;
    }
    if(edit.kind==='set-initial-state'){
      if(JSON.stringify(entity.initialState)!==JSON.stringify(edit.state)){ entity.initialState=structuredClone(edit.state); changed=true; }
      continue;
    }
    if(edit.kind==='set-capability-intent'){
      if(JSON.stringify(entity.capabilityIntent)!==JSON.stringify(edit.capabilities)){ entity.capabilityIntent=[...edit.capabilities]; changed=true; }
      continue;
    }
    if(edit.kind==='set-physics-requirement'){
      const current=entity.physicsRequirement||null;
      if(JSON.stringify(current)!==JSON.stringify(edit.requirement)){
        if(edit.requirement===null) delete entity.physicsRequirement;
        else entity.physicsRequirement=structuredClone(edit.requirement);
        changed=true;
      }
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
