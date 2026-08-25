import { describe, expect, it, vi } from 'vitest';
import { compileBehaviorGraph, compileInteractionIntent, executeBehaviorCommand, verifyBehaviorCommand } from '../src/runtime/behavior/BehaviorCompiler.js';

describe('BehaviorCompiler',()=>{
  it('compiles World IR interaction intent into a typed runtime command',()=>{
    const command=compileInteractionIntent({id:'open-door',actorId:'agent_01',targetId:'cabinet_01',capability:'open'},{worldRevisionId:'rev-2'});
    expect(command).toMatchObject({schema:'agentscape.runtime-command',schemaVersion:1,kind:'interaction',commandId:'interaction:open-door',capability:'OPEN',actorId:'agent_01',targetId:'cabinet_01',verifierTarget:{type:'interaction-contract',targetId:'cabinet_01',capability:'OPEN',settledRequired:true},source:{interactionId:'open-door',worldRevisionId:'rev-2'}});
  });

  it('compiles PICKUP and PLACE into typed runtime commands with deterministic verifiers',()=>{
    expect(compileInteractionIntent({id:'pick-cup',actorId:'agent_01',targetId:'cup_01',capability:'pickup'})).toMatchObject({capability:'PICKUP',targetId:'cup_01',effect:{kind:'execute-pickup'},verifierTarget:{type:'pickup',targetId:'cup_01',heldRequired:true}});
    expect(compileInteractionIntent({id:'place-cup',actorId:'agent_01',supportId:'table_01',capability:'place'})).toMatchObject({capability:'PLACE',supportId:'table_01',targetId:'table_01',effect:{kind:'execute-place'},verifierTarget:{type:'place',supportId:'table_01',supportVerifiedRequired:true,settledRequired:true}});
  });
  it('verifies pickup and place only from final deterministic post-conditions',()=>{
    const pickup=compileInteractionIntent({id:'pick',actorId:'a',targetId:'cup',capability:'pickup'});
    expect(verifyBehaviorCommand(pickup,{status:'held',targetId:'cup'})).toEqual({verified:true});
    const place=compileInteractionIntent({id:'place',actorId:'a',supportId:'table',capability:'place'});
    expect(verifyBehaviorCommand(place,{status:'placed',targetId:'table',supportVerified:true,settled:true})).toEqual({verified:true});
    expect(verifyBehaviorCommand(place,{status:'place-unverified',targetId:'table',supportVerified:false,settled:false})).toMatchObject({verified:false});
  });
  it('executes pickup and place through the existing interaction boundaries',async()=>{
    const runtime={interactions:{approachAndPickup:vi.fn(async()=>({status:'held',targetId:'cup'})),approachAndPlace:vi.fn(async()=>({status:'placed',targetId:'table',supportVerified:true,settled:true}))}};
    const pickup=compileInteractionIntent({id:'pick',actorId:'a',targetId:'cup',capability:'pickup'});
    const place=compileInteractionIntent({id:'place',actorId:'a',supportId:'table',capability:'place'});
    await executeBehaviorCommand(runtime,pickup); await executeBehaviorCommand(runtime,place);
    expect(runtime.interactions.approachAndPickup).toHaveBeenCalledWith('a','cup');
    expect(runtime.interactions.approachAndPlace).toHaveBeenCalledWith('a','table');
  });

  it('compiles and verifies SWITCH as an explicit typed state transition',async()=>{
    const command=compileInteractionIntent({id:'toggle-light',targetId:'light_01',capability:'switch',stateKey:'enabled',value:true});
    expect(command).toMatchObject({capability:'SWITCH',targetId:'light_01',stateKey:'enabled',value:true,effect:{kind:'set-state'}});
    expect(verifyBehaviorCommand(command,{status:'state-transition-applied',targetId:'light_01',stateKey:'enabled',value:true})).toEqual({verified:true});
    const runtime={applyStateTransition:vi.fn(()=>({status:'state-transition-applied',targetId:'light_01',stateKey:'enabled',value:true}))};
    await executeBehaviorCommand(runtime,command); expect(runtime.applyStateTransition).toHaveBeenCalledWith('light_01','enabled',true,{source:'behavior-command',commandId:'interaction:toggle-light'});
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
