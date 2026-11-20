import {describe,it,expect,afterEach} from 'vitest';
import {createAgentHost} from '../../apps/agent-host/AgentHost.mjs';

const ORIGIN='http://localhost:5173';
const configuration={baseUrl:'https://test.invalid/v1',apiKey:'test',modelId:'test',
  mcpToken:'z'.repeat(32),dshPatch:'C:/approved/restricted.yml',dshProvider:'test',dshModel:'test'};
const active=[];
afterEach(async()=>{while(active.length)await active.pop().close();});
async function setup(backends){
  const host=createAgentHost({config:configuration,port:0,backends});
  const address=await host.listen();active.push(host);
  return 'http://127.0.0.1:'+address.port;
}
const json=(url,path,body,origin=ORIGIN)=>fetch(url+path,{
  method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)
});
describe('dual agent host transport',()=>{
  it('rejects foreign origins and does not leak model keys in health',async()=>{
    const url=await setup({pi:async()=>({}),dsh:async()=>({})});
    expect((await fetch(url+'/health',{headers:{origin:'https://evil.example'}})).status).toBe(403);
    const response=await fetch(url+'/health',{headers:{origin:ORIGIN}});
    expect(response.status).toBe(200);
    const data=await response.json();
    expect(data.backends).toEqual({pi:true,dsh:true});
    expect(JSON.stringify(data)).not.toContain(configuration.apiKey);
    expect(JSON.stringify(data)).not.toContain(configuration.mcpToken);
  });
  it('routes Pi and DSH separately while preserving run id',async()=>{
    const calls=[];
    const url=await setup({pi:async({emit})=>{calls.push('pi');emit({type:'run.started'});return {taskStatus:'no-mutation',message:'pi'};},
      dsh:async()=>{calls.push('dsh');return {taskStatus:'incomplete',message:'dsh'};}});
    const a=await json(url,'/run',{runId:'test_pi_1234567',backend:'pi',prompt:'observe'});
    const b=await json(url,'/run',{runId:'test_dsh_123456',backend:'dsh',prompt:'observe'});
    expect((await a.json()).events).toEqual([{type:'run.started'}]);
    expect((await b.json()).backend).toBeUndefined();
    expect(calls).toEqual(['pi','dsh']);
  });
  it('serializes world runs and aborts on cancellation',async()=>{
    let started;
    const startedPromise=new Promise(resolve=>started=resolve);
    const url=await setup({pi:async({signal})=>{started();
      await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
      return {taskStatus:'cancelled'};},dsh:async()=>({})});
    const run=json(url,'/run',{runId:'run_first_12345',backend:'pi',prompt:'wait'});
    await startedPromise;
    expect((await json(url,'/run',{runId:'run_second_12345',backend:'pi',prompt:'conflict'})).status).toBe(409);
    expect((await json(url,'/cancel',{runId:'run_first_12345'})).status).toBe(200);
    expect((await (await run).json()).taskStatus).toBe('cancelled');
  });
  it('requires a restricted DSH profile and hides unavailable backends',async()=>{
    const host=createAgentHost({config:{...configuration,dshPatch:null},port:0,backends:{pi:async()=>({}),dsh:async()=>({})}});
    const address=await host.listen();active.push(host);
    const url='http://127.0.0.1:'+address.port;
    expect((await (await fetch(url+'/health',{headers:{origin:ORIGIN}})).json()).backends.dsh).toBe(false);
    expect((await json(url,'/run',{runId:'run_dsh_1234567',backend:'dsh',prompt:'act'})).status).toBe(503);
  });
});
