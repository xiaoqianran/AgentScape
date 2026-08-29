import { expect, it, vi } from 'vitest';
import { ToolCallingAgent } from '../agent/ToolCallingAgent.js';

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

it('executes a deterministic scripted gateway through the same single Agent planning path',async()=>{
  let round=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'pick',name:'approachAndPickup',args:{actorId:'agent_01',targetId:'cup_01'}}]};
    if(round===2) return {message:'',toolCalls:[{id:'place',name:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'}}]};
    return {message:'done',toolCalls:[]};
  })};
  const tools=makeTools({
    approachAndPickup:async()=>({status:'held'}),
    approachAndPlace:async()=>({status:'placed',supportVerified:true,settled:true})
  });
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:5}).run('先拿起杯子，再放到桌上');
  expect(gateway.complete).toHaveBeenCalledTimes(3);
  expect(tools.call.mock.calls.filter(([name])=>name!=='listObjects').map(([name])=>name)).toEqual([
    'approachAndPickup','approachAndPlace'
  ]);
  expect(result).toMatchObject({taskStatus:'completed',lastMutation:{tool:'approachAndPlace',outcome:{state:'verified'}}});
});



it('blocks an unchanged rejected World IR semantic plan from executing again in the same Agent run',async()=>{
  let round=0,pipelineCalls=0;
  const plan={
    schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-1'},provenance:{source:'test'},intent:{name:'Retry Lab'},
    entities:[{id:'fixture_01',asset:{query:'rare fixture',generate:false}}],spatial:{relations:[]},interactions:[],rules:[],acceptance:[]
  };
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

it('allows revised World IR semantics and lets the verified child resolve the earlier rejected world build',async()=>{
  let round=0,pipelineCalls=0;
  const first={
    schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-1'},provenance:{source:'test'},intent:{name:'Lab'},
    entities:[{id:'fixture_01',asset:{query:'rare fixture',generate:false}}],spatial:{relations:[]},interactions:[],rules:[],acceptance:[]
  };
  const revised=structuredClone(first);
  revised.revision={id:'rev-2',parentId:'rev-1'};
  revised.entities[0].asset.generate=true;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'w1',name:'runWorldPipeline',args:{plan:first}}]};
    if(round===2) return {message:'',toolCalls:[{id:'w2',name:'runWorldPipeline',args:{plan:revised}}]};
    return {message:'world ready',toolCalls:[]};
  })};
  const tools=makeTools({runWorldPipeline:async(args)=>{
    pipelineCalls++;
    return args.plan.entities[0].asset.generate
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


it('gates model final completion on required world acceptance evidence',async()=>{
  let round=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'w',name:'runWorldPipeline',args:{plan:{name:'lab'}}}]};
    return {message:'done',final:true,toolCalls:[]};
  })};
  const runtime={lastAcceptanceBundle:null};
  const tools=makeTools({runWorldPipeline:async()=>{runtime.lastAcceptanceBundle={schema:'agentscape.acceptance-evidence',schemaVersion:1,required:true,result:{status:'world-incomplete',failedCount:1}};return {status:'world-ready'};}});
  tools.runtime=runtime;
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:4}).run('build and verify world');
  expect(result).toMatchObject({taskStatus:'incomplete',message:'Task incomplete: world acceptance is world-incomplete.',acceptanceBundle:{required:true,result:{status:'world-incomplete'}}});
});

it('allows final completion when this task produces accepted evidence without clearing the previously committed bundle first',async()=>{
  let round=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'w',name:'runWorldPipeline',args:{plan:{name:'lab'}}}]};
    return {message:'verified',final:true,toolCalls:[]};
  })};
  const stale={required:true,result:{status:'world-incomplete'}};
  const runtime={lastAcceptanceBundle:stale};
  const tools=makeTools({runWorldPipeline:async()=>{
    expect(runtime.lastAcceptanceBundle).toBe(stale);
    runtime.lastAcceptanceBundle={schema:'agentscape.acceptance-evidence',schemaVersion:1,required:true,result:{status:'world-accepted',failedCount:0}};
    return {status:'world-ready'};
  }});
  tools.runtime=runtime;
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:4}).run('build accepted world');
  expect(result).toMatchObject({taskStatus:'completed',message:'verified',acceptanceBundle:{required:true,result:{status:'world-accepted'}}});
});

it('does not let stale committed world acceptance gate an unrelated task that produces no new acceptance evidence',async()=>{
  let round=0;
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'pick',name:'approachAndPickup',args:{actorId:'agent_01',targetId:'cup_01'}}]};
    return {message:'picked',toolCalls:[]};
  })};
  const stale={schema:'agentscape.acceptance-evidence',schemaVersion:1,required:true,result:{status:'world-incomplete'}};
  const runtime={lastAcceptanceBundle:stale};
  const tools=makeTools({approachAndPickup:async()=>({status:'held'})});
  tools.runtime=runtime;
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:4}).run('pick up the cup');
  expect(result).toMatchObject({taskStatus:'completed',message:'picked'});
  expect(result).not.toHaveProperty('acceptanceBundle');
  expect(runtime.lastAcceptanceBundle).toBe(stale);
});


it('requires a Runtime-issued World IR proposal before Agent execution and forces a fresh planning round',async()=>{
  let round=0;
  const proposalBody={intent:{name:'Lab'},entities:[],spatial:{relations:[]},interactions:[],rules:[],acceptance:[]};
  const issued={schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'world-r1'},provenance:{source:'agent-world-planner'},...proposalBody};
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'bad',name:'runWorldPipeline',args:{plan:{...issued,revision:{id:'forged'}}}}]};
    if(round===2) return {message:'',toolCalls:[
      {id:'proposal',name:'proposeWorldIR',args:{proposal:proposalBody}},
      {id:'premature',name:'runWorldPipeline',args:{plan:issued}}
    ]};
    if(round===3) return {message:'',toolCalls:[{id:'run',name:'runWorldPipeline',args:{plan:issued}}]};
    return {message:'world ready',toolCalls:[]};
  })};
  const tools=makeTools({
    proposeWorldIR:async()=>({status:'world-proposal-ready',worldIR:issued,summary:{worldRevisionId:'world-r1'}}),
    runWorldPipeline:async()=>({status:'world-ready',admission:{status:'ready'}})
  });
  tools.definitions=()=>[{name:'proposeWorldIR'},{name:'runWorldPipeline'}];

  const result=await new ToolCallingAgent({tools,gateway,maxSteps:6}).run('build lab');
  expect(tools.call.mock.calls.filter(([name])=>name!=='listObjects').map(([name])=>name)).toEqual(['proposeWorldIR','runWorldPipeline']);
  expect(result).toMatchObject({taskStatus:'completed',lastMutation:{tool:'runWorldPipeline',outcome:{state:'verified'}}});
  expect(result.execution.find((entry)=>entry.reason==='WORLD_PIPELINE_PROPOSAL_REQUIRED')).toMatchObject({tool:'runWorldPipeline',executed:false});
  expect(result.execution.find((entry)=>entry.reason==='REPLAN_REQUIRED_AFTER_WORLD_PROPOSAL')).toMatchObject({tool:'runWorldPipeline',executed:false});
});

it('skips redundant read-only confirmation after a verified world build but still allows a fresh planning round',async()=>{
  let round=0;
  const plan={schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'world-r1'},provenance:{source:'test'},intent:{name:'Lab'},entities:[],spatial:{relations:[]},interactions:[],rules:[],acceptance:[]};
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'run',name:'runWorldPipeline',args:{plan}}]};
    if(round===2) return {message:'',toolCalls:[
      {id:'space',name:'findFreeSpace',args:{id:'cup',targetId:'table'}},
      {id:'relations',name:'listRelations',args:{}}
    ]};
    return {message:'world ready',toolCalls:[]};
  })};
  const tools=makeTools({runWorldPipeline:async()=>({status:'world-ready',admission:{status:'ready'}})});

  const result=await new ToolCallingAgent({tools,gateway,maxSteps:5}).run('build lab');
  expect(tools.call.mock.calls.filter(([name])=>name!=='listObjects').map(([name])=>name)).toEqual(['runWorldPipeline']);
  expect(result.execution.filter((entry)=>entry.reason==='WORLD_READY_REDUNDANT_READ').map((entry)=>entry.tool)).toEqual(['findFreeSpace','listRelations']);
  expect(result).toMatchObject({taskStatus:'completed',lastMutation:{tool:'runWorldPipeline',outcome:{state:'verified'}}});
});

it('deduplicates World IR by semantic plan rather than Runtime-issued revision identity',async()=>{
  let round=0,pipelineCalls=0;
  const semantic={schema:'agentscape.world-ir',schemaVersion:1,intent:{name:'Lab'},entities:[],spatial:{relations:[]},interactions:[],rules:[],acceptance:[]};
  const first={...semantic,revision:{id:'world-r1'},provenance:{source:'agent-world-planner'}};
  const second={...structuredClone(semantic),revision:{id:'world-r2'},provenance:{source:'agent-world-planner'}};
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'w1',name:'runWorldPipeline',args:{plan:first}}]};
    if(round===2) return {message:'',toolCalls:[{id:'w2',name:'runWorldPipeline',args:{plan:second}}]};
    return {message:'cannot retry unchanged semantics',toolCalls:[]};
  })};
  const tools=makeTools({runWorldPipeline:async()=>{pipelineCalls++;return {status:'world-rejected',reason:'ASSET_UNRESOLVED'};}});
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:5}).run('build lab');
  expect(pipelineCalls).toBe(1);
  expect(result.execution.find((entry)=>entry.reason==='WORLD_PIPELINE_PLAN_ALREADY_ATTEMPTED')).toMatchObject({executed:false});
});

it('carries rejected World IR revision and finding evidence into the next Runtime-issued proposal',async()=>{
  let round=0;
  const firstBody={intent:{name:'Lab v1'},entities:[],spatial:{relations:[]},interactions:[],rules:[],acceptance:[]};
  const secondBody={intent:{name:'Lab v2'},entities:[],spatial:{relations:[]},interactions:[],rules:[],acceptance:[]};
  const first={schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'world-r1'},provenance:{source:'agent-world-planner'},...firstBody};
  const second={schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'world-r2',parentId:'world-r1',reason:'ASSET_UNRESOLVED'},provenance:{source:'agent-world-planner',evidenceRefs:['finding-1','retry-1']},...secondBody};
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'p1',name:'proposeWorldIR',args:{proposal:firstBody}}]};
    if(round===2) return {message:'',toolCalls:[{id:'w1',name:'runWorldPipeline',args:{plan:first}}]};
    if(round===3) return {message:'',toolCalls:[{id:'p2',name:'proposeWorldIR',args:{proposal:secondBody}}]};
    return {message:'revised proposal prepared',toolCalls:[]};
  })};
  const contexts=[];
  const tools=makeTools({});
  tools.definitions=()=>[{name:'proposeWorldIR'},{name:'runWorldPipeline'}];
  tools.call=vi.fn(async(name,args,context={})=>{
    if(name==='listObjects') return [];
    if(name==='proposeWorldIR'){
      contexts.push(structuredClone(context));
      return contexts.length===1
        ? {status:'world-proposal-ready',worldIR:first,summary:{worldRevisionId:'world-r1'}}
        : {status:'world-proposal-ready',worldIR:second,summary:{worldRevisionId:'world-r2'}};
    }
    if(name==='runWorldPipeline') return {
      status:'world-rejected',reason:'ASSET_UNRESOLVED',admission:{status:'rejected',reasons:['ASSET_UNRESOLVED']},
      pipeline:{state:{artifacts:{revisionContext:{findingIds:['finding-1']}}}},
      attempts:[{retry:{findings:[{id:'retry-1'}]}}]
    };
    throw new Error(`unexpected tool ${name}`);
  });

  const result=await new ToolCallingAgent({tools,gateway,maxSteps:5}).run('build then revise lab');
  expect(contexts).toEqual([
    {},
    {worldProposalLineage:{parentRevisionId:'world-r1',reason:'ASSET_UNRESOLVED',evidenceRefs:['finding-1','retry-1']}}
  ]);
  expect(result.taskStatus).toBe('incomplete');
  expect(result.unresolvedMutations).toHaveLength(1);
});


it('requires a Runtime-issued bounded revision proposal, rejects tampering, and resolves the base rejected world only after verified recompile',async()=>{
  let round=0;
  const semantic={intent:{name:'Repair Lab'},entities:[{id:'box',asset:{assetId:'crate'},transform:{position:[0,0,0]}}],spatial:{relations:[]},interactions:[],rules:[],acceptance:[]};
  const worldIR={schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'world-r1'},provenance:{source:'agent-world-planner'},...semantic};
  const revisionContext={
    schema:'agentscape.world-revision-context',schemaVersion:1,baseRevisionId:'world-r1',findingIds:['finding-1'],findings:[],
    affected:{seedEntityIds:['box'],contextEntityIds:['box'],editableEntityIds:['box'],missingEntityIds:[]},
    subgraph:{entities:[{id:'box',asset:{assetId:'crate',query:'crate',generate:false},transform:{position:[0,0,0]},capabilityIntent:[],initialState:{}}],spatial:{relations:[],constraints:[]},interactions:[],acceptance:[]},rulesReviewRequired:false
  };
  const revisionProposal={
    schema:'agentscape.world-revision-proposal',schemaVersion:1,status:'changed-plan-required',baseRevisionId:'world-r1',nextRevisionId:'world-r2',
    findingIds:['finding-1'],affectedEntityIds:['box'],reason:'lift box',edits:[{kind:'set-position',entityId:'box',position:[0,.2,0]}]
  };
  const gateway={isConfigured:()=>true,complete:vi.fn(async()=>{
    round++;
    if(round===1) return {message:'',toolCalls:[{id:'p1',name:'proposeWorldIR',args:{proposal:semantic}}]};
    if(round===2) return {message:'',toolCalls:[{id:'w1',name:'runWorldPipeline',args:{plan:worldIR}}]};
    if(round===3) return {message:'',toolCalls:[{id:'rp',name:'proposeWorldRevision',args:{request:{reason:'lift box',edits:[{kind:'set-position',entityId:'box',position:[0,.2,0]}]}}}]};
    if(round===4) return {message:'',toolCalls:[{id:'tamper',name:'recompileWorldRevision',args:{proposal:{...revisionProposal,affectedEntityIds:['box','other']},acceptChangedPlan:true}}]};
    if(round===5) return {message:'',toolCalls:[{id:'rc',name:'recompileWorldRevision',args:{proposal:revisionProposal,acceptChangedPlan:true}}]};
    return {message:'world repaired',toolCalls:[]};
  })};
  const contexts=[];
  const tools=makeTools({});
  tools.definitions=()=>[
    {name:'proposeWorldIR'},{name:'runWorldPipeline'},{name:'proposeWorldRevision'},{name:'recompileWorldRevision'}
  ];
  tools.executionPolicy=(name,result)=>({
    mutates:['runWorldPipeline','recompileWorldRevision'].includes(name),
    barrier:['runWorldPipeline','recompileWorldRevision'].includes(name),batchable:false,batchAcceptable:true,
    outcome:classify(result)
  });
  tools.call=vi.fn(async(name,args,context)=>{
    if(name==='listObjects') return [];
    if(name==='proposeWorldIR') return {status:'world-proposal-ready',worldIR,summary:{worldRevisionId:'world-r1'}};
    if(name==='runWorldPipeline') return {
      status:'world-rejected',reason:'VALIDATION_HARD',admission:{status:'rejected',reasons:['VALIDATION_HARD']},
      pipeline:{state:{artifacts:{worldIR,revisionContext}}}
    };
    if(name==='proposeWorldRevision'){
      contexts.push({name,context:structuredClone(context)});
      return {status:'world-revision-proposal-ready',proposal:revisionProposal};
    }
    if(name==='recompileWorldRevision'){
      contexts.push({name,context:structuredClone(context)});
      return {status:'world-ready',admission:{status:'ready'},worldIR:{...worldIR,revision:{id:'world-r2',parentId:'world-r1'}},pipeline:{state:{reports:{worldAdmission:{status:'ready'}}}}};
    }
    throw new Error(`unexpected tool ${name}`);
  });

  const result=await new ToolCallingAgent({tools,gateway,maxSteps:7}).run('build and repair lab');
  expect(result.execution.find((entry)=>entry.reason==='WORLD_REVISION_PROPOSAL_TAMPERED')).toMatchObject({tool:'recompileWorldRevision',executed:false});
  expect(contexts[0]).toMatchObject({name:'proposeWorldRevision',context:{worldRevisionRepair:{baseWorldIR:{revision:{id:'world-r1'}},revisionContext:{baseRevisionId:'world-r1',affected:{editableEntityIds:['box']}}}}});
  expect(contexts[1]).toMatchObject({name:'recompileWorldRevision',context:{worldRevisionBaseIR:{revision:{id:'world-r1'}}}});
  expect(tools.call.mock.calls.filter(([name])=>name==='recompileWorldRevision')).toHaveLength(1);
  expect(result).toMatchObject({taskStatus:'completed',unresolvedMutations:[],lastMutation:{tool:'recompileWorldRevision',outcome:{state:'verified'}}});
});
