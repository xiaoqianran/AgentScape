import { describe, expect, it, vi } from 'vitest';
import { HttpLLMGateway, normalizeGatewayResponse } from '../src/agent/gateway/HttpLLMGateway.js';
import { LocalPlannerGateway } from '../src/agent/gateway/LocalPlannerGateway.js';

describe('LLM gateways', () => {
  it('normalizes provider-neutral tool calls', () => {
    expect(normalizeGatewayResponse({ toolCalls: [{ name: 'open', arguments: { id: 'cabinet_01' } }] }).toolCalls[0]).toMatchObject({ name: 'open', args: { id: 'cabinet_01' } });
  });

  it('posts the agent request to a configured gateway', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ final: true, message: 'done' }) }));
    const gateway = new HttpLLMGateway({ endpoint: 'https://gateway.test/agent', fetchImpl });
    const result = await gateway.complete({ messages: [], tools: [] });
    expect(result.message).toBe('done');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('local fallback advances a compound embodied task only after each verified tool result', async () => {
    const gateway=new LocalPlannerGateway();
    const user={role:'user',content:'打开柜门，取出杯子，把杯子放到桌上'};
    const first=await gateway.complete({messages:[user]});
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0]).toMatchObject({name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}});
    const openResult={role:'tool',toolCallId:first.toolCalls[0].id,name:'approachAndInteract',content:JSON.stringify({status:'action-completed',targetReached:true,settled:true,_sequence:{outcome:{state:'verified',verified:true}}})};
    const second=await gateway.complete({messages:[user,openResult]});
    expect(second.toolCalls[0]).toMatchObject({name:'approachAndPickup',args:{actorId:'agent_01',targetId:'cup_01'}});
    const pickupResult={role:'tool',toolCallId:second.toolCalls[0].id,name:'approachAndPickup',content:JSON.stringify({status:'held',_sequence:{outcome:{state:'verified',verified:true}}})};
    const third=await gateway.complete({messages:[user,openResult,pickupResult]});
    expect(third.toolCalls[0]).toMatchObject({name:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'}});
    const placeResult={role:'tool',toolCallId:third.toolCalls[0].id,name:'approachAndPlace',content:JSON.stringify({status:'placed',supportVerified:true,settled:true,_sequence:{outcome:{state:'verified',verified:true}}})};
    const done=await gateway.complete({messages:[user,openResult,pickupResult,placeResult]});
    expect(done).toMatchObject({final:true,toolCalls:[]});
    expect(done.message).toMatch(/验证结果逐步执行完成/);
  });

  it('local fallback stops a dependent sequence after an adverse verified outcome', async () => {
    const gateway=new LocalPlannerGateway();
    const user={role:'user',content:'打开柜门，取出杯子，把杯子放到桌上'};
    const failed={role:'tool',toolCallId:'x',name:'approachAndInteract',content:JSON.stringify({status:'action-failed',reason:'STALL',_sequence:{outcome:{state:'failed',verified:false,reason:'STALL'}}})};
    const result=await gateway.complete({messages:[user,failed]});
    expect(result).toMatchObject({final:true,toolCalls:[]});
    expect(result.message).toMatch(/任务未完成.*STALL/);
  });
});

it('uses one atomic executeBatch for environment-specific coffee-corner scene edits', async () => {
  const gateway=new LocalPlannerGateway({coffeeCorner:{table:[10,1,3],cabinet:[8,1,3]}});
  const result=await gateway.complete({messages:[{role:'user',content:'建立一个咖啡角'}]});
  expect(result.toolCalls).toHaveLength(1);
  expect(result.toolCalls[0]).toMatchObject({name:'executeBatch',args:{calls:[
    {name:'moveObject',args:{id:'table_01',position:[10,1,3]}},
    {name:'moveObject',args:{id:'cabinet_01',position:[8,1,3]}},
    {name:'place',args:{id:'cup_01',targetId:'table_01'}}
  ]}});
});


it('local fallback uses embodied carry tools for pickup/drop language', async () => {
  const gateway=new LocalPlannerGateway();
  const pickup=await gateway.complete({messages:[{role:'user',content:'拿起杯子'}]});
  expect(pickup.toolCalls[0]).toMatchObject({name:'approachAndPickup',args:{actorId:'agent_01',targetId:'cup_01'}});
  const drop=await gateway.complete({messages:[{role:'user',content:'放下杯子'}]});
  expect(drop.toolCalls[0]).toMatchObject({name:'dropHeld',args:{actorId:'agent_01'}});
  const place=await gateway.complete({messages:[{role:'user',content:'把杯子放到桌上'}]});
  expect(place.toolCalls[0]).toMatchObject({name:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01'}});
});



it('local fallback does not confuse two approachAndInteract steps that share a tool name but have different args', async () => {
  const gateway=new LocalPlannerGateway();
  const user={role:'user',content:'先打开柜门，然后关闭柜门'};
  const first=await gateway.complete({messages:[user]});
  expect(first.toolCalls[0]).toMatchObject({name:'approachAndInteract',args:{action:'open'}});
  const assistant={role:'assistant',content:'',toolCalls:first.toolCalls};
  const openResult={role:'tool',toolCallId:first.toolCalls[0].id,name:'approachAndInteract',content:JSON.stringify({status:'action-completed',targetReached:true,settled:true,_sequence:{outcome:{state:'verified',verified:true}}})};
  const second=await gateway.complete({messages:[user,assistant,openResult]});
  expect(second.toolCalls[0]).toMatchObject({name:'approachAndInteract',args:{action:'close'}});
});
