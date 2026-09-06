import { normalizeWorldIR, upgradeLegacyWorldSpec } from '../spec/WorldIR.js';
import { normalizeWorldSpec } from '../spec/WorldSpec.js';
import { compileWorldBehaviorBundle } from './WorldBehaviorCompiler.js';
import { compileWorldPhysicsRequirements } from './WorldPhysicsAdmission.js';
import { compileWorldAcceptance } from '../verification/WorldAcceptance.js';
import { createAssetRef } from '../../asset/AssetRef.js';

export const WORLD_COMPILATION_SCHEMA = 'agentscape.world-compilation';
export const WORLD_COMPILATION_VERSION = 2;

const clone = (value) => structuredClone(value);
const hasState = (entity) => Object.keys(entity.initialState || {}).length > 0;

const invalidReference = (path, entityId) => {
  const error = new TypeError(`WorldIR ${path} references unknown entity: ${entityId}`);
  error.code = 'WORLD_IR_REFERENCE_INVALID';
  error.path = path;
  error.entityId = entityId;
  return error;
};

const requireEntity = (entityIds, path, entityId) => {
  if (entityId && !entityIds.has(entityId)) throw invalidReference(path, entityId);
};

const unsupportedExecutionFeatures = (worldIR) => {
  const features=[];
  if(worldIR.spatial.constraints.length) features.push('spatial.constraints');
  const fallback=worldIR.policy.physics?.fallbackPolicy;
  if(fallback && fallback!=='deny') features.push('policy.physics.fallbackPolicy');
  for(const entity of worldIR.entities){
    const qualityFallback=entity.physicsRequirement?.qualityPolicy?.fallbackPolicy;
    if(qualityFallback && qualityFallback!=='deny') features.push(`entities.${entity.id||'$anonymous'}.physicsRequirement.qualityPolicy.fallbackPolicy`);
  }
  if(features.length){
    const error=new TypeError(`WorldIR features are not executable by the canonical pipeline: ${features.join(', ')}`);
    error.code='WORLD_IR_FEATURE_UNSUPPORTED';
    error.features=features;
    throw error;
  }
  return worldIR;
};

export function assertWorldIRReferences(worldIR) {
  const entityIds = new Set(worldIR.entities.map((entity) => entity.id).filter(Boolean));
  const entityById = new Map(worldIR.entities.filter((entity)=>entity.id).map((entity)=>[entity.id,entity]));

  worldIR.entities.forEach((entity, index) => {
    if (!entity.id && (entity.capabilityIntent.length || hasState(entity))) {
      const error = new TypeError(`WorldIR entity[${index}] requires id for capabilityIntent or initialState`);
      error.code = 'WORLD_IR_ENTITY_ID_REQUIRED';
      throw error;
    }
  });

  const anchoredSubjects=new Set();
  worldIR.spatial.relations.forEach((relation, index) => {
    requireEntity(entityIds, `spatial.relations[${index}].subject`, relation.subject);
    if(relation.object) requireEntity(entityIds, `spatial.relations[${index}].object`, relation.object);
    if(relation.anchor?.kind==='observation'){
      if(anchoredSubjects.has(relation.subject)){
        const error=new TypeError(`WorldIR entity ${relation.subject} has multiple observation anchors`);
        error.code='WORLD_IR_OBSERVATION_ANCHOR_AMBIGUOUS';
        error.entityId=relation.subject;
        throw error;
      }
      anchoredSubjects.add(relation.subject);
      if(entityById.get(relation.subject)?.transform?.position){
        const error=new TypeError(`WorldIR entity ${relation.subject} cannot combine explicit transform.position with an observation anchor`);
        error.code='WORLD_IR_OBSERVATION_ANCHOR_POSITION_CONFLICT';
        error.entityId=relation.subject;
        throw error;
      }
    }
  });
  worldIR.spatial.constraints.forEach((constraint, index) => {
    requireEntity(entityIds, `spatial.constraints[${index}].subject`, constraint.subject);
    requireEntity(entityIds, `spatial.constraints[${index}].object`, constraint.object);
  });
  worldIR.interactions.forEach((interaction, index) => {
    requireEntity(entityIds, `interactions[${index}].targetId`, interaction.targetId);
    requireEntity(entityIds, `interactions[${index}].supportId`, interaction.supportId);
  });
  worldIR.acceptance.forEach((criterion, index) => {
    requireEntity(entityIds, `acceptance[${index}].targetId`, criterion.targetId);
    requireEntity(entityIds, `acceptance[${index}].subject`, criterion.subject);
    requireEntity(entityIds, `acceptance[${index}].object`, criterion.object);
  });
  return worldIR;
}

const assetRequests = (worldIR) => worldIR.entities.map((entity) => ({
  ...(entity.id ? { id:entity.id } : {}),
  ...clone(entity.asset)
}));

const executionEntities = (worldIR) => worldIR.entities.map((entity) => ({
  ...(entity.id ? { id:entity.id } : {}),
  ...(entity.asset.assetId ? { assetRef:createAssetRef(entity.asset.assetId) } : {}),
  ...(entity.transform.position ? { position:[...entity.transform.position] } : {}),
  ...(entity.capabilityIntent.length ? { capabilityIntent:[...entity.capabilityIntent] } : {}),
  ...(hasState(entity) ? { initialState:clone(entity.initialState) } : {})
}));

const compatibilityWorldSpec = (worldIR) => {
  const anchored=worldIR.spatial.relations.find((relation)=>relation.anchor);
  if(anchored){
    const error=new TypeError('Legacy WorldSpec cannot represent observation-anchored relations');
    error.code='WORLD_IR_COMPATIBILITY_UNSUPPORTED';
    error.feature='spatial.relations.anchor';
    throw error;
  }
  return normalizeWorldSpec({
    name:worldIR.intent.name,
    description:worldIR.intent.description,
    generation:clone(worldIR.policy.generation),
    assets:worldIR.entities.map((entity) => ({
      ...(entity.id ? { id:entity.id } : {}),
      ...clone(entity.asset),
      ...(entity.transform.position ? { position:[...entity.transform.position] } : {})
    })),
    relations:worldIR.spatial.relations.map(clone)
  });
};

export function projectWorldIRToWorldSpec(input) {
  return compatibilityWorldSpec(assertWorldIRReferences(normalizeWorldIR(input)));
}

export function compileWorldInput(input) {
  if(input?.schema==='agentscape.world-ir') return compileWorldIR(input);
  const worldIR=upgradeLegacyWorldSpec(input);
  return {
    ...compileWorldIR(worldIR),
    compatibility:{source:'legacy-world-spec',worldSpec:compatibilityWorldSpec(worldIR)}
  };
}

export function compileWorldIR(input) {
  const worldIR = unsupportedExecutionFeatures(assertWorldIRReferences(normalizeWorldIR(input)));
  const behaviorBundle = compileWorldBehaviorBundle(worldIR);
  const physicsRequirements = compileWorldPhysicsRequirements(worldIR);
  const acceptanceGraph = worldIR.acceptance.length ? compileWorldAcceptance(worldIR.acceptance) : null;

  return {
    schema:WORLD_COMPILATION_SCHEMA,
    schemaVersion:WORLD_COMPILATION_VERSION,
    worldRevisionId:worldIR.revision.id,
    worldIR:clone(worldIR),
    assetRequests:assetRequests(worldIR),
    entities:executionEntities(worldIR),
    relations:worldIR.spatial.relations.map(clone),
    behaviorBundle,
    physicsRequirements,
    acceptanceGraph
  };
}
