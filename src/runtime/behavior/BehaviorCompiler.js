export const BEHAVIOR_COMMAND_SCHEMA='agentscape.runtime-command';
export const BEHAVIOR_COMMAND_VERSION=1;

const clean=v=>typeof v==='string'?v.trim():'';
const SUPPORTED_CAPABILITIES=new Set(['OPEN','CLOSE','PICKUP','PLACE','SWITCH']);

export function compileInteractionIntent(intent,{worldRevisionId=null}={}){
  if(!intent||typeof intent!=='object'||Array.isArray(intent)) throw new TypeError('Interaction intent must be an object');
  const id=clean(intent.id); const targetId=clean(intent.targetId); const supportId=clean(intent.supportId); const capability=clean(intent.capability).toUpperCase();
  if(!id||!capability) throw new TypeError('Interaction intent requires id and capability');
  if((capability==='OPEN'||capability==='CLOSE'||capability==='PICKUP') && !targetId) throw new TypeError(`${capability} interaction intent requires targetId`);
  if(!SUPPORTED_CAPABILITIES.has(capability)) { const error=new TypeError(`Unsupported interaction capability: ${capability}`); error.code='BEHAVIOR_CAPABILITY_UNSUPPORTED'; throw error; }
  const actorId=clean(intent.actorId)||null;
  const command={
    schema:BEHAVIOR_COMMAND_SCHEMA,schemaVersion:BEHAVIOR_COMMAND_VERSION,
    commandId:`interaction:${id}`,kind:'interaction',capability,...(actorId?{actorId}:{}),
    preconditions:[],effects:[],verifierTarget:{type:'interaction-contract',capability,settledRequired:true},
    source:{interactionId:id,...(worldRevisionId?{worldRevisionId}:{})}
  };
  if(capability==='OPEN'||capability==='CLOSE'){
    command.targetId=targetId;
    command.preconditions=[{kind:'target-supports-capability',targetId,capability}];
    command.effect={kind:'execute-interaction-contract',capability,targetId};
    command.verifierTarget.targetId=targetId;
  } else if(capability==='PICKUP'){
    command.targetId=targetId;
    command.preconditions=[{kind:'target-carryable',targetId}];
    command.effect={kind:'execute-pickup',targetId};
    command.verifierTarget={type:'pickup',targetId,heldRequired:true};
  } else if(capability==='PLACE'){
    const supportId=clean(intent.supportId);
    if(!supportId) throw new TypeError('PLACE interaction intent requires supportId');
    command.supportId=supportId; command.targetId=supportId;
    command.preconditions=[{kind:'actor-holds-object'},{kind:'support-target',supportId}];
    command.effect={kind:'execute-place',supportId};
    command.verifierTarget={type:'place',supportId,supportVerifiedRequired:true,settledRequired:true};
  } else if(capability==='SWITCH'){
    const stateKey=clean(intent.stateKey); if(!stateKey) throw new TypeError('SWITCH interaction intent requires stateKey');
    if(!Object.prototype.hasOwnProperty.call(intent,'value')) throw new TypeError('SWITCH interaction intent requires value');
    if(typeof intent.value!=='string' && typeof intent.value!=='number' && typeof intent.value!=='boolean' && intent.value!==null) throw new TypeError('SWITCH value must be JSON scalar');
    command.targetId=targetId;
    command.stateKey=stateKey; command.value=intent.value;
    command.preconditions=[{kind:'state-target',targetId,stateKey}];
    command.effect={kind:'set-state',targetId,stateKey,value:intent.value};
    command.verifierTarget={type:'state-transition',targetId,stateKey,value:intent.value};
  }
  return command;
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
    const verified=result?.status==='action-completed'&&result?.targetReached===true&&result?.settled===true&&result?.targetId===verifier.targetId&&result?.action?.toUpperCase()===verifier.capability;
    return verified?{verified:true}:{verified:false,reason:'POST_CONDITION_NOT_VERIFIED'};
  }
  if(verifier.type==='pickup') return result?.status==='held' && result?.targetId===verifier.targetId ? {verified:true}:{verified:false,reason:'PICKUP_NOT_VERIFIED'};
  if(verifier.type==='place') return result?.status==='placed' && result?.supportVerified===true && result?.settled===true && result?.targetId===verifier.supportId ? {verified:true}:{verified:false,reason:'PLACE_NOT_VERIFIED'};
  if(verifier.type==='state-transition') return result?.status==='state-transition-applied' && result?.targetId===verifier.targetId && result?.stateKey===verifier.stateKey && Object.is(result?.value,verifier.value) ? {verified:true}:{verified:false,reason:'STATE_TRANSITION_NOT_VERIFIED'};
  return {verified:false,reason:'VERIFIER_TYPE_UNSUPPORTED'};
}

export function executeBehaviorCommand(runtime,command){
  if(command?.schema!==BEHAVIOR_COMMAND_SCHEMA || command.schemaVersion!==BEHAVIOR_COMMAND_VERSION){ const error=new TypeError('Unsupported RuntimeCommand'); error.code='RUNTIME_COMMAND_UNSUPPORTED'; throw error; }
  if(command.kind!=='interaction') { const error=new TypeError(`Unsupported RuntimeCommand kind: ${command.kind}`); error.code='RUNTIME_COMMAND_KIND_UNSUPPORTED'; throw error; }
  if(command.capability==='OPEN'||command.capability==='CLOSE') return runtime.interactions.approachAndInteract(command.actorId,command.targetId,command.capability.toLowerCase());
  if(command.capability==='PICKUP') return runtime.interactions.approachAndPickup(command.actorId,command.targetId);
  if(command.capability==='PLACE') return runtime.interactions.approachAndPlace(command.actorId,command.supportId);
  if(command.capability==='SWITCH') return runtime.applyStateTransition(command.targetId,command.stateKey,command.value,{source:'behavior-command',commandId:command.commandId});
  const error=new TypeError(`Unsupported RuntimeCommand capability: ${command.capability}`); error.code='RUNTIME_COMMAND_CAPABILITY_UNSUPPORTED'; throw error;
}
