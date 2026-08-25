import { describe, expect, it, vi } from 'vitest';
import { compileRuleGraph, evaluateRuleGraph, executeRuleEffects } from '../src/runtime/behavior/RuleGraph.js';

describe('RuleGraph',()=>{
  it('compiles typed rules with only safe set-state effects',()=>{
    const graph=compileRuleGraph([{id:'switch-on',event:'switch.clicked',condition:{kind:'equals',targetId:'switch_01',stateKey:'enabled',value:false},effect:{kind:'set-state',targetId:'light_01',stateKey:'enabled',value:true}}]);
    expect(graph.rules[0]).toMatchObject({id:'switch-on',event:'switch.clicked',effect:{kind:'set-state',targetId:'light_01',stateKey:'enabled',value:true}});
  });
  it('evaluates conditions against runtime state without executing arbitrary code',()=>{
    const graph=compileRuleGraph([{id:'r',event:'e',condition:{kind:'equals',targetId:'a',stateKey:'x',value:false},effect:{kind:'set-state',targetId:'b',stateKey:'x',value:true}}]);
    expect(evaluateRuleGraph(graph,'e',(id,key)=>id==='a'&&key==='x'?false:null)).toEqual([{kind:'set-state',targetId:'b',stateKey:'x',value:true}]);
    expect(evaluateRuleGraph(graph,'other',()=>false)).toEqual([]);
  });
  it('executes effects through WorldRuntime.mutate and fails closed on unsupported effects',async()=>{
    const effects=[{kind:'set-state',targetId:'light',stateKey:'enabled',value:true}];
    const runtime={mutate:vi.fn(async(_label,fn)=>fn()),applyStateTransition:vi.fn(()=>({status:'state-transition-applied'}))};
    const result=await executeRuleEffects(runtime,effects,{eventId:'switch-on'});
    expect(runtime.mutate).toHaveBeenCalled(); expect(result.status).toBe('rule-effects-applied');
    await expect(executeRuleEffects(runtime,[{kind:'arbitrary-js'}])).rejects.toThrow(/Unsupported rule effect/);
  });
});
