import { expect, it, vi } from 'vitest';
import { ToolCallingAgent } from '../src/agent/ToolCallingAgent.js';

it('keeps the full world only before the first mutation and then sends compact task context',async()=>{
  const requests=[];
  const world=Array.from({length:75},(_,i)=>({id:`object_${i}`,asset:'prop',position:[i,0,0],actions:[]}));
  const taskObservation=vi.fn((state)=>({schema:'agentscape.task-observation.v1',state}));
  const tools={
    definitions:()=>[],
    call:vi.fn(async(name)=>name==='listObjects'?world:{status:'action-completed',targetReached:true,settled:true}),
    executionPolicy:vi.fn((name)=>name==='approachAndInteract'
      ? {mutates:true,barrier:true,batchable:false,batchAcceptable:true,outcome:{state:'verified',verified:true,status:'action-completed'}}
      : {mutates:false,barrier:false,batchable:true,batchAcceptable:true,outcome:{state:'accepted',verified:null}}),
    taskObservation,
    recordSequence:vi.fn()
  };
  const gateway={isConfigured:()=>true,complete:vi.fn(async(request)=>{
    requests.push(structuredClone(request));
    if(requests.length===1) return {message:'',toolCalls:[{id:'open',name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}]};
    return {message:'verified',toolCalls:[]};
  })};
  const result=await new ToolCallingAgent({tools,gateway,maxSteps:3}).run('open the cabinet');
  expect(result.taskStatus).toBe('completed');
  expect(requests[0].context.world).toHaveLength(75);
  expect(requests[0].context.task).toMatchObject({schema:'agentscape.task-observation.v1',state:{lastMutation:null,unresolvedMutations:[]}});
  expect(requests[1].context.world.count).toBe(75);
  expect(requests[1].context.world.index).toHaveLength(75);
  expect(requests[1].context.world.index[0]).toEqual({id:'object_0',asset:'prop'});
  expect(requests[1].context.world.index[0]).not.toHaveProperty('position');
  expect(requests[1].context.world.index[0]).not.toHaveProperty('actions');
  expect(requests[1].context.task.state.lastMutation).toMatchObject({
    tool:'approachAndInteract',args:{targetId:'cabinet_01',action:'open'},outcome:{state:'verified'}
  });
  expect(requests[1].context.task.state.unresolvedMutations).toEqual([]);
});
