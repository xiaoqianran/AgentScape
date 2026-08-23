import { expect, it, vi } from 'vitest';
import { ToolCallingAgent } from '../src/agent/ToolCallingAgent.js';

const policies={
  listObjects:{mutates:false,barrier:false,batchable:true,batchAcceptable:true},
  approachAndInteract:{mutates:true,barrier:true,batchable:false,batchAcceptable:true},
  approachAndPickup:{mutates:true,barrier:true,batchable:false,batchAcceptable:true},
  approachAndPlace:{mutates:true,barrier:true,batchable:false,batchAcceptable:true}
};
const classify=(result)=>{
  const status=result?.status;
  if(status==='action-completed'||status==='held'||status==='placed') return {state:'verified',verified:true,status};
  if(String(status||'').includes('failed')) return {state:'failed',verified:false,status,reason:result.reason};
  if(String(status||'').includes('blocked')) return {state:'blocked',verified:false,status,reason:result.reason};
  if(String(status||'').includes('unverified')) return {state:'unverified',verified:false,status,reason:result.reason};
  return {state:'accepted',verified:null};
};
const makeTools=(results)=>({
  definitions:()=>[],
  call:vi.fn(async(name,args)=>name==='listObjects'?[]:results[name](args)),
  executionPolicy:(name,result)=>({...policies[name],outcome:classify(result)}),
  recordSequence:vi.fn()
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
