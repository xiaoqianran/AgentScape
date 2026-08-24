import { expect, it, vi } from 'vitest';
import { ToolCallingAgent } from '../src/agent/ToolCallingAgent.js';

const policies={
  listObjects:{mutates:false,barrier:false,batchable:true,batchAcceptable:true},
  approachAndInteract:{mutates:true,barrier:true,batchable:false,batchAcceptable:true},
  approachAndPickup:{mutates:true,barrier:true,batchable:false,batchAcceptable:true},
  approachAndPlace:{mutates:true,barrier:true,batchable:false,batchAcceptable:true},
  runWorldPipeline:{mutates:true,barrier:true,batchable:false,batchAcceptable:true}
};
const classify=(result)=>{
  const status=result?.status;
  if(status==='action-completed'||status==='held'||status==='placed'||status==='world-ready') return {state:'verified',verified:true,status};
  if(status==='world-provisional') return {state:'unverified',verified:false,status,reason:'WORLD_PROVISIONAL'};
  if(status==='world-rejected') return {state:'failed',verified:false,status,reason:result.reason || 'WORLD_REJECTED'};
  if(String(status||'').includes('failed')) return {state:'failed',verified:false,status,reason:result.reason};
  if(String(status||'').includes('blocked')) return {state:'blocked',verified:false,status,reason:result.reason};
  if(String(status||'').includes('unverified')) return {state:'unverified',verified:false,status,reason:result.reason};
  return {state:'accepted',verified:null};
};
const makeTools=(results,policyOverrides={})=>({
  definitions:()=>[],
  call:vi.fn(async(name,args)=>name==='listObjects'?[]:results[name](args)),
  executionPolicy:(name,result)=>({...policies[name],...policyOverrides[name],outcome:classify(result)}),
  recordSequence:vi.fn()
});

it('uses the deterministic fallback planner for preset tasks even when a remote gateway is configured',async()=>{
  const remote={isConfigured:()=>true,complete:vi.fn(async()=>({
    message:'',toolCalls:[{id:'wrong',name:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'}}]
  }))};
  let round=0;
  const fallback={complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'pick',name:'approachAndPickup',args:{actorId:'agent_01',targetId:'cup_01'}}]};
    if(round===2) return {message:'',toolCalls:[{id:'place',name:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'}}]};
    return {message:'done',toolCalls:[]};
  })};
  const tools=makeTools({
    approachAndPickup:async()=>({status:'held'}),
    approachAndPlace:async()=>({status:'placed',supportVerified:true,settled:true})
  });
  const result=await new ToolCallingAgent({tools,gateway:remote,fallbackGateway:fallback,maxSteps:5})
    .run('先拿起杯子，再放到桌上', {forceFallback:true});
  expect(remote.complete).not.toHaveBeenCalled();
  expect(fallback.complete).toHaveBeenCalledTimes(3);
  expect(tools.call.mock.calls.filter(([name])=>name!=='listObjects').map(([name])=>name)).toEqual([
    'approachAndPickup','approachAndPlace'
  ]);
  expect(result).toMatchObject({taskStatus:'completed',lastMutation:{tool:'approachAndPlace',outcome:{state:'verified'}}});
});



it('blocks an unchanged rejected WorldSpec from executing again in the same Agent run',async()=>{
  let round=0,pipelineCalls=0;
  const plan={name:'Retry Lab',assets:[{id:'fixture_01',query:'rare fixture'}]};
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'w1',name:'runWorldPipeline',args:{plan}}]};
    if(round===2) return {message:'',toolCalls:[{id:'w2',name:'runWorldPipeline',args:{plan:structuredClone(plan)}}]};
    return {message:'cannot retry unchanged',toolCalls:[]};
  })};
  const tools=makeTools({runWorldPipeline:async()=>{pipelineCalls++;return {status:'world-rejected',reason:'ASSET_UNRESOLVED',retry:{status:'exhausted'}};}});
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:5}).run('build retry lab');
  expect(pipelineCalls).toBe(1);
  expect(result.taskStatus).toBe('incomplete');
  expect(result.unresolvedMutations).toHaveLength(1);
  expect(result.execution.find((entry)=>entry.reason==='WORLD_PIPELINE_PLAN_ALREADY_ATTEMPTED')).toMatchObject({tool:'runWorldPipeline',executed:false,outcome:{state:'skipped'}});
});

it('allows a revised WorldSpec and lets its verified result resolve the earlier rejected world build',async()=>{
  let round=0,pipelineCalls=0;
  const first={name:'Lab',assets:[{id:'fixture_01',query:'rare fixture'}]};
  const revised={name:'Lab',assets:[{id:'fixture_01',query:'rare fixture',generate:true}]};
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'w1',name:'runWorldPipeline',args:{plan:first}}]};
    if(round===2) return {message:'',toolCalls:[{id:'w2',name:'runWorldPipeline',args:{plan:revised}}]};
    return {message:'world ready',toolCalls:[]};
  })};
  const tools=makeTools({runWorldPipeline:async(args)=>{
    pipelineCalls++;
    return args.plan.assets[0].generate
      ? {status:'world-ready',admission:{status:'ready'}}
      : {status:'world-rejected',reason:'ASSET_UNRESOLVED',retry:{status:'not-retriable'}};
  }});
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:5}).run('build lab');
  expect(pipelineCalls).toBe(2);
  expect(result).toMatchObject({taskStatus:'completed',unresolvedMutations:[],lastMutation:{tool:'runWorldPipeline',outcome:{state:'verified'}}});
  const events=tools.recordSequence.mock.calls.map(([payload])=>payload).filter((payload)=>payload.tool==='runWorldPipeline'&&payload.executed);
  expect(events).toHaveLength(2);
  expect(events[0].identity).toBe('runWorldPipeline:{}');
  expect(events[1].identity).toBe('runWorldPipeline:{}');
});

it('executes only the first mutation in a planner turn and returns protocol-complete not-executed results for the rest',async()=>{
  const requests=[];
  const gateway={isConfigured:()=>true,complete:vi.fn(async(request)=>{
    requests.push(structuredClone(request));
    if(requests.length===1) return {message:'',toolCalls:[
      {id:'open',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}},
      {id:'pick',name:'approachAndPickup',args:{actorId:'agent_01',targetId:'cup_01'}},
      {id:'place',name:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'}}
    ]};
    return {message:'stopped after failure',final:true,toolCalls:[]};
  })};
  const tools=makeTools({
    approachAndInteract:async()=>({status:'action-failed',reason:'STALL',targetReached:false,settled:false}),
    approachAndPickup:async()=>({status:'held'}),
    approachAndPlace:async()=>({status:'placed',supportVerified:true,settled:true})
  });
  const agent=new ToolCallingAgent({tools,gateway,maxSteps:4});
  const result=await agent.run('open, then pick up, then place');
  expect(tools.call.mock.calls.filter(([name])=>name!=='listObjects').map(([name])=>name)).toEqual(['approachAndInteract']);
  const toolMessages=requests[1].messages.filter((m)=>m.role==='tool');
  expect(toolMessages).toHaveLength(3);
  expect(JSON.parse(toolMessages[0].content)).toMatchObject({status:'action-failed',_sequence:{outcome:{state:'failed'},replanRequired:true}});
  expect(JSON.parse(toolMessages[1].content)).toMatchObject({status:'not-executed',reason:'REPLAN_REQUIRED_AFTER_WORLD_CHANGE',afterTool:'approachAndInteract'});
  expect(JSON.parse(toolMessages[2].content)).toMatchObject({status:'not-executed',reason:'REPLAN_REQUIRED_AFTER_WORLD_CHANGE'});
  expect(result).toMatchObject({taskStatus:'incomplete',lastMutation:{tool:'approachAndInteract',outcome:{state:'failed'}}});
  expect(result.execution.filter((entry)=>!entry.executed)).toHaveLength(2);
});

it('forces a fresh planning round after every verified mutation before allowing the next dependent step',async()=>{
  const requests=[];
  const gateway={isConfigured:()=>true,complete:vi.fn(async(request)=>{
    requests.push(structuredClone(request));
    if(requests.length===1) return {message:'',toolCalls:[
      {id:'o1',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}},
      {id:'p1',name:'approachAndPickup',args:{actorId:'agent_01',targetId:'cup_01'}},
      {id:'x1',name:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'}}
    ]};
    if(requests.length===2) return {message:'',toolCalls:[
      {id:'p2',name:'approachAndPickup',args:{actorId:'agent_01',targetId:'cup_01'}},
      {id:'x2',name:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'}}
    ]};
    if(requests.length===3) return {message:'',toolCalls:[{id:'x3',name:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'}}]};
    return {message:'done',final:true,toolCalls:[]};
  })};
  const tools=makeTools({
    approachAndInteract:async()=>({status:'action-completed',targetReached:true,settled:true}),
    approachAndPickup:async()=>({status:'held',graspVerified:false}),
    approachAndPlace:async()=>({status:'placed',supportVerified:true,settled:true})
  });
  const agent=new ToolCallingAgent({tools,gateway,maxSteps:6});
  const result=await agent.run('open, pick up, place');
  expect(tools.call.mock.calls.filter(([name])=>name!=='listObjects').map(([name])=>name)).toEqual(['approachAndInteract','approachAndPickup','approachAndPlace']);
  expect(result).toMatchObject({message:'done',taskStatus:'completed',lastMutation:{tool:'approachAndPlace',outcome:{state:'verified'}}});
  expect(result.execution.filter((entry)=>entry.executed&&entry.mutates).map((entry)=>entry.tool)).toEqual(['approachAndInteract','approachAndPickup','approachAndPlace']);
  expect(result.execution.filter((entry)=>!entry.executed).map((entry)=>entry.tool)).toEqual(['approachAndPickup','approachAndPlace','approachAndPlace']);
});


it('keeps an earlier adverse mutation unresolved even if the model incorrectly advances to a later successful mutation',async()=>{
  let round=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'o',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}]};
    if(round===2) return {message:'',toolCalls:[{id:'p',name:'approachAndPickup',args:{actorId:'agent_01',targetId:'cup_01'}}]};
    return {message:'done',final:true,toolCalls:[]};
  })};
  const tools=makeTools({
    approachAndInteract:async()=>({status:'action-failed',reason:'STALL'}),
    approachAndPickup:async()=>({status:'held'})
  });
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:5}).run('open then pickup');
  expect(result.lastMutation).toMatchObject({tool:'approachAndPickup',outcome:{state:'verified'}});
  expect(result.taskStatus).toBe('incomplete');
  expect(result.unresolvedMutations).toHaveLength(1);
  expect(result.unresolvedMutations[0]).toMatchObject({tool:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'},outcome:{state:'failed',reason:'STALL'}});
});

it('clears an unresolved mutation only when the same semantic step later verifies',async()=>{
  let round=0, attempts=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round<=2) return {message:'',toolCalls:[{id:`o${round}`,name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}]};
    return {message:'recovered',final:true,toolCalls:[]};
  })};
  const tools=makeTools({approachAndInteract:async()=>++attempts===1?{status:'action-failed',reason:'STALL'}:{status:'action-completed',targetReached:true,settled:true}});
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:5}).run('open');
  expect(result).toMatchObject({taskStatus:'completed',unresolvedMutations:[]});
  expect(result.execution.filter((entry)=>entry.executed&&entry.tool==='approachAndInteract')).toHaveLength(2);
});


it('terminates safely as incomplete at the planning limit when an adverse mutation remains unresolved',async()=>{
  let round=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'o',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}]};
    return {message:'',toolCalls:[{id:`r${round}`,name:'listObjects',args:{}}]};
  })};
  const tools=makeTools({approachAndInteract:async()=>({status:'action-failed',reason:'STALL'})});
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:3}).run('open then continue only if verified');
  expect(result).toMatchObject({taskStatus:'incomplete',termination:'planning-limit',steps:3});
  expect(result.unresolvedMutations).toHaveLength(1);
  expect(result.unresolvedMutations[0]).toMatchObject({tool:'approachAndInteract',outcome:{state:'failed',reason:'STALL'}});
  expect(tools.recordSequence).toHaveBeenCalledWith(expect.objectContaining({termination:'planning-limit',unresolved:1}));
});

it('normalizes an implicit articulated Part from the Runtime result so an explicit retry resolves the same mutation identity',async()=>{
  let round=0,attempt=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'o1',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}]};
    if(round===2) return {message:'',toolCalls:[{id:'o2',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'}}]};
    return {message:'recovered',toolCalls:[]};
  })};
  const tools=makeTools({approachAndInteract:async()=>++attempt===1
    ? {status:'action-failed',reason:'STALL',interaction:{part:'door'}}
    : {status:'action-completed',targetReached:true,settled:true,interaction:{part:'door'}}});
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:5}).run('open the cabinet door');
  expect(result).toMatchObject({taskStatus:'completed',unresolvedMutations:[]});
  const mutations=result.execution.filter((entry)=>entry.executed&&entry.tool==='approachAndInteract');
  expect(mutations).toHaveLength(2);
  const sequenceCalls=tools.recordSequence.mock.calls.map(([payload])=>payload).filter((payload)=>payload.identity);
  expect(sequenceCalls[0].identity).toBe(sequenceCalls[1].identity);
  expect(sequenceCalls[0].identity).toContain('"partName":"door"');
});

it('bounds read-only recovery loops while preserving the unresolved mutation ledger',async()=>{
  let round=0;
  const requests=[];
  const gateway={isConfigured:()=>true,complete:vi.fn(async(request)=>{
    requests.push(structuredClone(request));
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'o',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}]};
    return {message:'',toolCalls:[{id:`r${round}`,name:'listObjects',args:{}}]};
  })};
  const tools=makeTools({approachAndInteract:async()=>({status:'action-failed',reason:'STALL',interaction:{part:'door'}})});
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:10,maxRecoveryReadRounds:2}).run('open; diagnose if blocked');
  expect(result).toMatchObject({taskStatus:'incomplete',termination:'recovery-observation-limit',steps:4});
  expect(result.unresolvedMutations).toHaveLength(1);
  expect(result.unresolvedMutations[0]).toMatchObject({tool:'approachAndInteract',outcome:{state:'failed',reason:'STALL'}});
  expect(requests[1].context.recovery).toEqual({readOnlyRoundsUsed:0,readOnlyRoundsRemaining:2});
  expect(requests[2].context.recovery).toEqual({readOnlyRoundsUsed:1,readOnlyRoundsRemaining:1});
  expect(requests[3].context.recovery).toEqual({readOnlyRoundsUsed:2,readOnlyRoundsRemaining:0});
  expect(tools.recordSequence).toHaveBeenCalledWith(expect.objectContaining({termination:'recovery-observation-limit',recoveryReadRounds:2,unresolved:1}));
  expect(result.execution.filter((entry)=>entry.reason==='RECOVERY_OBSERVATION_LIMIT')).toHaveLength(1);
});



it('does not let an auxiliary recovery failure become a new unresolved user subgoal, while the original failure remains until retry verifies',async()=>{
  let round=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'o1',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'}}]};
    if(round===2) return {message:'',toolCalls:[{id:'r',name:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'blocker_01'}}]};
    if(round===3) return {message:'',toolCalls:[{id:'o2',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'}}]};
    return {message:'verified',toolCalls:[]};
  })};
  let openAttempt=0;
  const tools=makeTools({
    approachAndInteract:async()=>++openAttempt===1?{status:'action-failed',reason:'STALL',partName:'door'}:{status:'action-completed',targetReached:true,settled:true,partName:'door'},
    recoverPickupBlocker:async()=>({status:'pickup-blocked',reason:'APPROACH_FAILED'})
  },{
    recoverPickupBlocker:{mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false}
  });
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:6}).run('open with recovery if needed');
  expect(result).toMatchObject({taskStatus:'completed',unresolvedMutations:[]});
  expect(result.execution.filter((entry)=>entry.tool==='recoverPickupBlocker')[0]).toMatchObject({auxiliary:true,outcome:{state:'blocked',reason:'APPROACH_FAILED'}});
});



it('keeps the original mutation unresolved when an auxiliary recovery verifies but the original action is never retried',async()=>{
  let round=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'o',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'}}]};
    if(round===2) return {message:'',toolCalls:[{id:'r',name:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'blocker_01'}}]};
    return {message:'blocker recovered',toolCalls:[]};
  })};
  const tools=makeTools({
    approachAndInteract:async()=>({status:'action-failed',reason:'STALL',partName:'door'}),
    recoverPickupBlocker:async()=>({status:'held',targetId:'blocker_01',recovery:{kind:'pickup-blocker'},retryOriginal:true})
  },{
    recoverPickupBlocker:{mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false}
  });
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:5}).run('open with recovery');
  expect(result.taskStatus).toBe('incomplete');
  expect(result.lastMutation).toMatchObject({tool:'recoverPickupBlocker',outcome:{state:'verified'}});
  expect(result.unresolvedMutations).toHaveLength(1);
  expect(result.unresolvedMutations[0]).toMatchObject({tool:'approachAndInteract',outcome:{state:'failed',reason:'STALL'}});
});



it('includes blockerId in auxiliary recovery identity for audit separation',async()=>{
  const calls=[];
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    if(!calls.length) return {message:'',toolCalls:[{id:'r',name:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'blocker_02'}}]};
    return {message:'done',toolCalls:[]};
  })};
  const tools=makeTools({recoverPickupBlocker:async()=>{calls.push(1);return {status:'held',targetId:'blocker_02'};}},{
    recoverPickupBlocker:{mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false}
  });
  await new ToolCallingAgent({tools,gateway,maxSteps:3}).run('recover blocker');
  const event=tools.recordSequence.mock.calls.map(([payload])=>payload).find((payload)=>payload.identity);
  expect(event.identity).toContain('\"blockerId\":\"blocker_02\"');
});

it('skips a duplicate verified auxiliary recovery until the original failed mutation is retried',async()=>{
  let round=0,openAttempt=0,recoveryCalls=0;
  const requests=[];
  const gateway={isConfigured:()=>true,complete:vi.fn(async(request)=>{
    requests.push(structuredClone(request));
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'o1',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}]};
    if(round===2) return {message:'',toolCalls:[{id:'r1',name:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'blocker_01'}}]};
    if(round===3) return {message:'',toolCalls:[{id:'r2',name:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',blockerId:'blocker_01'}}]};
    if(round===4) return {message:'',toolCalls:[{id:'o2',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'}}]};
    return {message:'verified',toolCalls:[]};
  })};
  const tools=makeTools({
    approachAndInteract:async()=>++openAttempt===1
      ? {status:'action-failed',reason:'STALL',partName:'door'}
      : {status:'action-completed',targetReached:true,settled:true,partName:'door'},
    recoverPickupBlocker:async()=>{recoveryCalls++;return {status:'held',targetId:'blocker_01'};}
  },{
    recoverPickupBlocker:{mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false}
  });
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:7}).run('open with one blocker recovery');
  expect(result).toMatchObject({taskStatus:'completed',unresolvedMutations:[]});
  expect(recoveryCalls).toBe(1);
  expect(tools.call.mock.calls.filter(([name])=>name!=='listObjects').map(([name])=>name)).toEqual([
    'approachAndInteract','recoverPickupBlocker','approachAndInteract'
  ]);
  const duplicate=result.execution.find((entry)=>entry.reason==='RECOVERY_ALREADY_APPLIED');
  expect(duplicate).toMatchObject({
    tool:'recoverPickupBlocker',executed:false,auxiliary:true,outcome:{state:'skipped'},
    recoveryOf:expect.stringContaining('approachAndInteract:')
  });
  const duplicateMessage=requests[3].messages.find((message)=>message.role==='tool'&&message.toolCallId==='r2');
  expect(JSON.parse(duplicateMessage.content)).toMatchObject({
    status:'not-executed',reason:'RECOVERY_ALREADY_APPLIED',
    instruction:expect.stringContaining('Retry the original failed mutation')
  });
  expect(tools.recordSequence).toHaveBeenCalledWith(expect.objectContaining({
    tool:'recoverPickupBlocker',executed:false,reason:'RECOVERY_ALREADY_APPLIED',replanRequired:true
  }));
});

it('allows the same auxiliary recovery again after the original mutation is retried and produces new failure evidence',async()=>{
  let round=0,recoveryCalls=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'o1',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'}}]};
    if(round===2) return {message:'',toolCalls:[{id:'r1',name:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'blocker_01'}}]};
    if(round===3) return {message:'',toolCalls:[{id:'o2',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'}}]};
    if(round===4) return {message:'',toolCalls:[{id:'r2',name:'recoverPickupBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'blocker_01'}}]};
    return {message:'still blocked',toolCalls:[]};
  })};
  const tools=makeTools({
    approachAndInteract:async()=>({status:'action-failed',reason:'STALL',partName:'door'}),
    recoverPickupBlocker:async()=>{recoveryCalls++;return {status:'held',targetId:'blocker_01'};}
  },{
    recoverPickupBlocker:{mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false}
  });
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:7}).run('retry recovery after new stall evidence');
  expect(recoveryCalls).toBe(2);
  expect(result.taskStatus).toBe('incomplete');
  expect(result.unresolvedMutations).toHaveLength(1);
  expect(result.execution.filter((entry)=>entry.tool==='recoverPickupBlocker'&&entry.executed)).toHaveLength(2);
  expect(result.execution.some((entry)=>entry.reason==='RECOVERY_ALREADY_APPLIED')).toBe(false);
});



it('skips duplicate verified cleanup within the same original failure evidence epoch',async()=>{
  let round=0,cleanupCalls=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'o',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open',partName:'door'}}]};
    if(round===2) return {message:'',toolCalls:[{id:'c1',name:'cleanupRecoveryBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',partName:'door',blockerId:'blocker_01',action:'open'}}]};
    if(round===3) return {message:'',toolCalls:[{id:'c2',name:'cleanupRecoveryBlocker',args:{actorId:'agent_01',targetId:'cabinet_01',blockerId:'blocker_01',action:'open'}}]};
    return {message:'cleanup done but open still unresolved',toolCalls:[]};
  })};
  const tools=makeTools({
    approachAndInteract:async()=>({status:'action-failed',reason:'STALL',partName:'door'}),
    cleanupRecoveryBlocker:async()=>{cleanupCalls++;return {status:'recovery-cleaned',released:true,settled:true,sweepClear:true,contactClear:true};}
  },{
    cleanupRecoveryBlocker:{mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false}
  });
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:6}).run('open and cleanup if needed');
  expect(cleanupCalls).toBe(1);
  expect(result.taskStatus).toBe('incomplete');
  expect(result.unresolvedMutations).toHaveLength(1);
  expect(result.execution.find((entry)=>entry.reason==='RECOVERY_ALREADY_APPLIED')).toMatchObject({
    tool:'cleanupRecoveryBlocker',executed:false,auxiliary:true,outcome:{state:'skipped'}
  });
});



it('keeps articulated blocker recovery auxiliary and blocks a duplicate until the original mutation is retried',async()=>{
  let round=0,openAttempt=0,recoveryCalls=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'o1',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_A',action:'open',partName:'door'}}]};
    if(round===2) return {message:'',toolCalls:[{id:'r1',name:'recoverArticulatedBlocker',args:{actorId:'agent_01',targetId:'cabinet_A',partName:'door',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'}}]};
    if(round===3) return {message:'',toolCalls:[{id:'r2',name:'recoverArticulatedBlocker',args:{actorId:'agent_01',targetId:'cabinet_A',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'}}]};
    if(round===4) return {message:'',toolCalls:[{id:'o2',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_A',action:'open',partName:'door'}}]};
    return {message:'verified',toolCalls:[]};
  })};
  const tools=makeTools({
    approachAndInteract:async()=>++openAttempt===1
      ? {status:'action-failed',reason:'STALL',partName:'door'}
      : {status:'action-completed',targetReached:true,settled:true,partName:'door'},
    recoverArticulatedBlocker:async()=>{recoveryCalls++;return {status:'action-completed',targetReached:true,settled:true,partName:'door',recovery:{kind:'articulated-blocker'}};}
  },{
    recoverArticulatedBlocker:{mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false}
  });
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:7}).run('open A; recover articulated blocker B if needed');
  expect(result).toMatchObject({taskStatus:'completed',unresolvedMutations:[]});
  expect(recoveryCalls).toBe(1);
  expect(result.execution.find((entry)=>entry.reason==='RECOVERY_ALREADY_APPLIED')).toMatchObject({
    tool:'recoverArticulatedBlocker',executed:false,auxiliary:true,outcome:{state:'skipped'}
  });
  const recovery=result.execution.find((entry)=>entry.tool==='recoverArticulatedBlocker'&&entry.executed);
  expect(recovery).toMatchObject({auxiliary:true,recoveryOf:expect.stringContaining('cabinet_A'),outcome:{state:'verified'}});
  expect(result.execution.filter((entry)=>entry.executed&&entry.mutates).map((entry)=>entry.tool)).toEqual([
    'approachAndInteract','recoverArticulatedBlocker','approachAndInteract'
  ]);
  const event=tools.recordSequence.mock.calls.map(([payload])=>payload).find((payload)=>payload.tool==='recoverArticulatedBlocker'&&payload.executed===true);
  expect(event.identity).toContain('\"blockerId\":\"cabinet_B\"');
  expect(event.identity).toContain('\"blockerPartName\":\"door\"');
  expect(event.identity).toContain('\"blockerAction\":\"close\"');
});
