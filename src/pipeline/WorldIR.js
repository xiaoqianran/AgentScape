import { normalizeWorldSpec } from './WorldSpec.js';

export const WORLD_IR_SCHEMA = 'agentscape.world-ir';
export const WORLD_IR_VERSION = 1;

const TOP_LEVEL_KEYS=new Set(['schema','schemaVersion','revision','provenance','intent','policy','entities','spatial','interactions','rules','acceptance']);
const REVISION_KEYS=new Set(['id','parentId','reason']);
const PROVENANCE_KEYS=new Set(['source','sourceId','createdBy','evidenceRefs']);
const INTENT_KEYS=new Set(['name','description','task']);
const POLICY_KEYS=new Set(['generation','physics']);
const GENERATION_KEYS=new Set(['provider','generate']);
const PHYSICS_POLICY_KEYS=new Set(['fallbackPolicy']);
const ENTITY_KEYS=new Set(['id','asset','transform','physicsRequirement','capabilityIntent','initialState']);
const ASSET_KEYS=new Set(['assetId','query','prompt','type','generate','provider']);
const TRANSFORM_KEYS=new Set(['position']);
const PHYSICS_REQUIREMENT_KEYS=new Set(['bodyClass','requiredCapabilities','executionMode','qualityPolicy']);
const PHYSICS_QUALITY_KEYS=new Set(['deterministicRequired','realtimeRequired','fallbackPolicy']);
const SPATIAL_KEYS=new Set(['relations','constraints']);
const RELATION_KEYS=new Set(['subject','predicate','object','surfaceId','distance']);
const CONSTRAINT_KEYS=new Set(['id','kind','subject','object','description']);
const INTERACTION_KEYS=new Set(['id','actorId','targetId','capability','description']);
const RULE_KEYS=new Set(['id','event','condition','effect','description']);
const ACCEPTANCE_KEYS=new Set(['id','kind','targetId','capability','stateKey','value','description']);

const clean=(value)=>typeof value==='string'?value.trim():'';
const plainObject=(value)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype);
const assertObject=(value,label)=>{if(!plainObject(value)) throw new TypeError(`${label} must be an object`); return value;};
const assertKnownKeys=(value,allowed,label)=>{for(const key of Object.keys(value||{})) if(!allowed.has(key)) throw new TypeError(`${label} unknown field: ${key}`);};
const finiteVec3=(value)=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite)?value.map(Number):null;
const uniqueStrings=(value,label,{upper=false}={})=>{if(value==null) return []; if(!Array.isArray(value)) throw new TypeError(`${label} must be an array`); const result=[]; for(const item of value){const text=clean(item); if(!text) throw new TypeError(`${label} requires non-empty strings`); const normalized=upper?text.toUpperCase():text; if(!result.includes(normalized)) result.push(normalized);} return result;};
const assertJsonValue=(value,label)=>{if(value===null||typeof value==='string'||typeof value==='boolean') return; if(typeof value==='number'){if(!Number.isFinite(value)) throw new TypeError(`${label} numbers must be finite`); return;} if(Array.isArray(value)){value.forEach((item,index)=>assertJsonValue(item,`${label}[${index}]`)); return;} if(plainObject(value)){for(const [key,item] of Object.entries(value)) assertJsonValue(item,`${label}.${key}`); return;} throw new TypeError(`${label} must be JSON-serializable`);};
const cloneJsonObject=(value,label)=>{if(value==null) return {}; assertObject(value,label); assertJsonValue(value,label); return structuredClone(value);};
const uniqueId=(set,id,label)=>{if(!id) throw new TypeError(`${label} requires id`); if(set.has(id)) throw new TypeError(`${label} duplicate id: ${id}`); set.add(id); return id;};

const normalizePhysicsRequirement=(value,label)=>{
  if(value==null) return null;
  assertObject(value,label); assertKnownKeys(value,PHYSICS_REQUIREMENT_KEYS,label);
  const bodyClass=clean(value.bodyClass).toLowerCase();
  if(bodyClass&&!['rigid','articulated','character','soft','cloth'].includes(bodyClass)) throw new TypeError(`${label} unsupported bodyClass: ${bodyClass}`);
  const executionMode=clean(value.executionMode).toLowerCase();
  if(executionMode&&!['realtime','validation-only'].includes(executionMode)) throw new TypeError(`${label} unsupported executionMode: ${executionMode}`);
  const requiredCapabilities=uniqueStrings(value.requiredCapabilities,`${label} requiredCapabilities`);
  let qualityPolicy={};
  if(value.qualityPolicy!=null){
    assertObject(value.qualityPolicy,`${label} qualityPolicy`); assertKnownKeys(value.qualityPolicy,PHYSICS_QUALITY_KEYS,`${label} qualityPolicy`);
    qualityPolicy={
      ...(value.qualityPolicy.deterministicRequired===true?{deterministicRequired:true}:{}),
      ...(value.qualityPolicy.realtimeRequired===true?{realtimeRequired:true}:{}),
      ...(clean(value.qualityPolicy.fallbackPolicy)?{fallbackPolicy:clean(value.qualityPolicy.fallbackPolicy)}:{})
    };
  }
  return {...(bodyClass?{bodyClass}:{}),...(requiredCapabilities.length?{requiredCapabilities}:{}),...(executionMode?{executionMode}:{}),...(Object.keys(qualityPolicy).length?{qualityPolicy}:{})};
};

const normalizeRelation=(relation,index)=>{
  assertObject(relation,`WorldIR spatial relation[${index}]`); assertKnownKeys(relation,RELATION_KEYS,`WorldIR spatial relation[${index}]`);
  const subject=clean(relation.subject),predicate=clean(relation.predicate).toUpperCase(),object=clean(relation.object);
  if(!subject||!predicate||!object) throw new TypeError(`WorldIR spatial relation[${index}] requires subject, predicate, object`);
  if(!['ON','NEAR'].includes(predicate)) throw new TypeError(`WorldIR spatial relation[${index}] unsupported predicate: ${predicate}`);
  const distance=relation.distance==null?null:Number(relation.distance);
  if(distance!=null&&(!Number.isFinite(distance)||distance<=0)) throw new TypeError(`WorldIR spatial relation[${index}] distance must be positive finite`);
  return {subject,predicate,object,...(clean(relation.surfaceId)?{surfaceId:clean(relation.surfaceId)}:{}),...(distance!=null?{distance}:{})};
};

const fromWorldSpec=(input)=>{
  const spec=normalizeWorldSpec(input);
  return {
    schema:WORLD_IR_SCHEMA,schemaVersion:WORLD_IR_VERSION,
    revision:{id:'legacy-root'},provenance:{source:'legacy-world-spec',evidenceRefs:[]},
    intent:{name:spec.name,description:spec.description},policy:{generation:structuredClone(spec.generation),physics:{}},
    entities:spec.assets.map((request)=>({
      ...(request.id?{id:request.id}:{}),asset:{...(request.assetId?{assetId:request.assetId}:{}),query:request.query,...(request.type?{type:request.type}:{}),...(request.prompt?{prompt:request.prompt}:{}),generate:request.generate===true,...(request.provider?{provider:request.provider}:{})},
      transform:{...(request.position?{position:[...request.position]}:{})},capabilityIntent:[],initialState:{}
    })),
    spatial:{relations:spec.relations.map((item)=>structuredClone(item)),constraints:[]},interactions:[],rules:[],acceptance:[]
  };
};

export function normalizeWorldIR(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new TypeError('WorldIR must be an object');
  if(input.schema!==WORLD_IR_SCHEMA){
    if(input.schema===1){ const legacy={...input}; delete legacy.schema; return fromWorldSpec(legacy); }
    return fromWorldSpec(input);
  }
  assertKnownKeys(input,TOP_LEVEL_KEYS,'WorldIR');
  if(input.schemaVersion!==WORLD_IR_VERSION) throw new TypeError(`Unsupported WorldIR version: ${input.schemaVersion}`);
  const revision=assertObject(input.revision||{},'WorldIR revision'); assertKnownKeys(revision,REVISION_KEYS,'WorldIR revision');
  const revisionId=clean(revision.id); if(!revisionId) throw new TypeError('WorldIR revision requires id');
  const parentId=clean(revision.parentId)||null; if(parentId===revisionId) throw new TypeError('WorldIR revision parentId must differ from id');
  const provenance=assertObject(input.provenance||{},'WorldIR provenance'); assertKnownKeys(provenance,PROVENANCE_KEYS,'WorldIR provenance');
  const source=clean(provenance.source); if(!source) throw new TypeError('WorldIR provenance requires source');
  const evidenceRefs=uniqueStrings(provenance.evidenceRefs,'WorldIR provenance evidenceRefs');
  const intent=assertObject(input.intent||{},'WorldIR intent'); assertKnownKeys(intent,INTENT_KEYS,'WorldIR intent');
  const name=clean(intent.name)||'Generated World',description=clean(intent.description),task=clean(intent.task)||null;
  const policy=assertObject(input.policy||{},'WorldIR policy'); assertKnownKeys(policy,POLICY_KEYS,'WorldIR policy');
  const generation=assertObject(policy.generation||{},'WorldIR policy generation'); assertKnownKeys(generation,GENERATION_KEYS,'WorldIR policy generation');
  const physicsPolicy=assertObject(policy.physics||{},'WorldIR policy physics'); assertKnownKeys(physicsPolicy,PHYSICS_POLICY_KEYS,'WorldIR policy physics');
  const defaultProvider=clean(generation.provider)||null,defaultGenerate=generation.generate===true;
  if(!Array.isArray(input.entities||[])) throw new TypeError('WorldIR entities must be an array');
  const entityIds=new Set();
  const entities=(input.entities||[]).map((entity,index)=>{
    const label=`WorldIR entity[${index}]`; assertObject(entity,label); assertKnownKeys(entity,ENTITY_KEYS,label);
    const id=clean(entity.id)||null; if(id){if(entityIds.has(id)) throw new TypeError(`WorldIR duplicate entity id: ${id}`); entityIds.add(id);}
    const asset=assertObject(entity.asset||{},`${label} asset`); assertKnownKeys(asset,ASSET_KEYS,`${label} asset`);
    const assetId=clean(asset.assetId)||null,type=clean(asset.type)||null,prompt=clean(asset.prompt)||null,query=clean(asset.query)||prompt||type||assetId;
    if(!query) throw new TypeError(`${label} asset requires assetId, query, prompt, or type`);
    const transform=assertObject(entity.transform||{},`${label} transform`); assertKnownKeys(transform,TRANSFORM_KEYS,`${label} transform`);
    const position=transform.position==null?null:finiteVec3(transform.position); if(transform.position!=null&&!position) throw new TypeError(`${label} transform position requires finite [3]`);
    const physicsRequirement=normalizePhysicsRequirement(entity.physicsRequirement,`${label} physicsRequirement`);
    const capabilityIntent=uniqueStrings(entity.capabilityIntent,`${label} capabilityIntent`,{upper:true});
    const initialState=cloneJsonObject(entity.initialState,`${label} initialState`);
    const provider=clean(asset.provider)||defaultProvider;
    return {...(id?{id}:{}),asset:{...(assetId?{assetId}:{}),query,...(type?{type}:{}),...(prompt?{prompt}:{}),generate:asset.generate==null?defaultGenerate:asset.generate===true,...(provider?{provider}:{})},transform:{...(position?{position}:{})},...(physicsRequirement&&Object.keys(physicsRequirement).length?{physicsRequirement}:{}),capabilityIntent,initialState};
  });
  const spatial=assertObject(input.spatial||{},'WorldIR spatial'); assertKnownKeys(spatial,SPATIAL_KEYS,'WorldIR spatial');
  if(!Array.isArray(spatial.relations||[])) throw new TypeError('WorldIR spatial relations must be an array'); if(!Array.isArray(spatial.constraints||[])) throw new TypeError('WorldIR spatial constraints must be an array');
  const relations=(spatial.relations||[]).map(normalizeRelation); const constraintIds=new Set();
  const constraints=(spatial.constraints||[]).map((constraint,index)=>{const label=`WorldIR spatial constraint[${index}]`; assertObject(constraint,label); assertKnownKeys(constraint,CONSTRAINT_KEYS,label); const id=uniqueId(constraintIds,clean(constraint.id),label),kind=clean(constraint.kind); if(!kind) throw new TypeError(`${label} requires kind`); return {id,kind,...(clean(constraint.subject)?{subject:clean(constraint.subject)}:{}),...(clean(constraint.object)?{object:clean(constraint.object)}:{}),...(clean(constraint.description)?{description:clean(constraint.description)}:{})};});
  const interactionIds=new Set(); if(!Array.isArray(input.interactions||[])) throw new TypeError('WorldIR interactions must be an array');
  const interactions=(input.interactions||[]).map((item,index)=>{const label=`WorldIR interaction[${index}]`; assertObject(item,label); assertKnownKeys(item,INTERACTION_KEYS,label); const id=uniqueId(interactionIds,clean(item.id),label),targetId=clean(item.targetId),capability=clean(item.capability).toUpperCase(); if(!targetId||!capability) throw new TypeError(`${label} requires targetId and capability`); return {id,...(clean(item.actorId)?{actorId:clean(item.actorId)}:{}),targetId,capability,...(clean(item.description)?{description:clean(item.description)}:{})};});
  const ruleIds=new Set(); if(!Array.isArray(input.rules||[])) throw new TypeError('WorldIR rules must be an array');
  const rules=(input.rules||[]).map((item,index)=>{const label=`WorldIR rule[${index}]`; assertObject(item,label); assertKnownKeys(item,RULE_KEYS,label); const id=uniqueId(ruleIds,clean(item.id),label),event=clean(item.event),effect=clean(item.effect); if(!event||!effect) throw new TypeError(`${label} requires event and effect`); return {id,event,...(clean(item.condition)?{condition:clean(item.condition)}:{}),effect,...(clean(item.description)?{description:clean(item.description)}:{})};});
  const acceptanceIds=new Set(); if(!Array.isArray(input.acceptance||[])) throw new TypeError('WorldIR acceptance must be an array');
  const acceptance=(input.acceptance||[]).map((item,index)=>{const label=`WorldIR acceptance[${index}]`; assertObject(item,label); assertKnownKeys(item,ACCEPTANCE_KEYS,label); const id=uniqueId(acceptanceIds,clean(item.id),label),kind=clean(item.kind||'world-valid'),descriptionText=clean(item.description); if(!['world-valid','object-exists','state-equals','interaction-verified','no-unresolved'].includes(kind)) throw new TypeError(`${label} unsupported kind: ${kind}`); const targetId=clean(item.targetId),capability=clean(item.capability).toUpperCase(),stateKey=clean(item.stateKey); if(kind==='object-exists'&&!targetId) throw new TypeError(`${label} object-exists requires targetId`); if(kind==='state-equals'&&(!targetId||!stateKey||!Object.prototype.hasOwnProperty.call(item,'value'))) throw new TypeError(`${label} state-equals requires targetId/stateKey/value`); if(kind==='interaction-verified'&&(!targetId||!capability)) throw new TypeError(`${label} interaction-verified requires targetId/capability`); return {id,kind,...(targetId?{targetId}:{}),...(capability?{capability}:{}),...(stateKey?{stateKey}:{}),...(Object.prototype.hasOwnProperty.call(item,'value')?{value:item.value}:{}),...(descriptionText?{description:descriptionText}:{})};});
  return {schema:WORLD_IR_SCHEMA,schemaVersion:WORLD_IR_VERSION,revision:{id:revisionId,...(parentId?{parentId}:{}),...(clean(revision.reason)?{reason:clean(revision.reason)}:{})},provenance:{source,...(clean(provenance.sourceId)?{sourceId:clean(provenance.sourceId)}:{}),...(clean(provenance.createdBy)?{createdBy:clean(provenance.createdBy)}:{}),evidenceRefs},intent:{name,description,...(task?{task}: {})},policy:{generation:{...(defaultProvider?{provider:defaultProvider}:{}),generate:defaultGenerate},physics:{...(clean(physicsPolicy.fallbackPolicy)?{fallbackPolicy:clean(physicsPolicy.fallbackPolicy)}:{})}},entities,spatial:{relations,constraints},interactions,rules,acceptance};
}

const unsupportedFeatures=(ir)=>{const features=[]; if(ir.spatial.constraints.length) features.push('spatial.constraints'); if(ir.interactions.length) features.push('interactions'); if(ir.rules.length) features.push('rules'); for(const entity of ir.entities){if(entity.physicsRequirement) features.push(`entities.${entity.id||'$anonymous'}.physicsRequirement`); if(entity.capabilityIntent.length) features.push(`entities.${entity.id||'$anonymous'}.capabilityIntent`); if(Object.keys(entity.initialState).length) features.push(`entities.${entity.id||'$anonymous'}.initialState`);} if(Object.keys(ir.policy.physics).length) features.push('policy.physics'); return features;};
export function serializeWorldIR(input){return JSON.stringify(normalizeWorldIR(input));}
export function parseWorldIR(serialized){if(typeof serialized!=='string') throw new TypeError('Serialized WorldIR must be a string'); let value; try{value=JSON.parse(serialized);}catch(cause){const error=new TypeError('Serialized WorldIR must contain valid JSON',{cause});error.code='WORLD_IR_JSON_INVALID';throw error;} return normalizeWorldIR(value);}
export function worldIRToWorldSpec(input){const ir=normalizeWorldIR(input); const unsupported=unsupportedFeatures(ir); if(unsupported.length){const error=new TypeError(`WorldIR features are not executable by the current pipeline: ${unsupported.join(', ')}`); error.code='WORLD_IR_FEATURE_UNSUPPORTED'; error.features=unsupported; throw error;} return normalizeWorldSpec({name:ir.intent.name,description:ir.intent.description,generation:structuredClone(ir.policy.generation),assets:ir.entities.map((entity)=>({...entity.asset,...(entity.id?{id:entity.id}:{}),...(entity.transform.position?{position:[...entity.transform.position]}:{})})),relations:ir.spatial.relations.map((item)=>structuredClone(item))});}
