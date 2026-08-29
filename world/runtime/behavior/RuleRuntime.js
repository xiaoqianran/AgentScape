import { compileRuleGraph, evaluateRuleGraph, executeRuleEffects } from './RuleGraph.js';

export class RuleRuntime {
  constructor(runtime,{maxCascadeDepth=16}={}) {
    this.runtime=runtime;
    this.events=runtime.events;
    this.maxCascadeDepth=maxCascadeDepth;
    this.graph={schema:'agentscape.rule-graph',schemaVersion:1,rules:[]};
    this.unsubscribe=null;
    this.queue=Promise.resolve();
    this.active=false;
  }

  load(rulesOrGraph=[]) {
    this.graph=rulesOrGraph?.schema==='agentscape.rule-graph' ? structuredClone(rulesOrGraph) : compileRuleGraph(rulesOrGraph);
    return structuredClone(this.graph);
  }

  start() {
    if(this.unsubscribe) return;
    this.unsubscribe=this.events.on('*',(event)=>{
      if(!this.active) return;
      const cascadeDepth=Number(event?.meta?.ruleCascadeDepth||0);
      this.queue=this.queue.then(()=>this.dispatchEvent(event,{cascadeDepth})).catch((error)=>{
        this.runtime.events.emit('rule.error',{error:{code:error.code||'RULE_RUNTIME_ERROR',message:error.message},sourceEvent:event?.type});
      });
    });
    this.active=true;
  }

  stop() { this.active=false; this.unsubscribe?.(); this.unsubscribe=null; }

  readState(targetId,stateKey) {
    const record=this.runtime.store?.get?.(targetId);
    return record?.state?.[stateKey];
  }

  async dispatchEvent(event,{cascadeDepth=0}={}) {
    if(!event?.type) return {status:'no-rule-event'};
    if(cascadeDepth>=this.maxCascadeDepth) {
      const error=new Error(`Rule cascade depth exceeded: ${event.type}`); error.code='RULE_CASCADE_DEPTH_EXCEEDED'; throw error;
    }
    const effects=evaluateRuleGraph(this.graph,event.type,(id,key)=>this.readState(id,key));
    if(!effects.length) return {status:'no-rule-match',event:event.type,effects:[]};
    const dedupe=new Set();
    const uniqueEffects=effects.filter((effect)=>{
      const key=JSON.stringify([effect.targetId,effect.stateKey,effect.value]);
      if(dedupe.has(key)) return false;
      dedupe.add(key); return true;
    });
    const result=await executeRuleEffects(this.runtime,uniqueEffects,{source:'rule-runtime',eventId:event.type});
    this.runtime.events.emit('rule.effects-applied',{eventType:event.type,count:uniqueEffects.length,meta:{ruleCascadeDepth:cascadeDepth+1},result});
    return {status:'rules-applied',event:event.type,effects:uniqueEffects,result};
  }
}
