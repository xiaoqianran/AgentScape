import { expect, it, vi } from 'vitest';
import { ToolCallingAgent } from '../../agent/ToolCallingAgent.js';

it('carries assistant toolCalls into the next provider-neutral planning round', async () => {
  const requests=[];
  const gateway={
    isConfigured:()=>true,
    complete:vi.fn(async(request)=>{
      requests.push(structuredClone(request));
      if(requests.length===1) return { message:'', final:false, toolCalls:[{id:'call_1',name:'listObjects',args:{}}] };
      return { message:'done', final:true, toolCalls:[] };
    })
  };
  const tools={definitions:()=>[{name:'listObjects',description:'list',parameters:{type:'object',properties:{}}}],call:vi.fn(async()=>[{id:'agent_01'}])};
  const agent=new ToolCallingAgent({tools,gateway});
  await expect(agent.run('inspect')).resolves.toMatchObject({message:'done',steps:2});
  expect(requests[1].messages).toEqual(expect.arrayContaining([
    {role:'assistant',content:'',toolCalls:[{id:'call_1',name:'listObjects',args:{}}]},
    {role:'tool',toolCallId:'call_1',name:'listObjects',content:'[{"id":"agent_01"}]'}
  ]));
});
