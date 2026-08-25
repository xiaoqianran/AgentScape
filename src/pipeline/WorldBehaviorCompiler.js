import { compileBehaviorGraph } from '../runtime/behavior/BehaviorCompiler.js';
import { compileRuleGraph } from '../runtime/behavior/RuleGraph.js';

export const WORLD_BEHAVIOR_BUNDLE_SCHEMA='agentscape.world-behavior-bundle';
export const WORLD_BEHAVIOR_BUNDLE_VERSION=1;

export function compileWorldBehaviorBundle(worldIR){
  const entityIds=new Set((worldIR?.entities||[]).map((entity)=>entity.id).filter(Boolean));
  const behaviorGraph=compileBehaviorGraph(worldIR?.interactions||[],{worldRevisionId:worldIR?.revision?.id || null});
  for(const command of behaviorGraph.commands){
    for(const [field,id] of [['targetId',command.targetId],['supportId',command.supportId]]){
      if(id&&!entityIds.has(id)){
        const error=new Error(`Behavior ${field} is outside World IR entities: ${id}`);
        error.code='WORLD_BEHAVIOR_REFERENCE_INVALID'; error.commandId=command.commandId; error.entityId=id; throw error;
      }
    }
  }
  const ruleGraph=compileRuleGraph(worldIR?.rules||[]);
  for(const rule of ruleGraph.rules){
    const refs=[rule.condition?.targetId,rule.effect?.targetId].filter(Boolean);
    for(const id of refs){
      if(!entityIds.has(id)){
        const error=new Error(`Rule target is outside World IR entities: ${id}`);
        error.code='WORLD_RULE_REFERENCE_INVALID'; error.ruleId=rule.id; error.entityId=id; throw error;
      }
    }
  }
  return {schema:WORLD_BEHAVIOR_BUNDLE_SCHEMA,schemaVersion:WORLD_BEHAVIOR_BUNDLE_VERSION,worldRevisionId:worldIR?.revision?.id || null,behaviorGraph,ruleGraph};
}

export function admitWorldBehavior(bundle,{resolvedAssets=[],getManifest}={}){
  if(bundle?.schema!==WORLD_BEHAVIOR_BUNDLE_SCHEMA||bundle.schemaVersion!==WORLD_BEHAVIOR_BUNDLE_VERSION) throw new TypeError('Unsupported WorldBehavior bundle');
  const byId=new Map((resolvedAssets||[]).filter((item)=>item.id).map((item)=>[item.id,item]));
  const issues=[];
  for(const command of bundle.behaviorGraph.commands){
    const targetId=command.targetId;
    const target=targetId?byId.get(targetId):null;
    if(targetId&&!target){issues.push({code:'BEHAVIOR_TARGET_MISSING',commandId:command.commandId,targetId});continue;}
    if(targetId&&!target?.assetId){issues.push({code:'BEHAVIOR_TARGET_UNRESOLVED',commandId:command.commandId,targetId});continue;}
    if(['OPEN','CLOSE','PICKUP'].includes(command.capability)){
      const manifest=getManifest?.(target.assetId);
      const action=command.capability.toLowerCase();
      if(!manifest?.actions?.includes(action)) issues.push({code:'BEHAVIOR_CAPABILITY_UNSUPPORTED',commandId:command.commandId,targetId,capability:command.capability,assetId:target.assetId});
    }
  }
  return {status:issues.length?'rejected':'ready',issues};
}
