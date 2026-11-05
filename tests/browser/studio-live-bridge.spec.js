import {test,expect,waitForRuntimeReady} from './fixtures.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';

test('MCP pairs with visible Studio, edits the same world and disconnects on world switch',async({page})=>{
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-mcp-ui-'));
  const token=randomBytes(32).toString('hex');
  const app=await startServer({tokens:[{identity:'alice',token}],port:0,root,
    dataRoot:path.join(root,'assets'),
    studioOrigins:['http://127.0.0.1:4178','http://localhost:4178','http://127.0.0.1:4189','http://localhost:4189']});
  const client=new Client({name:'studio-bridge-ui-test',version:'1'});
  const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`),
    {requestInit:{headers:{Authorization:'Bearer '+token}}});
  const call=async(name,args={})=>{
    const response=await client.callTool({name,arguments:args});
    return {isError:!!response.isError,...JSON.parse(response.content[0].text)};
  };
  try{
    await client.connect(transport);
    const pair=await call('studio_pair_create');
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
    const before=await call('scene_observe',{worldSessionId:pair.worldSessionId});
    expect(before.objects.length).toBeGreaterThan(0);
    const added=await call('scene_add_model',{worldSessionId:pair.worldSessionId,requestId:randomUUID(),
      model:{id:'mcp_live_chair',asset:'builtin://chair',position:[0,0,-2]}});
    expect(added.isError).toBe(false);
    await expect(page.locator('[data-object-id="mcp_live_chair"]')).toBeVisible();
    const task=await call('scene_interact',{worldSessionId:pair.worldSessionId,requestId:randomUUID(),
      interaction:{actor:'agent_01',action:'navigate',position:[0,0,8]}});
    expect(task.id).toMatch(/^job_/);
    await expect.poll(async()=>{
      const job=await call('scene_job',{worldSessionId:pair.worldSessionId,jobId:task.id});
      return job.status;
    },{timeout:40000,intervals:[500,1000,1000]}).toBe('succeeded');
    const completed=await call('scene_job',{worldSessionId:pair.worldSessionId,jobId:task.id});
    expect(completed.result?.verification?.status).toBe('verified');
    await page.getByRole('combobox',{name:'当前世界'}).selectOption('industrial-cabinet-lab');
    await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-bridge-state','disconnected');
    expect((await call('scene_observe',{worldSessionId:pair.worldSessionId})).isError).toBe(true);
    await expect(page.locator('[data-object-id="mcp_live_chair"]')).toHaveCount(0);
  }finally{
    await page.close();
    await client.close().catch(()=>{});
    await app.close();
    await rm(root,{recursive:true,force:true});
  }
});
