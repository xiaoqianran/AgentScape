import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';
import { RuleRuntime } from '../src/runtime/behavior/RuleRuntime.js';

describe('RuleRuntime',()=>{
  function runtime(){
    const events=new EventBus();
    const state=new Map([['switch_01',{state:{enabled:false}}],['light_01',{state:{enabled:false}}]]);
    return {events,store:{get:id=>state.get(id)},mutate:vi.fn(async(_label,fn)=>fn()),applyStateTransition:vi.fn((id,key,value,meta)=>{const r=state.get(id); r.state[key]=value; events.emit('world.state-transition',{id,stateKey:key,value,meta}); return {status:'state-transition-applied',targetId:id,stateKey:key,value};})};
  }
  it('loads and triggers matching rules from the real EventBus',async()=>{
    const rt=runtime(); const engine=new RuleRuntime(rt); engine.load([{id:'on',event:'switch.clicked',effect:{kind:'set-state',targetId:'light_01',stateKey:'enabled',value:true}}]); engine.start();
    rt.events.emit('switch.clicked',{id:'switch_01'});
    await engine.queue;
    expect(rt.applyStateTransition).toHaveBeenCalledWith('light_01','enabled',true,{source:'rule-graph',event:'switch.clicked'});
  });
  it('evaluates conditions against current runtime state and skips non-matching rules',async()=>{
    const rt=runtime(); const engine=new RuleRuntime(rt); engine.load([{id:'guarded',event:'switch.clicked',condition:{kind:'equals',targetId:'switch_01',stateKey:'enabled',value:true},effect:{kind:'set-state',targetId:'light_01',stateKey:'enabled',value:true}}]); engine.start();
    rt.events.emit('switch.clicked',{}); await engine.queue; expect(rt.applyStateTransition).not.toHaveBeenCalled();
  });
  it('deduplicates effects and enforces cascade depth',async()=>{
    const rt=runtime(); const engine=new RuleRuntime(rt,{maxCascadeDepth:1}); engine.load([{id:'a',event:'loop',effect:{kind:'set-state',targetId:'light_01',stateKey:'enabled',value:true}},{id:'b',event:'loop',effect:{kind:'set-state',targetId:'light_01',stateKey:'enabled',value:true}}]); engine.start();
    const result=await engine.dispatchEvent({type:'loop'},{cascadeDepth:0}); expect(result.effects).toHaveLength(1); expect(rt.applyStateTransition).toHaveBeenCalledTimes(1);
    await expect(engine.dispatchEvent({type:'loop'},{cascadeDepth:1})).rejects.toMatchObject({code:'RULE_CASCADE_DEPTH_EXCEEDED'});
  });
});
