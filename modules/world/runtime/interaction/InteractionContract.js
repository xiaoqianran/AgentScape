export const INTERACTION_CONTRACT_SCHEMA='agentscape.interaction-contract';
export const INTERACTION_CONTRACT_VERSION=1;

const clean=v=>typeof v==='string'?v.trim():'';
const plain=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const assertObject=(v,label)=>{if(!plain(v)) throw new TypeError(`${label} must be an object`);return v;};
const assertFinite=v=>{if(!Number.isFinite(v)) throw new TypeError('Interaction target must be finite');return Number(v);};

const executableActions=new Set(['open','close']);

export function compileInteractionContract(manifest){
  assertObject(manifest,'Manifest');
  const entityId=clean(manifest.id)||'$anonymous';
  const contracts=[];
  const parts=manifest.parts||{};
  for(const action of manifest.actions||[]){
    const candidates=Object.entries(parts).filter(([partName,part])=>part?.actions?.includes(action)&&Number.isFinite(part?.targets?.[action]));
    if(executableActions.has(action)&&!candidates.length) throw new TypeError(`Action ${action} has no executable part target`);
    for(const [partName,part] of candidates){
      const target=assertFinite(part.targets[action]);
      contracts.push({
        id:`${entityId}:${partName}:${action}`,
        capability:action.toUpperCase(),
        action,
        target:{entityId,partName},
        preconditions:[
          {kind:'supports-action',action},
          {kind:'runtime-authorized',capability:action.toUpperCase()}
        ],
        effects:[{kind:'set-articulation-target',target}],
        stateTransition:{kind:'articulation-completion',from:['unknown','open','closed','moving'],to:action},
        verifierTarget:{type:'articulation-state',entityId:manifest.id,partName,target,settledRequired:true}
      });
    }
  }
  return {schema:INTERACTION_CONTRACT_SCHEMA,schemaVersion:INTERACTION_CONTRACT_VERSION,entityId,contracts};
}

export function getInteractionContract(manifest,partName,action){
  const contract=compileInteractionContract(manifest).contracts.find(item=>item.target.partName===partName&&item.action===action);
  if(!contract) throw new Error(`Interaction contract not found: ${manifest.id}:${partName}:${action}`);
  return structuredClone(contract);
}

export function verifyInteractionResult(contract,result){
  const verifier=contract?.verifierTarget;
  if(!verifier) return {verified:false,reason:'VERIFIER_TARGET_MISSING'};
  const verified=result?.status==='action-completed'
    && result?.targetReached===true
    && result?.settled===true
    && result?.part===verifier.partName
    && Number.isFinite(result?.target)
    && Math.abs(result.target-verifier.target)<=.08;
  return verified?{verified:true}:{verified:false,reason:'POST_CONDITION_NOT_VERIFIED'};
}
