import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';
import {projectTemplate} from '../../apps/studio/code-project/projectTemplate.js';

test('Studio native scene search, batch inspection and isolated best-view preview',async({page})=>{
  const root=await mkdtemp(path.join(tmpdir(),'studio-native-query-'));
  const token=randomBytes(32).toString('hex');let server,client;
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  try{
    server=await startServer({tokens:[{identity:'native-query-test',token}],root,port:0,
      dataRoot:path.join(root,'assets'),studioOrigins:['http://127.0.0.1:4178']});
    client=new Client({name:'native-query-test',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.port+'/mcp'),{
      requestInit:{headers:{Authorization:'Bearer '+token}}
    }));
    const call=async(operation,args={})=>{
      const response=await client.callTool({name:'studio_project',arguments:{operation,...args}});
      const value=JSON.parse(response.content[0].text);
      expect(response.isError,JSON.stringify(value)).toBeFalsy();
      return value;
    };
    await page.goto('/studio/?page=world&mcpPort='+server.port);
    await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
    await expect.poll(async()=>{
      try{return !(await client.callTool({name:'session_attach',arguments:{}})).isError;}catch{return false;}
    }).toBe(true);
    await call('write',{create:true,name:'Native scene query',source:projectTemplate});
    await call('run',{expectedRevision:1,requestId:randomUUID()});
    const search=await call('search',{expectedRevision:1,query:'Mesh',visibleOnly:true});
    const ref=search.items[0];
    expect(ref.objectUuid).toBeTruthy();
    const request={expectedRevision:search.revision,expectedRuntimeId:search.runtimeId,expectedSceneRevision:search.sceneRevision,nodePath:ref.nodePath};
    expect((await call('inspect',{...request,objectUuid:ref.objectUuid})).node.objectUuid).toBe(ref.objectUuid);
    const stale=await client.callTool({name:'studio_project',arguments:{operation:'inspect',...request,objectUuid:randomUUID()}});
    expect(stale.isError).toBeTruthy();
    expect(JSON.stringify(stale.content)).toContain('NATIVE_INSPECT_OBJECT_CONFLICT');
    await page.getByRole('button',{name:'可视化',exact:true}).click();
    await page.getByLabel('原生对象搜索').fill('Mesh');
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await expect(page.locator('.native-world-results button')).toHaveCount(1,{timeout:20000});
    await page.getByRole('button',{name:'批量检查前 8 个'}).click();
    await expect(page.locator('.native-world-inspector')).toContainText('批量检查 1 个对象');
    await page.getByRole('button',{name:'自动找最佳机位'}).click();
    await expect(page.locator('.native-world-preview')).toBeVisible({timeout:30000});
    const src=await page.locator('.native-world-preview').getAttribute('src');
    expect(src).toMatch(/^data:image\/jpeg;base64,/);
    expect(pageErrors).toEqual([]);
  }finally{
    await client?.close().catch(()=>{});
    await server?.close().catch(()=>{});
    await rm(root,{recursive:true,force:true});
  }
});
