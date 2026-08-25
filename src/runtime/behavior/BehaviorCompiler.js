export const BEHAVIOR_COMMAND_SCHEMA='agentscape.runtime-command';
export const BEHAVIOR_COMMAND_VERSION=1;

const clean=v=>typeof v==='string'?v.trim():'';
const SUPPORTED_CAPABILITIES=new Set(['OPEN','CLOSE']);

export function compileInteractionIntent(intent,{worldRevisionId=null}={}){
  if(!intent||typeof intent!=='object'||Array.isArray(intent)) throw new TypeError('Interaction intent must be an object');
  const id=clean(intent.id); const targetId=clean(intent.targetId); const capability=clean(intent.capability).toUpperCase();
  if(!id||!targetId||!capability) throw new TypeError('Interaction intent requires id, targetId, capability');
  if(!SUPPORTED_CAPABILITIES.has(capability)) { const error=new TypeError(`Unsupported interaction capability: ${capability}`); error.code='BEHAVIOR_CAPABILITY_UNSUPPORTED'; throw error; }
  const actorId=clean(intent.actorId)||null;
  return {
    schema:BEHAVIOR_COMMAND_SCHEMA,schemaVersion:BEHAVIOR_COMMAND_VERSION,
    commandId:`interaction:${id}`,
    kind:'interaction',capability,targetId,...(actorId?{actorId}:{}),
    preconditions:[{kind:'target-supports-capability',targetId,capability}],
    effect:{kind:'execute-interaction-contract',capability,targetId},
    verifierTarget:{type:'interaction-contract',capability,targetId,settledRequired:true},
    source:{interactionId:id,...(worldRevisionId?{worldRevisionId}:{})}
  };
}

export function compileBehaviorGraph(interactions=[],opts={}){
  if(!Array.isArray(interactions)) throw new TypeError('Interactions must be an array');
  const commands=interactions.map(item=>compileInteractionIntent(item,opts));
  const ids=new Set();
  for(const command of commands){if(ids.has(command.commandId)) throw new TypeError(`Duplicate runtime command: ${command.commandId}`); ids.add(command.commandId);}
  return {schema:BEHAVIOR_COMMAND_SCHEMA,schemaVersion:BEHAVIOR_COMMAND_VERSION,commands};
}

export function verifyBehaviorCommand(command,result){
  const verifier=command?.verifierTarget;
  if(!verifier) return {verified:false,reason:'VERIFIER_TARGET_MISSING'};
  if(verifier.type==='interaction-contract'){
    const verified=result?.status==='action-completed'
      && result?.targetReached===true
      && result?.settled===true
      && result?.targetId===verifier.targetId
      && result?.action?.toUpperCase()===verifier.capability;
    return verified?{verified:true}:{verified:false,reason:'POST_CONDITION_NOT_VERIFIED'};
  }
  return {verified:false,reason:'VERIFIER_TYPE_UNSUPPORTED'};
}

export function executeBehaviorCommand(runtime,command){
  if(command?.schema!==BEHAVIOR_COMMAND_SCHEMA || command.schemaVersion!==BEHAVIOR_COMMAND_VERSION){ const error=new TypeError('Unsupported RuntimeCommand'); error.code='RUNTIME_COMMAND_UNSUPPORTED'; throw error; }
  if(command.kind!=='interaction') { const error=new TypeError(`Unsupported RuntimeCommand kind: ${command.kind}`); error.code='RUNTIME_COMMAND_KIND_UNSUPPORTED'; throw error; }
  if(typeof runtime?.interactions?.approachAndInteract!=='function') throw new Error('Runtime interaction executor unavailable');
  return runtime.interactions.approachAndInteract(command.actorId,command.targetId,command.capability.toLowerCase());
}
