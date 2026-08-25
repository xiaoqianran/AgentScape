import { describe, expect, it, vi } from 'vitest';
import { compileBehaviorGraph, compileInteractionIntent, executeBehaviorCommand, verifyBehaviorCommand } from '../src/runtime/behavior/BehaviorCompiler.js';

describe('BehaviorCompiler',()=>{
  it('compiles World IR interaction intent into a typed runtime command',()=>{
    const command=compileInteractionIntent({id:'open-door',actorId:'agent_01',targetId:'cabinet_01',capability:'open'},{worldRevisionId:'rev-2'});
    expect(command).toMatchObject({schema:'agentscape.runtime-command',schemaVersion:1,kind:'interaction',commandId:'interaction:open-door',capability:'OPEN',actorId:'agent_01',targetId:'cabinet_01',verifierTarget:{type:'interaction-contract',targetId:'cabinet_01',capability:'OPEN',settledRequired:true},source:{interactionId:'open-door',worldRevisionId:'rev-2'}});
  });
  it('rejects unsupported capabilities before Runtime execution',()=>{ expect(()=>compileInteractionIntent({id:'grab',targetId:'box',capability:'GRAB'})).toThrow(/Unsupported interaction capability/); });
  it('compiles a deterministic graph and rejects duplicate command ids',()=>{ expect(compileBehaviorGraph([{id:'a',targetId:'door',capability:'open'},{id:'b',targetId:'door',capability:'close'}]).commands).toHaveLength(2); expect(()=>compileBehaviorGraph([{id:'a',targetId:'door',capability:'open'},{id:'a',targetId:'door',capability:'open'}])).toThrow(/Duplicate runtime command/); });
  it('verifies only a completed, settled result for the compiled command',()=>{
    const command=compileInteractionIntent({id:'open-door',targetId:'cabinet_01',capability:'open'});
    expect(verifyBehaviorCommand(command,{status:'action-requested',targetReached:false,settled:false,targetId:'cabinet_01',action:'open'})).toMatchObject({verified:false});
    expect(verifyBehaviorCommand(command,{status:'action-completed',targetReached:true,settled:true,targetId:'cabinet_01',action:'open'})).toEqual({verified:true});
  });
  it('executes through the existing InteractionSystem executor boundary',async()=>{
    const runtime={interactions:{approachAndInteract:vi.fn(async()=>({status:'action-completed',targetReached:true,settled:true,targetId:'cabinet_01',action:'open'}))}};
    const command=compileInteractionIntent({id:'open-door',actorId:'agent_01',targetId:'cabinet_01',capability:'open'});
    const result=await executeBehaviorCommand(runtime,command);
    expect(runtime.interactions.approachAndInteract).toHaveBeenCalledWith('agent_01','cabinet_01','open');
    expect(result.status).toBe('action-completed');
  });
});
