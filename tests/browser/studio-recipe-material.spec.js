import {test,expect,waitForRuntimeReady} from './fixtures.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';
import sharp from 'sharp';

test('Studio previews real PBR textures and commits only the selected Recipe instance through MCP shared Forge',async({page},testInfo)=>{
  test.setTimeout(300000);
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-material-ui-'));
  const token=randomBytes(32).toString('hex');
  const port=Number(process.env.AGENTSCAPE_TEST_PORT||4178);
  const app=await startServer({tokens:[{identity:'owner',token}],port:0,root,dataRoot:path.join(root,'assets'),
    studioOrigins:['http://127.0.0.1:'+port,'http://localhost:'+port]});
  const client=new Client({name:'studio-material-ui-test',version:'1'});
  const call=async(name,args={})=>{
    const response=await client.callTool({name,arguments:args});
    const value=JSON.parse(response.content[0].text);
    expect(response.isError,JSON.stringify(value)).toBeFalsy();
    return value;
  };
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+app.port+'/mcp'),{
      requestInit:{headers:{Authorization:'Bearer '+token}}}));
    await page.goto('/studio/?page=world&world=industrial-cabinet-lab&renderer=webgl&mcpPort='+app.port);
    await waitForRuntimeReady(page);
    await expect(page.locator('.studio-mcp-connection')).toHaveAttribute('data-bridge-state','connected',{timeout:30000});
    const recipe={schema:'agentscape.asset-recipe',schemaVersion:1,id:'ui/board',
      parts:[{id:'board',geometry:{type:'box',size:[1,.15,1]},material:{color:'#c09060',roughness:.7}}]};
    for(const [id,x] of [['material_a',0],['material_b',2]])await call('scene_add_model',{requestId:randomUUID(),
      model:{id,asset:recipe,level:'visual',position:[x,1,0]}});
    const inspect=objectId=>call('scene_object_definition',{operation:'inspect',objectId});
    const before=await inspect('material_a'),other=await inspect('material_b');
    await page.locator('[data-object-id="material_a"]').click();
    await page.locator('.selection-action-dock').getByRole('button',{name:'属性',exact:true}).click();
    const editor=page.locator('.recipe-material-editor');
    await expect(editor).toBeVisible();
    await editor.locator(':scope > summary').click();
    await expect(editor.locator('.recipe-material-preview')).toHaveAttribute('data-preview-state','ready',{timeout:30000});
    const canvas=editor.getByRole('img',{name:'PBR 材质球实时预览'}).or(editor.locator('canvas'));
    const first=await canvas.screenshot();
    await expect(editor.getByLabel('程序纹理')).toBeDisabled();
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    await editor.getByLabel('程序纹理').selectOption('wood');
    await editor.getByLabel('纹理随机种子').fill('42');
    await expect(editor.locator('.recipe-material-preview')).toHaveAttribute('data-preview-state','ready',{timeout:30000});
    const textured=await canvas.screenshot();
    const image=await sharp(textured).stats();
    expect(image.channels[0].stdev).toBeGreaterThan(5);
    expect(textured.equals(first)).toBe(false);
    await testInfo.attach('material-preview',{body:textured,contentType:'image/png'});
    expect((await inspect('material_a')).assetId).toBe(before.assetId);
    await editor.getByRole('button',{name:'应用材质'}).click();
    const revisionOf=async()=>{try{return (await inspect('material_a')).revision;}
      catch(error){if(/STUDIO_TIMEOUT|STUDIO_BUSY|STUDIO_NOT_CONNECTED|STUDIO_DISCONNECTED/.test(error.message))return null;throw error;}};
    await expect.poll(revisionOf,{timeout:120000}).toBe(2);
    const after=await inspect('material_a');
    expect(after.definition.parts[0].material).toMatchObject({color:'#ffffff',texture:{pattern:'wood',seed:42}});
    expect(after.assetId).not.toBe(before.assetId);
    expect((await inspect('material_b')).assetId).toBe(other.assetId);
    await expect(editor.getByLabel('程序纹理')).toHaveValue('wood');
    const preview=await call('scene_object_definition',{operation:'preview',objectId:'material_a',expectedRevision:2,requestId:randomUUID(),
      changes:[{path:'/parts/@board/material/texture/pattern',value:'stone'}]});
    await call('scene_object_definition',{operation:'apply',objectId:'material_a',expectedRevision:2,previewId:preview.previewId,requestId:randomUUID()});
    await expect(editor.getByLabel('程序纹理')).toHaveValue('stone');
    await expect(editor.locator('.recipe-material-preview')).toHaveAttribute('data-preview-state','ready',{timeout:30000});
    await testInfo.attach('material-editor',{body:await editor.screenshot(),contentType:'image/png'});
  }finally{
    await page.close().catch(()=>{});await client.close().catch(()=>{});await app.close();await rm(root,{recursive:true,force:true});
  }
});
