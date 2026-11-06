import {test,expect,waitForRuntimeReady} from './fixtures.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';
import {house} from '../../apps/mcp-server/examples/code-house.js';

// Each acceptance tests one end-to-end capability, so SwiftShader latency in an
// unrelated capability cannot consume the same per-test timeout budget.
async function withPairedStudio(page, run) {
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-mcp-ui-'));
  const token=randomBytes(32).toString('hex');
  let app,client;
  try {
    app=await startServer({tokens:[{identity:'alice',token}],port:0,root,
      dataRoot:path.join(root,'assets'),
      studioOrigins:['http://127.0.0.1:4178','http://localhost:4178','http://127.0.0.1:4189','http://localhost:4189']});
    client=new Client({name:'studio-bridge-ui-test',version:'1'});
    const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`),
      {requestInit:{headers:{Authorization:'Bearer '+token}}});
    const call=async(name,args={})=>{
      const response=await client.callTool({name,arguments:args});
      return {isError:!!response.isError,...JSON.parse(response.content[0].text)};
    };
    let pair;
    await test.step('pair Studio with the authenticated MCP session',async()=>{
      await client.connect(transport);
      pair=await call('studio_pair_create');
      expect(pair.pairCode).toHaveLength(64);
      await page.goto(`/?page=world&world=monument-hall&mcpPort=${app.port}`);
      await waitForRuntimeReady(page);
      await page.locator('#studio-mcp-toggle').click();
      await page.locator('#studio-mcp-auto-enabled').uncheck();
      await page.getByText('高级：使用一次性配对码').click();
      await page.locator('#studio-mcp-pair-code').fill(pair.pairCode);
      await page.locator('#studio-mcp-connect').click();
      await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-bridge-state','connected');
      expect((await call('session_attach',{worldSessionId:pair.worldSessionId})).connected).toBe(true);
    });
    return await run({app,call,pair});
  } finally {
    // Keep Playwright's page alive until the evidence fixture has captured it.
    await client?.close().catch(()=>{});
    await app?.close();
    await rm(root,{recursive:true,force:true});
  }
}

test('paired MCP edits the visible Studio world and disconnects on world switch',async({page})=>
  withPairedStudio(page,async({call,pair})=>{
    await test.step('observe and add an object to the shared world',async()=>{
      const before=await call('scene_observe',{worldSessionId:pair.worldSessionId});
      expect(before.objects.length).toBeGreaterThan(0);
      const added=await call('scene_add_model',{worldSessionId:pair.worldSessionId,requestId:randomUUID(),
        model:{id:'mcp_live_chair',asset:'builtin://chair',position:[5,0,-2]}});
      expect(added.isError,JSON.stringify(added)).toBe(false);
      await expect(page.locator('[data-object-id="mcp_live_chair"]')).toBeVisible();
    });
    await test.step('navigate the agent and verify the physical result',async()=>{
      const task=await call('scene_interact',{worldSessionId:pair.worldSessionId,requestId:randomUUID(),
        interaction:{actor:'agent_01',action:'navigate',position:[0,0,8]}});
      expect(task.id).toMatch(/^job_/);
      await expect.poll(async()=>(await call('scene_job',{worldSessionId:pair.worldSessionId,jobId:task.id})).status,
        {timeout:40000,intervals:[500,1000,1000]}).toBe('succeeded');
      const completed=await call('scene_job',{worldSessionId:pair.worldSessionId,jobId:task.id});
      expect(completed.result?.verification?.status).toBe('verified');
    });
    await test.step('changing worlds revokes the paired session and its objects',async()=>{
      await page.getByRole('combobox',{name:'当前世界'}).selectOption('industrial-cabinet-lab');
      await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-bridge-state','disconnected');
      expect((await call('scene_observe',{worldSessionId:pair.worldSessionId})).isError).toBe(true);
      await expect(page.locator('[data-object-id="mcp_live_chair"]')).toHaveCount(0);
    });
  })
);

test('paired MCP creates a code house and restores it through the public SDK',async({page})=>
  withPairedStudio(page,async({app,call,pair})=>{
    let saved;
    await test.step('build, publish and place the programmable house',async()=>{
      const build=await call('asset_build_submit',{contract:'agentscape.procedural-asset.v1',...house,requestId:randomUUID()});
      expect(build.isError,JSON.stringify(build)).toBe(false);
      await app.assets.running.get(build.buildId)?.promise;
      const published=await call('asset_publish',{buildId:build.buildId});
      expect(published.isError,JSON.stringify(published)).toBe(false);
      const codeHouse=await call('scene_add_model',{worldSessionId:pair.worldSessionId,requestId:randomUUID(),
        model:{id:'code_house',asset:`asset://sha256/${published.version}`,position:[0,0,-5]}});
      expect(codeHouse.isError,JSON.stringify(codeHouse)).toBe(false);
      await expect(page.locator('[data-object-id="code_house"]')).toBeVisible();
    });
    await test.step('open and close the door with verified agent actions',async()=>{
      for(const action of ['open','close']){
        const job=await call('scene_interact',{worldSessionId:pair.worldSessionId,requestId:randomUUID(),
          interaction:{actor:'agent_01',action,target:'code_house'}});
        expect(job.id,JSON.stringify(job)).toMatch(/^job_/);
        await expect.poll(async()=>(await call('scene_job',{worldSessionId:pair.worldSessionId,jobId:job.id})).status,
          {timeout:60000}).not.toBe('running');
        const result=await call('scene_job',{worldSessionId:pair.worldSessionId,jobId:job.id});
        expect(result.status,JSON.stringify(result)).toBe('succeeded');
      }
    });
    await test.step('save the world through the shared Studio Scene API',async()=>{
      saved=await call('scene_save',{worldSessionId:pair.worldSessionId});
      expect(saved.isError,JSON.stringify(saved)).toBe(false);
    });
    await test.step('import the saved world into an independent SDK browser page',async()=>{
      const sdkPage=await page.context().newPage();
      try {
        await sdkPage.goto('/examples/three-code/');
        await sdkPage.getByRole('button',{name:'Authorize and run trusted code example'}).click();
        await expect(sdkPage.getByRole('status')).toHaveText('Cube created',{timeout:60000});
        const restored=await sdkPage.evaluate(async bundle=>{
          const {AgentScape,world:demo}=window.codeDemo;demo.close();
          const world=await AgentScape.open({canvas:'#app',bundle});
          try {
            const codeHouse=world.observe().objects.find(object=>object.id==='code_house');
            const job=await world.waitJob(world.interact({actor:'agent_01',action:'open',target:'code_house'}).id);
            return {physicsRegistered:codeHouse.physicsRegistered,status:job.status,result:job.result};
          } finally {world.close();}
        },saved.value);
        expect(restored.physicsRegistered).toBe(true);
        expect(restored.status,JSON.stringify(restored.result)).toBe('succeeded');
      } finally {await sdkPage.close().catch(()=>{});}
    });
  })
);
