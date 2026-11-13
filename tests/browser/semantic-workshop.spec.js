import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';

test('real Chromium + HTTP MCP drive a declarative book and cooker, save and reopen visual state',async({page})=>{
  const project=JSON.parse(await readFile('examples/code-project/semantic-workshop.json','utf8'));
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-workshop-'));
  const token=randomBytes(32).toString('hex'),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  let app,client;
  try {
    app=await startServer({tokens:[{identity:'workshop',token}],root,port:0,
      dataRoot:path.join(root,'assets'),studioOrigins:['http://127.0.0.1:4178']});
    client=new Client({name:'semantic-workshop-e2e',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+app.port+'/mcp'),
      {requestInit:{headers:{Authorization:'Bearer '+token}}}));
    const call=async(name,args={})=>{
      const response=await client.callTool({name,arguments:args});
      const value=JSON.parse(response.content[0].text);
      expect(response.isError,JSON.stringify(value)).toBeFalsy();
      return value;
    };
    const invoke=async(target,name)=>{
      const job=await call('scene_interact',{requestId:randomUUID(),
        interaction:{action:'invoke',target,name}});
      await expect.poll(async()=>(await call('scene_job',{jobId:job.id})).status).toBe('succeeded');
      const finished=await call('scene_job',{jobId:job.id});
      expect(finished.result.verification.status).toBe('verified');
    };
    await page.goto('/examples/code-project/?mcpPort='+app.port);
    await page.evaluate(project=>window.codeProjectDemo.open(project),project);
    await expect(page.getByRole('status')).toContainText('项目已运行');
    await page.getByLabel('连接本机 MCP').check();
    await expect(page.locator('#bridge')).toHaveText('MCP connected');
    await call('session_attach');
    const observed=await call('scene_observe');
    const book=observed.project.entities.find(entity=>entity.id==='book_01');
    const cooker=observed.project.entities.find(entity=>entity.id==='cooker_01');
    expect(book.capabilities.find(c=>c.name==='turnPage').available).toBe(false);
    expect(cooker.actions.map(action=>action.name)).toContain('startCook');
    expect(cooker.actions.map(action=>action.name)).not.toContain('completeCook');

    await invoke('book_01','openBook');
    await invoke('book_01','turnPage');
    const visual=await page.evaluate(()=>{
      const native=window.codeProjectDemo.session.scene.native.scene;
      const page=native.getObjectByName('Page_1'), cover=native.getObjectByName('BookCoverHinge');
      return {page:page.rotation.y,cover:cover.rotation.z};
    });
    expect(visual.page).toBeCloseTo(-Math.PI,3);
    expect(visual.cover).toBeCloseTo(-2.5,3);
    await invoke('cooker_01','openLid');
    await invoke('cooker_01','addRice');
    expect(await page.evaluate(()=>window.codeProjectDemo.session.scene.native.scene.getObjectByName('RicePortion').position.x)).toBeCloseTo(0,3);
    await invoke('cooker_01','closeLid');
    await invoke('cooker_01','startCook');
    await expect.poll(async()=>(await call('scene_observe',{target:'cooker_01'})).state.mode,
      {timeout:15000}).toBe('done');

    const saved=await call('scene_save');
    expect(saved.value.machines.entities).toMatchObject({
      book_01:{page:1,cover:'open'},cooker_01:{mode:'done',contents:'cooked',elapsed:3}
    });
    await page.reload();
    await page.evaluate(project=>window.codeProjectDemo.open(project),saved.value);
    expect(await page.evaluate(()=>window.codeProjectDemo.session.scene.inspect('book_01').state.page)).toBe(1);
    expect(await page.evaluate(()=>window.codeProjectDemo.session.scene.native.scene.getObjectByName('Page_1').rotation.y)).toBeCloseTo(-Math.PI,3);
    expect(await page.evaluate(()=>window.codeProjectDemo.session.scene.native.scene.getObjectByName('RicePortion').position.x)).toBeCloseTo(0,3);
    expect(errors).toEqual([]);
  } finally {
    await client?.close().catch(()=>{});
    await app?.close();
    await rm(root,{recursive:true,force:true});
  }
});
