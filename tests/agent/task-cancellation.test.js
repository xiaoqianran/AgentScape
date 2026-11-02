import { expect, it, vi } from 'vitest';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';
import { HttpLLMGateway } from '../../modules/agent/gateway/HttpLLMGateway.js';
import { TaskPanel } from '../../apps/studio/ui/task/TaskPanel.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const makeAgent=(tools,gateway)=>new ToolCallingAgent({tools:{definitions:()=>[],...tools},gateway:{isConfigured:()=>true,...gateway}});

it('aborts an in-flight model request without running its returned mutation',async()=>{
  const request=deferred();
  let receivedSignal;
  const call=vi.fn(async name=>name==='listObjects'?[]:{status:'changed'});
  const agent=makeAgent({call},{complete:vi.fn(async(_request,{signal})=>{receivedSignal=signal;await request.promise;return {toolCalls:[{name:'change',args:{}}]};})});
  const controller=new AbortController();
  const run=agent.run('目标',{signal:controller.signal});
  await vi.waitFor(()=>expect(receivedSignal).toBe(controller.signal));
  controller.abort();request.resolve();
  expect(await run).toMatchObject({taskStatus:'cancelled',execution:[]});
  expect(call.mock.calls.map(([name])=>name)).toEqual(['listObjects']);
});

it('waits for a running tool safe boundary and preserves its verified mutation and held object',async()=>{
  const action=deferred();
  let held=null;
  const call=vi.fn(async name=>{
    if(name==='listObjects')return [{id:'cup_01',heldBy:held}];
    if(name==='pickup'){await action.promise;held='agent_01';return {status:'held'};}
    throw new Error('must not start the next action');
  });
  const complete=vi.fn(async()=>({toolCalls:[{name:'pickup',args:{id:'cup_01'}},{name:'place',args:{}}]}));
  const agent=makeAgent({call,executionPolicy:()=>({mutates:true,barrier:true,outcome:{state:'verified',status:'held'}})},{complete});
  const controller=new AbortController();
  let finished=false;
  const run=agent.run('拿起后放下',{signal:controller.signal}).then(value=>{finished=true;return value;});
  await vi.waitFor(()=>expect(call).toHaveBeenCalledWith('pickup',{id:'cup_01'}));
  controller.abort();await Promise.resolve();expect(finished).toBe(false);
  action.resolve();
  expect(await run).toMatchObject({taskStatus:'cancelled',lastMutation:{tool:'pickup',outcome:{state:'verified'}},execution:[{tool:'pickup',executed:true}]});
  expect(held).toBe('agent_01');expect(complete).toHaveBeenCalledOnce();
  expect(call.mock.calls.map(([name])=>name)).toEqual(['listObjects','pickup']);
});

it('transmits cancellation as a fetch signal without putting it in the model JSON',async()=>{
  const controller=new AbortController();let observed;
  const gateway=new HttpLLMGateway({endpoint:'http://local.test/agent',fetchImpl:vi.fn((_url,options)=>{
    observed=options;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));
  })});
  const result=gateway.complete({messages:[]},{signal:controller.signal});
  controller.abort();await expect(result).rejects.toMatchObject({name:'AbortError'});
  expect(observed.signal.aborted).toBe(true);expect(JSON.parse(observed.body)).toEqual({messages:[]});
});

it('shows cancellation pending until the safe boundary and retries with a new world observation',async()=>{
  const action=deferred();let worldVersion=0;
  const observed=[];
  const agent=makeAgent({call:async name=>{
    if(name==='listObjects'){observed.push(worldVersion);return [];}
    await action.promise;worldVersion++;return {status:'held'};
  },executionPolicy:()=>({mutates:true,barrier:true,outcome:{state:'verified'}})},{complete:vi.fn()
    .mockResolvedValueOnce({toolCalls:[{name:'pickup',args:{}}]})
    .mockResolvedValue({message:'当前世界已观察',toolCalls:[]})});
  const panel=new TaskPanel();panel.attachAgent({agent,gateway:{isConfigured:()=>true}});
  const run=panel.submit('拿起杯子');
  await vi.waitFor(()=>expect(agent.gateway.complete).toHaveBeenCalledOnce());
  await Promise.resolve();
  panel.cancel();expect(panel.snapshot()).toMatchObject({busy:true,status:{state:'cancelling'}});
  action.resolve();await run;
  expect(panel.snapshot()).toMatchObject({busy:false,status:{state:'cancelled'},journey:{result:{label:'已停止'},changes:[{state:'success'}]}});
  await panel.retry();expect(observed).toEqual([0,1]);
});
