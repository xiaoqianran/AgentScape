import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer} from '../../apps/mcp-server/main.mjs';
import {createAgentHost} from '../../apps/agent-host/AgentHost.mjs';
import {connectStudioMcp} from '../../apps/agent-host/McpWorldTools.js';
import {normalizeExecution} from '../../apps/agent-host/AgentExecution.js';
import {reviewStudioVisual} from '../../apps/agent-host/VisualReview.js';

test('visual feedback drives real Studio MCP edit, render, capture and rerun',async({page})=>{
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-visual-loop-'));
  const token=randomBytes(32).toString('hex');
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let server,host;
  try {
    server=await startServer({tokens:[{identity:'visual-loop-e2e',token}],
      root,port:0,dataRoot:path.join(root,'assets'),studioOrigins:[test.info().project.use.baseURL]});
    const configuration={baseUrl:'https://vision-mock.invalid/v1',apiKey:'mock-only',
      modelId:'mock-vision',visualModelId:'mock-vision',visualReviewMode:'auto',visualMaxRevisions:1,
      mcpUrl:'http://127.0.0.1:'+server.port+'/agent-mcp',mcpToken:token};
    await page.goto('/studio/?page=world&mcpPort='+server.port);
    await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
    await expect.poll(async()=>{
      try {const connection=await connectStudioMcp({url:configuration.mcpUrl,token});
        await connection.close();return true;}
      catch{return false;}
    },{timeout:40000}).toBe(true);
    let calls=0,visionCalls=0;
    const screenshots=[];
    const fakePi=async({configuration:config,projectScope,signal,prompt})=>{
      if(calls===1)expect(prompt).toContain('红色');
      calls++;
      const connection=await connectStudioMcp({url:config.mcpUrl,token:config.mcpToken,signal,projectScope});
      const records=[];
      try {
        const execute=async(name,args)=>{
          const tool=connection.tools.find(item=>item.name===name);
          if(!tool)throw Error('TOOL_MISSING: '+name);
          const callId=randomUUID();
          const result=await tool.execute(callId,args,signal);
          if(result.isError)throw Error(result.content[0].text);
          records.push({name,callId,args,result});
          return JSON.parse(result.content[0].text);
        };
        const current=await execute('studio_project',{operation:'read'});
        const source=calls===1?current.starter:current.project.source.replace(
          'const material = new THREE.MeshNormalMaterial();',
          "const material = new THREE.MeshBasicMaterial({ color: '#ff3b3b' });");
        // Use exactly the Studio project from the Host; no new scene runtime.
        const written=await execute('studio_files',{operation:'write',expectedRevision:current.revision,source});
        await execute('studio_project',{operation:'run',expectedRevision:written.revision});
        await execute('studio_project',{operation:'save'});
        await execute('scene_verify',{criteria:[{id:'valid-world',kind:'world-valid'}]});
        return {worldSessionId:connection.worldSessionId,execution:normalizeExecution('pi',records)};
      } finally {await connection.close();}
    };
    const fakeVision=async urlInit=>{
      visionCalls++;
      const body=JSON.parse(urlInit.body);
      screenshots.push(body.messages[1].content[1].image_url.url);
      expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
      expect(body.messages[1].content[1].image_url.url.length).toBeGreaterThan(1000);
      return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(
        visionCalls===1?{accepted:false,score:4,issues:['颜色不突出'],advice:'改成鲜明红色材质'}:
          {accepted:true,score:9,issues:[],advice:''})}}]})};
    };
    host=createAgentHost({config:configuration,port:0,backends:{pi:fakePi,dsh:async()=>({})},
      reviewVisual:args=>reviewStudioVisual({...args,request:(_url,options)=>fakeVision(options)})});
    await host.listen();
    const response=await fetch('http://127.0.0.1:'+host.server.address().port+'/run',{
      method:'POST',headers:{origin:'http://localhost:5173','content-type':'application/json'},
      body:JSON.stringify({runId:'visual_world_12345',backend:'pi',prompt:'创建一个可以旋转的精致雕塑世界'})
    });
    expect(response.status).toBe(200);
    const result=await response.json();
    expect(result).toMatchObject({taskStatus:'completed',verified:true,visual:{status:'passed'}});
    expect(result.visual.reviews.map(item=>item.score)).toEqual([4,9]);
    expect(result.evidence).toMatchObject({schema:'agentscape.task-evidence',worldStatus:'verified',persistence:{status:'verified'},
      dimensions:{structure:{status:'verified',native:{status:'observed'}},behavior:{status:'not-required'},
        visual:{status:'assessed-pass',reviews:[{current:false},{current:true}]}}});
    expect(result.evidence.binding).toEqual(result.world);
    expect(result.evidence.snapshot).toMatchObject({scope:'sampled-runtime-state',frame:expect.any(Number),tick:expect.any(Number)});
    expect(result.evidence.dimensions.structure.native).toMatchObject({frame:result.evidence.snapshot.frame,tick:result.evidence.snapshot.tick});
    expect(result.visual.reviews.at(-1)).toMatchObject({frame:result.evidence.snapshot.frame,tick:result.evidence.snapshot.tick,imageDigest:result.evidence.snapshot.imageDigest});
    expect(JSON.stringify(result)).not.toContain('imageBase64');
    expect(result.evidence.dimensions.visual.reviews.at(-1).imageDigest).toMatch(/^[a-f0-9]{64}$/);
    const finalReview=result.visual.reviews.at(-1);
    expect(result.savedCheckpoint).toMatchObject({projectId:result.world.projectId,
      projectRevision:result.world.projectRevision,runtimeId:result.world.runtimeId,sceneRevision:result.world.sceneRevision});
    expect(result.savedCheckpoint.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(finalReview).toMatchObject({projectId:result.world.projectId,
      revision:result.world.projectRevision,runtimeId:result.world.runtimeId,sceneRevision:result.world.sceneRevision});
    expect(result.visual.reviews[0].runtimeId).not.toBe(finalReview.runtimeId);
    expect(result.events.filter(event=>event.type==='visual.reviewed')).toHaveLength(2);
    expect(calls).toBe(2);expect(visionCalls).toBe(2);
    expect(screenshots[0]).not.toBe(screenshots[1]);
    const connection=await connectStudioMcp({url:configuration.mcpUrl,token});
    try {
      const read=await connection.tools.find(tool=>tool.name==='studio_project').execute(
        randomUUID(),{operation:'read'});
      const last=JSON.parse(read.content[0].text);
      expect(last.active).toBe(true);
      expect(last.runningRevision).toBe(last.revision);
      expect(last.project.source).toContain('MeshBasicMaterial');
    } finally {await connection.close();}
    expect(JSON.stringify(result)).not.toContain('data:image/jpeg;base64');
    await expect(page.locator('.studio-code-project-viewport canvas')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await host?.close();
    await server?.close();
    await rm(root,{recursive:true,force:true});
  }
},180000);
