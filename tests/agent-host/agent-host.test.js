import {describe,it,expect,afterEach} from 'vitest';
import {createAgentHost,isNewWorldRequest} from '../../apps/agent-host/AgentHost.mjs';

const ORIGIN='http://localhost:5173';
const configuration={baseUrl:'https://test.invalid/v1',apiKey:'test',modelId:'test',
  mcpToken:'z'.repeat(32),dshPatch:'C:/approved/restricted.yml',dshProvider:'test',dshModel:'test'};
const active=[];
afterEach(async()=>{while(active.length)await active.pop().close();});
async function setup(backends,prepareProject){
  const host=createAgentHost({config:configuration,port:0,backends,prepareProject,attachSession:async()=>'mock-world'});
  const address=await host.listen();active.push(host);
  return 'http://127.0.0.1:'+address.port;
}
const json=(url,path,body,origin=ORIGIN)=>fetch(url+path,{
  method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)
});
describe('dual agent host transport',()=>{
  it('distinguishes creating a world from editing or discussing a world',()=>{
    expect(isNewWorldRequest('帮我创建一个有房子和苹果树的世界')).toBe(true);
    expect(isNewWorldRequest('Build a new orchard world')).toBe(true);
    for(const prompt of ['在这个世界加一棵树','创建一个现有世界里的房子','创建世界地图',
      '如何创建一个世界','Create a world map','Add a tree in the current world']){
      expect(isNewWorldRequest(prompt)).toBe(false);
    }
  });
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
    expect((await a.json()).events).toEqual([{type:'run.started'}, {type:'run.finished',backend:'pi',taskStatus:'incomplete',verified:false}]);
    expect((await b.json()).backend).toBe('dsh');
    expect(calls).toEqual(['pi','dsh']);
  });
  it.each(['pi','dsh'])('prepares a scoped draft before invoking %s',async backend=>{
    const calls=[];
    const id='world_'+'a'.repeat(32), worldSessionId=crypto.randomUUID();
    const run=async ({projectScope,prompt})=>{calls.push('backend');expect(projectScope).toBe(worldSessionId+'/'+id);
      expect(prompt).toContain('创建一个有房子和苹果树的世界');return {taskStatus:'completed'};};
    const url=await setup({pi:run,dsh:run},async (_config,runId)=>{
      calls.push(runId);return {id,worldSessionId,revision:1};
    });
    const result=await (await json(url,'/run',{runId:'new_world_12345',backend,prompt:'创建一个有房子和苹果树的世界'})).json();
    expect(calls).toEqual(['new_world_12345','backend']);
    expect(result.projectId).toBe(id);
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
