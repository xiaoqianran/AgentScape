import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';
import { projectTemplate } from '../../apps/studio/code-project/projectTemplate.js';

test('Studio MCP creates a visible world; UI edits, fails safely, saves and reopens source and dynamic state',async({page},testInfo)=>{
 const root=await mkdtemp(path.join(tmpdir(),'studio-code-project-')),token=randomBytes(32).toString('hex');
 let server,client;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  server=await startServer({tokens:[{identity:'studio-project-test',token}],root,port:0,dataRoot:path.join(root,'assets'),studioOrigins:['http://127.0.0.1:4178']});
  client=new Client({name:'studio-project-test',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  const call=async(name,args={})=>{const response=await client.callTool({name,arguments:args});const value=JSON.parse(response.content[0].text);expect(response.isError,JSON.stringify(value)).toBeFalsy();return value;};
  await page.goto(`/?page=world&mcpPort=${server.port}`);
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect.poll(async()=>{try{return (await call('session_attach')).connected;}catch{return false;}}).toBe(true);
  const guide=await call('studio_project',{operation:'read'});expect(guide.guide).toContain('createProject');
  await call('studio_project',{operation:'write',create:true,source:projectTemplate,name:'MCP 自由世界',requestId:randomUUID()});
  await expect(page.getByLabel('世界源码')).toHaveValue(projectTemplate);
  await call('studio_project',{operation:'run',requestId:randomUUID()});
  const canvas=page.locator('.studio-code-project-viewport canvas');await expect(canvas).toBeVisible();
  const shot=await canvas.screenshot({path:testInfo.outputPath('studio-code-world.png')});
  expect(Math.max(...(await sharp(shot).stats()).channels.slice(0,3).map(c=>c.stdev))).toBeGreaterThan(4);
  const observed=await call('scene_observe');expect(observed.project.entities[0].actions[0].name).toBe('setSpeed');
  const job=await call('scene_interact',{requestId:randomUUID(),interaction:{action:'custom',target:'sculpture',name:'setSpeed',args:{speed:2}}});
  await expect.poll(async()=>(await call('scene_job',{jobId:job.id})).status).toBe('succeeded');
  await expect(page.locator('.code-project-actions')).toContainText('"speed": 2');
  const stale=await client.callTool({name:'studio_project',arguments:{
    operation:'patch',oldText:'scene.add(sculpture);',newText:'scene.add(sculpture); // stale',expectedRevision:99,requestId:randomUUID()
  }});
  expect(stale.isError).toBe(true);
  expect(JSON.parse(stale.content[0].text).code).toBe('PROJECT_REVISION_CONFLICT');
  const patched=await call('studio_project',{
    operation:'patch',oldText:'scene.add(sculpture);',
    newText:'scene.add(sculpture); // patched through MCP',expectedRevision:1,requestId:randomUUID()
  });
  expect(patched).toMatchObject({status:'project-source-patched',revision:2});
  await expect(page.getByLabel('世界源码')).toHaveValue(/patched through MCP/);
  await page.getByLabel('世界源码').fill('export function createProject() { throw new Error("STUDIO_SETUP_TEST"); }');
  await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
  await expect(page.locator('.code-project-editor [role=alert]')).toContainText('STUDIO_SETUP_TEST');
  await expect(canvas).toBeVisible();expect((await call('scene_observe',{target:'sculpture'})).state.speed).toBe(2);
  await page.getByLabel('世界源码').fill(projectTemplate+'\n// Studio user edit');
  await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
  await expect(page.locator('.code-project-editor output')).toHaveText('代码世界运行中');
  await page.getByRole('button',{name:'保存世界状态',exact:true}).click();
  await expect(page.locator('.code-project-editor output')).toHaveText('世界状态已保存到本机');
  const saved=await call('scene_save');expect(saved.value.state.speed).toBe(2);expect(saved.value.source).toContain('Studio user edit');
  await page.reload();await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await page.getByRole('button',{name:'代码世界',exact:true}).click();
  await page.getByLabel('本机代码项目').selectOption(saved.value.id);
  await page.getByRole('button',{name:'打开代码项目',exact:true}).click();
  await expect(page.getByLabel('世界源码')).toHaveValue(saved.value.source);
  await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
  await expect(page.locator('.code-project-actions')).toContainText('"speed": 2');
  await page.getByRole('button',{name:'对象属性',exact:true}).click();
  await page.locator('.code-project-action > summary').filter({hasText:'setSpeed'}).click();
  await page.getByLabel('动作参数 speed').fill('4');
  await page.getByRole('button',{name:'执行 setSpeed',exact:true}).click();
  await expect(page.locator('.code-project-action output')).toHaveText('已验证');
  await expect(page.locator('.code-project-actions')).toContainText('"speed": 4');
  const afterUi=await call('scene_save');
  expect(afterUi.value.state.speed).toBe(4);
  await page.getByRole('button',{name:'保存并返回内置世界',exact:true}).click();
  await expect(page.locator('#viewport > canvas')).toBeVisible();
  expect(errors).toEqual([]);
 } finally {await client?.close().catch(()=>{});await server?.close();await rm(root,{recursive:true,force:true});}
});

test('Studio task AI creates, runs, changes a dynamic action state, edits source and saves via actual tools',async({page})=>{
 let round=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const steps=[['readStudioProject',{}],['writeStudioProject',{create:true,source:projectTemplate,name:'AI 完整世界'}],['runStudioProject',{}],
  ['planSceneTask',{criteria:[{id:'speed_changed',kind:'state-equals',targetId:'sculpture',stateKey:'speed',value:3}]}],
  ['interactScene',{goalId:'speed_changed',interaction:{action:'custom',target:'sculpture',name:'setSpeed',args:{speed:3}}}],
  ['patchStudioProject',{oldText:'scene.add(sculpture);',newText:'scene.add(sculpture);\n  // AI modified this world',expectedRevision:1}],['runStudioProject',{}],['saveStudioProject',{}]];
 await page.route('**/api/capabilities',route=>route.fulfill({json:{capabilities:{agent:{available:true},'asset.compile':{available:false}}}}));
 await page.route('**/api/capabilities/agent',async route=>{
  const request=route.request().postDataJSON();
  if(round===3)expect(request.context.scene.project.entities[0].actions[0].name).toBe('setSpeed');
  const step=steps[round++];
  await route.fulfill({json:step?{toolCalls:[{id:'step'+round,name:step[0],args:step[1]}]}:{message:'代码世界已创建、修改并保存。',toolCalls:[]}});
 });
 await page.goto('/?page=world');
 await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
 await page.locator('#open-world-task').click();
 await page.locator('#input').fill('创建一个完整代码世界，运行并改变旋转速度，修改源码然后保存');await page.locator('#send').click();
 await expect.poll(()=>round,{timeout:60000}).toBe(9);
 await expect(page.locator('.studio-code-project-viewport canvas')).toBeVisible();
 await expect(page.getByLabel('世界源码')).toHaveValue(projectTemplate.replace('scene.add(sculpture);','scene.add(sculpture);\n  // AI modified this world'));
 await page.getByRole('button',{name:'对象属性',exact:true}).click();
 await expect(page.locator('.code-project-actions')).toContainText('"speed": 3');
 await page.reload();await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
 await page.getByRole('button',{name:'代码世界',exact:true}).click();
 await page.getByLabel('本机代码项目').selectOption({label:'AI 完整世界'});
 await page.getByRole('button',{name:'打开代码项目',exact:true}).click();
 await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
 await expect(page.locator('.code-project-actions')).toContainText('"speed": 3');expect(errors).toEqual([]);
});
