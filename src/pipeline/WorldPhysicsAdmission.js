import { assetIdFromRef } from '../assets/AssetRef.js';

export const WORLD_PHYSICS_REQUIREMENTS_SCHEMA='agentscape.world-physics-requirements';
export const WORLD_PHYSICS_REQUIREMENTS_VERSION=1;

const BODY_CAPABILITIES={
  transform:['transform-state'],
  rigid:['rigid-body'],
  articulated:['articulated-body','joints'],
  character:['character-controller'],
  soft:['soft-body'],
  cloth:['cloth']
};

export function compileWorldPhysicsRequirements(worldIR){
  const requirements=[];
  for(const entity of worldIR?.entities||[]){
    if(!entity.physicsRequirement) continue;
    if(!entity.id) throw new TypeError('PhysicsRequirement entity requires id');
    const requirement=structuredClone(entity.physicsRequirement);
    const requiredCapabilities=[...new Set([...(BODY_CAPABILITIES[requirement.bodyClass]||[]),...(requirement.requiredCapabilities||[])])];
    requirements.push({
      entityId:entity.id,
      ...(requirement.bodyClass?{bodyClass:requirement.bodyClass}:{}),
      requiredCapabilities,
      executionMode:requirement.executionMode||(requirement.bodyClass==='transform'?'render-only':'realtime'),
      qualityPolicy:structuredClone(requirement.qualityPolicy||{})
    });
  }
  return {
    schema:WORLD_PHYSICS_REQUIREMENTS_SCHEMA,schemaVersion:WORLD_PHYSICS_REQUIREMENTS_VERSION,
    worldRevisionId:worldIR?.revision?.id||null,
    policy:structuredClone(worldIR?.policy?.physics||{}),requirements
  };
}

export function admitWorldPhysics(bundle,{profile,resolvedAssets=[],getManifest}={}){
  if(bundle?.schema!==WORLD_PHYSICS_REQUIREMENTS_SCHEMA||bundle.schemaVersion!==WORLD_PHYSICS_REQUIREMENTS_VERSION) throw new TypeError('Unsupported WorldPhysics requirements');
  if(!profile){
    return {status:bundle.requirements.length?'rejected':'ready',backend:null,requirements:structuredClone(bundle.requirements),issues:bundle.requirements.length?[{code:'PHYSICS_BACKEND_UNAVAILABLE'}]:[]};
  }
  const capabilities=new Set(profile.capabilities||[]);
  const executionModes=new Set(profile.executionModes||[]);
  const byId=new Map((resolvedAssets||[]).filter((item)=>item.id).map((item)=>[item.id,item]));
  const issues=[];
  for(const requirement of bundle.requirements){
    const resolved=byId.get(requirement.entityId);
    const assetId=assetIdFromRef(resolved?.assetRef);
    if(!assetId){issues.push({code:'PHYSICS_TARGET_UNRESOLVED',entityId:requirement.entityId});continue;}
    for(const capability of requirement.requiredCapabilities){
      if(!capabilities.has(capability)) issues.push({code:'PHYSICS_BACKEND_CAPABILITY_MISSING',entityId:requirement.entityId,capability,backend:profile.identity});
    }
    if(!executionModes.has(requirement.executionMode)) issues.push({code:'PHYSICS_EXECUTION_MODE_UNSUPPORTED',entityId:requirement.entityId,executionMode:requirement.executionMode,backend:profile.identity});
    if(requirement.qualityPolicy?.realtimeRequired===true&&profile.qualities?.realtime!==true) issues.push({code:'PHYSICS_REALTIME_QUALITY_UNMET',entityId:requirement.entityId,backend:profile.identity});
    if(requirement.qualityPolicy?.deterministicRequired===true&&profile.qualities?.deterministic!==true) issues.push({code:'PHYSICS_DETERMINISM_QUALITY_UNMET',entityId:requirement.entityId,backend:profile.identity});
    if(requirement.bodyClass==='articulated'){
      const manifest=getManifest?.(assetId);
      const parts=Object.values(manifest?.parts||{});
      if(!parts.some((part)=>part?.joint)) issues.push({code:'PHYSICS_ASSET_ARTICULATION_MISSING',entityId:requirement.entityId,assetId});
    }
  }
  return {
    status:issues.length?'rejected':'ready',
    backend:{
      identity:profile.identity,
      backendCapabilities:[...(profile.backendCapabilities||[])],
      runtimeCapabilities:[...(profile.runtimeCapabilities||[])],
      capabilities:[...(profile.capabilities||[])],
      backendExecutionModes:[...(profile.backendExecutionModes||[])],
      runtimeExecutionModes:[...(profile.runtimeExecutionModes||[])],
      executionModes:[...(profile.executionModes||[])],
      qualities:{...(profile.qualities||{})}
    },
    requirements:structuredClone(bundle.requirements),issues
  };
}
