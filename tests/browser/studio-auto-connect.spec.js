import {test,expect,waitForRuntimeReady} from './fixtures.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';

test('local Studio automatically connects and follows the active world without pairing',async({page})=>{
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-auto-studio-ui-'));
  const token=randomBytes(32).toString('hex');
  const app=await startServer({tokens:[{identity:'owner',token}],port:0,root,dataRoot:path.join(root,'assets'),
    studioOrigins:['http://127.0.0.1:4189','http://localhost:4189','http://127.0.0.1:4178','http://localhost:4178']});
  const client=new Client({name:'auto-studio-ui-test',version:'1'});
  const transport=new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+app.port+'/mcp'),
    {requestInit:{headers:{Authorization:'Bearer '+token}}});
  const call=async(name,args={})=>{
    const result=await client.callTool({name,arguments:args});
    return {isError:!!result.isError,...JSON.parse(result.content[0].text)};
  };
  try{
    await client.connect(transport);
    await page.goto('/?page=world&world=monument-hall&mcpPort='+app.port);
    await waitForRuntimeReady(page);
    await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-auto-enabled','true');
    await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-bridge-state','connected',{timeout:15000});

    const first=await call('session_attach');
    expect(first.mode).toBe('automatic');
    expect(first.worldId).toBe('monument-hall');
    const added=await call('scene_add_model',{
      requestId:randomUUID(),model:{id:'auto_live_chair',asset:'builtin://chair',position:[0,0,-2]}
    });
    expect(added.isError,JSON.stringify(added)).toBe(false);
    await expect(page.locator('[data-object-id="auto_live_chair"]')).toBeVisible();

    await page.getByRole('combobox',{name:'当前世界'}).selectOption('industrial-cabinet-lab');
    await expect.poll(async()=>(await call('session_attach')).worldId,{timeout:18000}).toBe('industrial-cabinet-lab');
    const after=await call('session_attach');
    expect(after.worldSessionId).not.toBe(first.worldSessionId);
    expect((await call('scene_observe',{worldSessionId:first.worldSessionId})).code).toBe('SESSION_NOT_FOUND');
    await expect(page.locator('[data-object-id="auto_live_chair"]')).toHaveCount(0);

    await page.locator('#studio-mcp-toggle').click();
    await expect(page.locator('#studio-mcp-auto-enabled')).toBeChecked();
    await page.locator('#studio-mcp-auto-enabled').uncheck();
    await expect.poll(async()=>(await call('scene_observe')).code,{timeout:8000}).toBe('STUDIO_NOT_CONNECTED');
    await page.locator('#studio-mcp-auto-enabled').check();
    await expect.poll(async()=>(await call('session_attach')).mode,{timeout:14000}).toBe('automatic');

    await page.reload();
    await waitForRuntimeReady(page);
    await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-auto-enabled','true');
    await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-bridge-state','connected',{timeout:17000});
    expect((await call('session_attach')).mode).toBe('automatic');
  }finally{
    await page.close().catch(()=>{});
    await client.close().catch(()=>{});
    await app.close();
    await rm(root,{recursive:true,force:true});
  }
});

test('offline MCP shows a recoverable, explicit state and distinguishes native Three.js SDK setup',async({page})=>{
  // No MCP server is listening on this port; do not start one for this test.
  await page.goto('/?page=world&world=monument-hall&mcpPort=49199');
  await waitForRuntimeReady(page);
  await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-auto-enabled','true');
  await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-bridge-state','disconnected',{timeout:18000});
  await expect(page.locator('#studio-mcp-toggle')).toContainText('等待服务');
  await page.locator('#studio-mcp-toggle').click();
  await expect(page.locator('[data-mcp-diagnostic="offline"]')).toContainText('AI 尚不能操作当前世界');
  await expect(page.locator('.studio-mcp-recovery code')).toContainText('127.0.0.1:49199');
  await page.getByText('如何连接自己的 Three.js 项目？').click();
  await expect(page.locator('.studio-mcp-native-help')).toContainText('不会自动扫描或导入外部项目');
  await expect(page.getByRole('link',{name:'查看原生 Three.js 接入指南'}))
    .toHaveAttribute('href',/docs\/native-threejs-integration\.md$/);
  await page.locator('#studio-mcp-retry').click();
  await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-bridge-state','disconnected',{timeout:15000});
  await expect(page.locator('#studio-mcp-toggle')).toContainText('等待服务');
  await page.locator('#studio-mcp-auto-enabled').uncheck();
  await expect(page.locator('#studio-mcp-toggle')).toContainText('未连接');
});