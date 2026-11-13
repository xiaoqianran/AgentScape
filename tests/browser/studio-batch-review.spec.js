import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';
import { projectTemplate } from '../../apps/studio/code-project/projectTemplate.js';

test('MCP stages coordinated changes, Studio reviews and applies them, then undoes the batch',async({page})=>{
 const root=await mkdtemp(path.join(tmpdir(),'studio-batch-review-'));
 const token=randomBytes(32).toString('hex');let server,client;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try {
  server=await startServer({tokens:[{identity:'batch-review-test',token}],root,port:0,
    dataRoot:path.join(root,'assets'),studioOrigins:['http://127.0.0.1:4178']});
  client=new Client({name:'batch-review-test',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`),{
   requestInit:{headers:{Authorization:'Bearer '+token}}
  }));
  const call=async(operation,args={})=>{
   const response=await client.callTool({name:'studio_project',arguments:{operation,...args,requestId:randomUUID()}});
   const value=JSON.parse(response.content[0].text);
   expect(response.isError,JSON.stringify(value)).toBeFalsy();
   return value;
  };
  await page.goto(`/?page=world&mcpPort=${server.port}`);
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect.poll(async()=>{try{
   const response=await client.callTool({name:'session_attach',arguments:{}});
   return !response.isError;
  }catch{return false;}}).toBe(true);

  await call('write',{create:true,source:projectTemplate,name:'批次审阅世界'});
  const operations=[
   {kind:'file',action:'create',path:'lib/config.js',content:'export const configured = 42;'},
   {kind:'file',action:'patch',path:'main.js',oldText:'export async function createProject',
    newText:`import {configured} from './lib/config.js';\nexport async function createProject`},
   {kind:'file',action:'patch',path:'main.js',oldText:'read: () => ({ speed })',
    newText:'read: () => ({ speed, configured })'},
  ];
  const preview=await call('preview_batch',{operations,expectedRevision:1});
  expect(preview).toMatchObject({status:'project-batch-preview',baseRevision:1,operations:3,files:2,resources:0});
  expect(preview.changes.map(item=>item.path)).toEqual(['lib/config.js','main.js']);
  await expect(page.getByLabel('批量修改审阅')).toContainText('待审阅多文件修改');
  await expect(page.getByLabel('项目文件列表')).not.toContainText('lib/config.js');
  await page.locator('.code-project-diff').filter({hasText:'main.js'}).locator('summary').click();
  await expect(page.getByLabel('修改差异 main.js')).toContainText("+ import {configured}");

  const stale=await client.callTool({name:'studio_project',arguments:{
   operation:'apply_batch',previewId:preview.previewId,expectedRevision:0,requestId:randomUUID()
  }});
  expect(stale.isError).toBe(true);
  expect(JSON.parse(stale.content[0].text).code).toBe('PROJECT_REVISION_CONFLICT');
  expect((await call('read')).revision).toBe(1);
  await page.getByRole('button',{name:'应用全部修改',exact:true}).click();
  await expect(page.locator('.code-project-editor output').first()).toHaveText('已一次性应用全部修改，请重新运行代码世界');
  await expect(page.getByLabel('项目文件列表')).toContainText('lib/config.js');
  await expect(page.getByRole('button',{name:'撤销上一批修改',exact:true})).toBeVisible();
  expect((await call('read')).revision).toBe(2);

  await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
  await expect(page.locator('.studio-code-project-viewport canvas')).toBeVisible();
  const observe=async()=>{
   const response=await client.callTool({name:'scene_observe',arguments:{}});
   expect(response.isError).toBeFalsy();
   return JSON.parse(response.content[0].text);
  };
  await expect.poll(async()=> (await observe()).project.entities[0].state.configured).toBe(42);

  await page.getByRole('button',{name:'撤销上一批修改',exact:true}).click();
  await expect(page.locator('.code-project-editor output').first()).toHaveText('已撤销上一批修改，请重新运行代码世界');
  expect((await call('read')).revision).toBe(3);
  await expect(page.getByLabel('项目文件列表')).not.toContainText('lib/config.js');
  await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
  await expect.poll(async()=> (await observe()).project.entities[0].state.configured).toBeUndefined();

  const discarded=await call('preview_batch',{operations:[{
   kind:'resource',action:'add',path:'textures/private.txt',mime:'text/plain',base64:btoa('hidden-content')
  }],expectedRevision:3});
  expect(JSON.stringify(discarded)).not.toContain(btoa('hidden-content'));
  await expect(page.getByLabel('批量修改审阅')).toContainText('资源');
  await page.getByRole('button',{name:'放弃批量预览',exact:true}).click();
  expect((await call('read')).revision).toBe(3);
  await expect(page.getByLabel('批量修改审阅')).toHaveCount(0);
  expect(errors).toEqual([]);
 } finally {await client?.close().catch(()=>{});await server?.close();await rm(root,{recursive:true,force:true});}
});
