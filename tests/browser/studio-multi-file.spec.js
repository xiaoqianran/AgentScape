import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';
import { projectTemplate } from '../../apps/studio/code-project/projectTemplate.js';

const source = `import { motionRate, hue } from './lib/motion.js';
import text from './shaders/pulse.glsl';
` + projectTemplate
  .replace('read: () => ({ speed })', 'read: () => ({ speed, motionRate, hue, text })')
  .replace('sculpture.rotation.y += dt * speed;', 'sculpture.rotation.y += dt * speed * motionRate;');
const helper = `import { Color } from 'three';
export const motionRate = 1;
export const hue = new Color('#ff0000').getHexString();`;

// The button schedules an async save; wait for its persisted completion before MCP reads or reload.
async function saveWorldAndWait(page) {
  const button=page.getByRole('button',{name:'保存世界状态',exact:true});
  await button.click();
  await expect(page.locator('.code-project-editor output').first()).toHaveText('世界状态已保存到本机');
  await expect(button).toBeEnabled();
}

test('Studio and MCP jointly edit native multi-file JS/GLSL projects and recover the saved world',async({page})=>{
 const root=await mkdtemp(path.join(tmpdir(),'studio-multi-file-'));
 const token=randomBytes(32).toString('hex');
 let server,client;const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try {
  server=await startServer({tokens:[{identity:'multi-file-test',token}],root,port:0,
    dataRoot:path.join(root,'assets'),studioOrigins:['http://127.0.0.1:4178']});
  client=new Client({name:'multi-file-test',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`),{
   requestInit:{headers:{Authorization:'Bearer '+token}}
  }));
  const call=async(operation,args={})=>{
   const response=await client.callTool({name:'studio_project',arguments:{operation,...args}});
   const value=JSON.parse(response.content[0].text);
   expect(response.isError,JSON.stringify(value)).toBeFalsy();
   return value;
  };
  await page.goto(`/?page=world&mcpPort=${server.port}`);
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect.poll(async()=>{
   try { const response=await client.callTool({name:'session_attach',arguments:{}});return !response.isError; }
   catch{return false;}
  }).toBe(true);

  await call('write',{create:true,name:'多文件Studio',source,requestId:randomUUID()});
  await call('file',{action:'create',path:'lib/motion.js',content:helper,expectedRevision:1,requestId:randomUUID()});
  await call('file',{action:'create',path:'shaders/pulse.glsl',content:'vec3 tint = vec3(1.0);',expectedRevision:2,requestId:randomUUID()});
  await expect(page.getByLabel('项目文件列表')).toContainText('lib/motion.js');
  await expect(page.getByLabel('项目文件列表')).toContainText('shaders/pulse.glsl');
  await call('run',{requestId:randomUUID()});
  const canvas=page.locator('.studio-code-project-viewport canvas');
  await expect(canvas).toBeVisible();
  const first=await client.callTool({name:'scene_observe',arguments:{}});
  const observation=JSON.parse(first.content[0].text);
  expect(observation.project.entities[0].state).toMatchObject({
   motionRate:1,hue:'ff0000',text:'vec3 tint = vec3(1.0);'
  });
  await page.getByRole('button',{name:'lib/motion.js',exact:true}).click();
  await page.getByLabel('文件内容 lib/motion.js').fill(helper.replace('motionRate = 1','motionRate = 2'));
  await page.getByRole('button',{name:'保存源码草稿',exact:true}).click();
  await expect(page.locator('.code-project-editor output').first()).toHaveText('源码草稿已保存');
  const edited=await call('file_read',{path:'lib/motion.js'});
  expect(edited.revision).toBe(4);
  expect(edited.content).toContain('motionRate = 2');
  const stale=await client.callTool({name:'studio_project',arguments:{operation:'file',
    action:'patch',path:'lib/motion.js',oldText:'motionRate = 2',newText:'motionRate = 99',
    expectedRevision:1,requestId:randomUUID()}});
  expect(stale.isError).toBe(true);
  expect(JSON.parse(stale.content[0].text).code).toBe('PROJECT_REVISION_CONFLICT');
  await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
  await expect(page.locator('.code-project-editor output').first()).toHaveText('代码世界运行中');
  const reobserved=await client.callTool({name:'scene_observe',arguments:{}});
  expect(JSON.parse(reobserved.content[0].text).project.entities[0].state.motionRate).toBe(2);

  await page.getByLabel('新增文件路径').fill('notes/readme.txt');
  await page.getByRole('button',{name:'新增文件',exact:true}).click();
  await page.getByLabel('文件内容 notes/readme.txt').fill('project notes');
  await page.getByRole('button',{name:'保存源码草稿',exact:true}).click();
  // Browser actions only schedule an async write. Wait for its persisted revision
  // before starting another batch or the next call can race with PROJECT_BUSY.
  await expect(page.locator('.code-project-editor output').first()).toHaveText('源码草稿已保存');
  const resourceInput=page.locator('.code-project-editor input[type="file"]').last();
  await resourceInput.setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('embedded bytes')});
  await expect(page.locator('.code-project-editor output').first()).toHaveText('资源文件已导入');
  await expect(page.locator('.code-project-resources')).toContainText('note.txt');
  await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
  await saveWorldAndWait(page);
  const saved=await call('save');
  expect(saved.value.files['lib/motion.js']).toContain('motionRate = 2');
  expect(saved.value.files['notes/readme.txt']).toBe('project notes');
  expect(saved.value.resources['note.txt'].mime).toBe('text/plain');

  await page.reload();
  await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await page.getByRole('button',{name:'代码世界',exact:true}).click();
  await page.getByLabel('本机代码项目').selectOption({label:'多文件Studio'});
  await page.getByRole('button',{name:'打开代码项目',exact:true}).click();
  await expect(page.getByLabel('项目文件列表')).toContainText('notes/readme.txt');
  await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
  await expect(page.locator('.code-project-actions')).toContainText('"motionRate": 2');
  expect(errors).toEqual([]);
 } finally {await client?.close().catch(()=>{});await server?.close();await rm(root,{recursive:true,force:true});}
});

test('Studio imports the distributable multi-file ShaderMaterial example and restores custom actions',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?page=world');
 await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
 await page.getByRole('button',{name:'代码世界',exact:true}).click();
 await page.locator('.code-project-editor input[type="file"]').first()
   .setInputFiles(path.resolve('examples/code-project/multifile-studio.json'));
 await expect(page.getByLabel('项目文件列表')).toContainText('shaders/glow.frag');
 await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
 const canvas=page.locator('.studio-code-project-viewport canvas');
 await expect(canvas).toBeVisible();
 const screenshot=await canvas.screenshot({path:testInfo.outputPath('multi-file-glow.png')});
 expect(Math.max(...(await sharp(screenshot).stats()).channels.slice(0,3).map(c=>c.stdev))).toBeGreaterThan(4);
 await page.getByRole('button',{name:'对象属性',exact:true}).click();
 await page.locator('.code-project-action > summary').filter({hasText:'setSpeed'}).click();
 await page.getByLabel('动作参数 speed').fill('2');
 await page.getByRole('button',{name:'执行 setSpeed',exact:true}).click();
 await expect(page.locator('.code-project-action output')).toHaveText('已验证');
 await saveWorldAndWait(page);
 await page.reload();await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
 await page.getByRole('button',{name:'代码世界',exact:true}).click();
 await page.getByLabel('本机代码项目').selectOption({label:'多文件发光雕塑'});
 await page.getByRole('button',{name:'打开代码项目',exact:true}).click();
 await page.getByRole('button',{name:'运行代码世界',exact:true}).click();
 await page.getByRole('button',{name:'对象属性',exact:true}).click();
 await expect(page.locator('.code-project-actions')).toContainText('"speed": 2');
 expect(errors).toEqual([]);
});
