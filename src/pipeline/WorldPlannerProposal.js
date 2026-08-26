import { compileWorldIR } from './WorldCompilation.js';

export const WORLD_PROPOSAL_SCHEMA='agentscape.world-proposal';
export const WORLD_PROPOSAL_VERSION=1;

const BODY_KEYS=new Set(['intent','policy','entities','spatial','interactions','rules','acceptance']);
const clean=(value)=>typeof value==='string'?value.trim():'';

const assertProposalBody=(body)=>{
  if(!body||typeof body!=='object'||Array.isArray(body)) throw new TypeError('World planner proposal must be an object');
  for(const key of Object.keys(body)){
    if(!BODY_KEYS.has(key)){
      const error=new TypeError(`World planner proposal unknown field: ${key}`);
      error.code='WORLD_PROPOSAL_FIELD_INVALID';
      error.field=key;
      throw error;
    }
  }
  return body;
};

export function buildWorldProposal(body,{revisionId,parentRevisionId=null,reason=null,source='agent-world-planner',sourceId=null,createdBy='agent'}={}){
  assertProposalBody(body);
  const id=clean(revisionId);
  if(!id){const error=new TypeError('World proposal requires Runtime-issued revisionId');error.code='WORLD_PROPOSAL_REVISION_REQUIRED';throw error;}
  const parent=clean(parentRevisionId),revisionReason=clean(reason);
  const provenanceSource=clean(source);
  if(!provenanceSource){const error=new TypeError('World proposal requires provenance source');error.code='WORLD_PROPOSAL_PROVENANCE_REQUIRED';throw error;}

  const worldIR={
    schema:'agentscape.world-ir',schemaVersion:1,
    revision:{id,...(parent?{parentId:parent}:{}),...(revisionReason?{reason:revisionReason}:{})},
    provenance:{source:provenanceSource,...(clean(sourceId)?{sourceId:clean(sourceId)}:{}),...(clean(createdBy)?{createdBy:clean(createdBy)}:{})},
    ...structuredClone(body)
  };
  const compilation=compileWorldIR(worldIR);
  return {
    schema:WORLD_PROPOSAL_SCHEMA,schemaVersion:WORLD_PROPOSAL_VERSION,status:'world-proposal-ready',
    worldIR:compilation.worldIR,
    summary:{
      worldRevisionId:compilation.worldRevisionId,
      entities:compilation.entities.length,
      interactions:compilation.behaviorBundle.behaviorGraph.commands.length,
      rules:compilation.behaviorBundle.ruleGraph.rules.length,
      physicsRequirements:compilation.physicsRequirements.requirements.length,
      acceptanceChecks:compilation.acceptanceGraph?.checks?.length || 0
    }
  };
}
