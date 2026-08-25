const SCHEMA='agentscape.rule-graph';
const VERSION=1;
const allowedEffectKinds=new Set(['set-state']);
const clean=v=>typeof v==='string'?v.trim():'';
const scalar=v=>v===null||typeof v==='string'||typeof v==='number'||typeof v==='boolean';

export function compileRuleGraph(rules=[]){
  if(!Array.isArray(rules)) throw new TypeError('Rules must be an array');
  const ids=new Set();
  const compiled=rules.map((rule,index)=>{
    if(!rule||typeof rule!=='object'||Array.isArray(rule)) throw new TypeError(`Rule[${index}] must be an object`);
    const id=clean(rule.id),event=clean(rule.event),effect=rule.effect;
    if(!id||ids.has(id)) throw new TypeError(`Rule[${index}] requires unique id`); ids.add(id);
    if(!event) throw new TypeError(`Rule[${index}] requires event`);
    if(!effect||typeof effect!=='object'||allowedEffectKinds.has(effect.kind)===false) throw new TypeError(`Rule[${index}] unsupported effect`);
    const targetId=clean(effect.targetId),stateKey=clean(effect.stateKey);
    if(!targetId||!stateKey||!Object.prototype.hasOwnProperty.call(effect,'value')||!scalar(effect.value)) throw new TypeError(`Rule[${index}] set-state effect requires targetId/stateKey/scalar value`);
    const condition=rule.condition?compileCondition(rule.condition,`Rule[${index}] condition`):null;
    return {id,event,condition,effect:{kind:'set-state',targetId,stateKey,value:effect.value},description:clean(rule.description)||undefined};
  });
  return {schema:SCHEMA,schemaVersion:VERSION,rules:compiled};
}

function compileCondition(condition,label){
  if(!condition||typeof condition!=='object'||Array.isArray(condition)) throw new TypeError(`${label} must be an object`);
  const kind=clean(condition.kind);
  if(kind==='equals'){
    if(!clean(condition.targetId)||!clean(condition.stateKey)||!Object.prototype.hasOwnProperty.call(condition,'value')||!scalar(condition.value)) throw new TypeError(`${label} equals requires targetId/stateKey/value`);
    return {kind:'equals',targetId:clean(condition.targetId),stateKey:clean(condition.stateKey),value:condition.value};
  }
  if(kind==='not-equals'){
    if(!clean(condition.targetId)||!clean(condition.stateKey)||!Object.prototype.hasOwnProperty.call(condition,'value')||!scalar(condition.value)) throw new TypeError(`${label} not-equals requires targetId/stateKey/value`);
    return {kind:'not-equals',targetId:clean(condition.targetId),stateKey:clean(condition.stateKey),value:condition.value};
  }
  throw new TypeError(`${label} unsupported kind: ${kind}`);
}

export function evaluateRuleGraph(graph,event,stateReader){
  if(graph?.schema!==SCHEMA||graph.schemaVersion!==VERSION) throw new TypeError('Unsupported rule graph');
  if(typeof stateReader!=='function') throw new TypeError('stateReader must be a function');
  const matches=[];
  for(const rule of graph.rules){
    if(rule.event!==event) continue;
    if(rule.condition&&!evaluateCondition(rule.condition,stateReader)) continue;
    matches.push(structuredClone(rule.effect));
  }
  return matches;
}

function evaluateCondition(condition,stateReader){
  const value=stateReader(condition.targetId,condition.stateKey);
  return condition.kind==='equals' ? Object.is(value,condition.value) : !Object.is(value,condition.value);
}

export function executeRuleEffects(runtime,effects,{source='rule-graph',eventId=null}={}){
  if(!Array.isArray(effects)) throw new TypeError('Rule effects must be an array');
  if(!effects.length) return Promise.resolve({status:'no-rule-match',effects:[]});
  return runtime.mutate(`rule:${eventId||source}`,async()=>{
    const applied=[];
    for(const effect of effects){
      if(effect.kind!=='set-state') { const error=new TypeError(`Unsupported rule effect: ${effect.kind}`); error.code='RULE_EFFECT_UNSUPPORTED'; throw error; }
      const result=runtime.applyStateTransition(effect.targetId,effect.stateKey,effect.value,{source:'rule-graph',event:eventId});
      if(result?.status!=='state-transition-applied') throw new Error(`Rule state transition rejected: ${effect.targetId}.${effect.stateKey}`);
      applied.push(result);
    }
    return {status:'rule-effects-applied',effects:applied};
  });
}

export {SCHEMA as RULE_GRAPH_SCHEMA,VERSION as RULE_GRAPH_VERSION};
