import {describe,it,expect,afterEach} from 'vitest';
import {createAgentHost,isNewWorldRequest,getConfig} from '../../apps/agent-host/AgentHost.mjs';

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
    expect((await a.json()).events).toEqual([{type:'run.started'}, {type:'run.finished',backend:'pi',taskStatus:'no-mutation',verified:false}]);
    expect((await b.json()).backend).toBe('dsh');
    expect(calls).toEqual(['pi','dsh']);
  });
  it.each(['pi','dsh'])('prepares a scoped draft before invoking %s',async backend=>{
    const calls=[];
    const id='world_'+'a'.repeat(32), worldSessionId=crypto.randomUUID();
    const run=async ({projectScope,prompt})=>{calls.push('backend');expect(projectScope).toBe(worldSessionId+'/'+id);
      expect(prompt).toContain('创建一个有房子和苹果树的世界');
      expect(prompt).toContain('Semantic entity/action registration is optional');
      return {taskStatus:'completed'};};
    const url=await setup({pi:run,dsh:run},async (_config,runId)=>{
      calls.push(runId);return {id,worldSessionId,revision:1};
    });
    const result=await (await json(url,'/run',{runId:'new_world_12345',backend,prompt:'创建一个有房子和苹果树的世界'})).json();
    expect(calls).toEqual(['new_world_12345','backend']);
    expect(result.projectId).toBe(id);
  });
  it('revises the same world through Pi/DSH until a real screenshot is accepted',async()=>{
    const prompts=[],visualEvents=[],projectId='world_'+'e'.repeat(32);
    const worldSessionId=crypto.randomUUID();
    const verdicts=[
      {status:'needs-revision',score:3,issues:['外观缺少树叶'],advice:'加绿色树冠',projectId,revision:2},
      {status:'passed',score:9,issues:[],advice:'',projectId,revision:3}
    ];
    const host=createAgentHost({config:configuration,port:0,
      prepareProject:async()=>({id:projectId,worldSessionId,revision:1}),
      backends:{pi:async({prompt})=>{prompts.push(prompt);return {worldSessionId,execution:[]};},dsh:async()=>({})},
      finalize:async()=>({taskStatus:'completed',verified:true,verification:{scope:'world-state',status:'verified'}}),
      reviewVisual:async()=>verdicts.shift()});
    await host.listen();active.push(host);
    const output=await (await json('http://127.0.0.1:'+host.server.address().port,'/run',
      {runId:'visual_create_001',backend:'pi',prompt:'创建一个精致苹果树世界'})).json();
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('加绿色树冠');
    expect(prompts[1]).toContain('创建一个精致苹果树世界');
    expect(output).toMatchObject({taskStatus:'completed',verified:true,visual:{status:'passed'}});
    expect(output.visual.reviews).toHaveLength(2);
    expect(output.events.filter(event=>event.type==='visual.reviewed')).toHaveLength(2);
    expect(JSON.stringify(output)).not.toContain('imageBase64');
  });
  it('lets an explicit off mode keep existing world-only behavior without vision API calls',async()=>{
    const worldSessionId=crypto.randomUUID(),projectId='world_'+'f'.repeat(32);
    let reviewed=false;
    const host=createAgentHost({config:{...configuration,visualReviewMode:'off'},port:0,
      prepareProject:async()=>({id:projectId,worldSessionId,revision:1}),
      backends:{pi:async()=>({worldSessionId,execution:[]}),dsh:async()=>({})},
      finalize:async()=>({taskStatus:'completed',verified:true}),
      reviewVisual:async()=>{reviewed=true;throw Error('unexpected');}});
    await host.listen();active.push(host);
    const result=await (await json('http://127.0.0.1:'+host.server.address().port,'/run',
      {runId:'visual_off_001',backend:'pi',prompt:'创建一座房屋世界'})).json();
    expect(reviewed).toBe(false);
    expect(result.taskStatus).toBe('completed');
    expect(result).not.toHaveProperty('visual');
  });
  it('rejects unsupported visual settings rather than silently ignoring them',()=>{
    expect(()=>createAgentHost({config:{...configuration,visualReviewMode:'sometimes'}}))
      .toThrow('VISUAL_REVIEW_MODE_INVALID');
    expect(()=>createAgentHost({config:{...configuration,visualMaxRevisions:12}}))
      .toThrow('VISUAL_MAX_REVISIONS_INVALID');
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
  it('runs arbitrary original requests without invoking TaskSpec in the default world-first mode',async()=>{
    expect(getConfig({}).taskAcceptanceMode).toBe('world');
    expect(getConfig({AGENTSCAPE_TASK_ACCEPTANCE_MODE:'strict'}).taskAcceptanceMode).toBe('strict');
    let received, compiled=false;
    const host=createAgentHost({config:configuration,port:0,compileTask:async()=>{compiled=true;throw new Error('unexpected compilation');},
      backends:{pi:async ({prompt})=>{received=prompt;return {taskStatus:'incomplete',execution:[]};},dsh:async()=>({})},
      attachSession:async()=> 'world-test'});
    await host.listen();active.push(host);
    const prompt='创建一台会旋转、具有任意自定义部件和材质的机器人';
    const output=await (await json('http://127.0.0.1:'+host.server.address().port,'/run',
      {runId:'free_three_js_001',backend:'pi',prompt})).json();
    expect(received).toBe(prompt);
    expect(compiled).toBe(false);
    expect(output).not.toHaveProperty('taskSpec');
    expect(output.verification).toMatchObject({scope:'world-state',status:'unverified',reason:'SCENE_VERIFICATION_MISSING'});
    expect(output.verified).toBe(false);
  });
  it('rejects unknown task acceptance modes rather than silently disabling a requested policy',()=>{
    expect(()=>createAgentHost({config:{...configuration,taskAcceptanceMode:'stict'}}))
      .toThrow('TASK_ACCEPTANCE_MODE_INVALID');
  });
  it('requires a restricted DSH profile and hides unavailable backends',async()=>{
    const host=createAgentHost({config:{...configuration,dshPatch:null},port:0,backends:{pi:async()=>({}),dsh:async()=>({})}});
    const address=await host.listen();active.push(host);
    const url='http://127.0.0.1:'+address.port;
    expect((await (await fetch(url+'/health',{headers:{origin:ORIGIN}})).json()).backends.dsh).toBe(false);
    expect((await json(url,'/run',{runId:'run_dsh_1234567',backend:'dsh',prompt:'act'})).status).toBe(503);
  });
});
