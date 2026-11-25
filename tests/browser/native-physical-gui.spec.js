import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';

const navigationSource="export function createProject({THREE,container}){\n  const scene=new THREE.Scene();scene.background=new THREE.Color('#dbe8df');\n  const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(5,9,13);camera.lookAt(3,.6,0);\n  const renderer=new THREE.WebGLRenderer({antialias:true});container.appendChild(renderer.domElement);\n  const resize=new ResizeObserver(()=>{const w=container.clientWidth||1,h=container.clientHeight||1;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(container);\n  const make=(size,position,color)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial({color}));mesh.position.fromArray(position);return mesh;};\n  const terrain=new THREE.Group();terrain.name='Original native terrain';scene.add(terrain);\n  terrain.add(make([10,.2,2.4],[0,-.1,0],0x79927e));\n  for(let n=1;n<=8;n++){const h=n*.16;terrain.add(make([.5,h+.1,2.4],[5+(n-.5)*.5,(h-.1)/2,0],0x8b8066));}\n  terrain.add(make([3,1.38,2.4],[10.5,.59,0],0x79927e));\n  const gate=new THREE.Group();gate.name='Gate assembly';scene.add(gate);\n  const door=make([.22,2.4,3.2],[0,1.2,0],0xd8a248);door.name='Gate';gate.add(door);\n  return {scene,camera,renderer,staticMeshes:[terrain],\n    async setup({scene:api}){\n      api.native.bindComponent({id:'gate',object:gate,physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.12,.1,.1],translation:[0,-.2,0]}]},\n        parts:{gate:{node:'Gate',physics:{body:'dynamic',mass:.35,colliders:[{shape:'box',halfExtents:[.11,1.2,1.6]}]},\n        joint:{type:'prismatic',axis:[0,1,0],limits:[0,2.8],motor:{stiffness:600,damping:45}}}}});\n      if(!api.actors().agents.some(a=>a.id==='actor'))await api.addModel({id:'actor',asset:'builtin://agent',position:[-1.2,0,0]});\n    },\n    dispose(){resize.disconnect();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();}\n  };\n}";
const carrySource="export function createProject({THREE,container}){\n  const scene=new THREE.Scene();scene.background=new THREE.Color('#dbe8d8');\n  const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(5,4,7);camera.lookAt(1.4,.6,0);\n  const renderer=new THREE.WebGLRenderer({antialias:true});container.appendChild(renderer.domElement);\n  const resize=new ResizeObserver(()=>{const w=container.clientWidth||1,h=container.clientHeight||1;\n    renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(container);\n  const make=(size,color)=>new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial({color}));\n  const ground=make([20,.2,20],0x61795e);ground.position.y=-.1;scene.add(ground);\n  const load=make([.26,.26,.26],0xf0a42e);load.name='Original load';load.position.set(.72,.13,0);scene.add(load);\n  const support=make([1.1,.8,1.1],0x8b6849);support.name='Original support';support.position.set(3.1,.4,0);scene.add(support);\n  return {scene,camera,renderer,walkableMesh:ground,\n    async setup({scene:api}){\n      api.native.bindComponent({id:'load',object:load,physics:{body:'dynamic',mass:1,manipulable:true,carryable:true,colliders:'mesh-bounds'}});\n      api.native.bindComponent({id:'support',object:support,physics:{body:'fixed',colliders:'mesh-bounds'},\n        surfaces:[{id:'top',localPosition:[0,.4,0],size:[1.1,1.1]}]});\n      if(!api.actors().agents.some(a=>a.id==='actor')) await api.addModel({id:'actor',asset:'builtin://agent',position:[0,0,0]});\n    },\n    dispose(){resize.disconnect();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();}\n  };\n}";
async function fixture(page,source,run){
  const root=await mkdtemp(path.join(tmpdir(),'native-gui-mcp-')),token=randomBytes(32).toString('hex');
  let server,client;const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    server=await startServer({tokens:[{identity:'native-gui',token}],root,port:0,dataRoot:path.join(root,'assets'),studioOrigins:[test.info().project.use.baseURL]});
    client=new Client({name:'native-gui',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
    const call=async(name,args={})=>{
      const response=await client.callTool({name,arguments:args});
      expect(response.isError,response.content[0].text).toBeFalsy();return JSON.parse(response.content[0].text);
    };
    await page.goto('/studio/?page=world&mcpPort='+server.port);
    await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
    await expect.poll(async()=>{try{return (await call('session_attach')).connected;}catch{return false;}},{timeout:40000}).toBe(true);
    await call('studio_project',{operation:'create',name:'Native GUI',source,requestId:randomUUID()});
    const running=await call('studio_project',{operation:'run',requestId:randomUUID()});
    const panel=page.getByLabel('代码世界物理检查器');
    await expect(panel).toBeVisible();
    await run({call,panel,running});
    expect(errors).toEqual([]);
  }finally{await client?.close().catch(()=>{});await server?.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
}
const partCriterion=(targetId,capability,partName)=>({id:'receipt',kind:'interaction-verified',targetId,capability,source:'native-physics',...(partName?{partName}:{})});
test('GUI gate, shared selection, history and real navigation use the same MCP world',async({page})=>{
  test.setTimeout(110000);
  await fixture(page,navigationSource,async({call,panel})=>{
    const target=panel.getByLabel('交互对象'),choice=panel.locator('#affordance-choice'),execute=panel.locator('#execute-affordance');
    await target.selectOption('gate');
    await expect(panel.getByLabel('实时物理状态')).toContainText('gate');
    await page.getByRole('button',{name:'可视化',exact:true}).click();
    await expect(page.getByLabel('可视化对象列表')).toHaveValue('gate');
    await page.getByLabel('可视化对象列表').selectOption('actor');
    await expect(target).toHaveValue('actor');
    await page.getByLabel('可视化对象列表').selectOption('gate');
    await expect(target).toHaveValue('gate');
    await expect(panel.locator('#affordance-actor')).toHaveValue('actor');
    await panel.getByLabel('导航目标 X').fill('10.5');await panel.getByLabel('导航目标 Y').fill('1.28');
    await panel.getByRole('button',{name:'预览路线',exact:true}).click();
    await expect(panel.getByLabel('Agent 导航')).toContainText('不可通行');
    await choice.selectOption('slide:gate:native-physics');
    await panel.locator('#affordance-joint').fill('2.5');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(panel.getByLabel('物理交互')).toContainText('物理状态已验证',{timeout:25000});
    expect((await call('scene_verify',{criteria:[partCriterion('gate','SLIDE','gate')]})).verification.status).toBe('verified');
    const joint=async()=> (await call('scene_observe',{target:'gate'})).physics.joints[0].coordinate;
    expect(await joint()).toBeCloseTo(2.5,1);
    await call('scene_history',{operation:'undo',requestId:randomUUID()});
    await expect.poll(joint).toBeCloseTo(0,1);
    await expect(panel.getByLabel('物理交互')).not.toContainText('物理状态已验证');
    await panel.getByRole('button',{name:'重做最近操作'}).click();
    await expect.poll(joint).toBeCloseTo(2.5,1);
    await panel.getByRole('button',{name:'预览路线',exact:true}).click();
    await expect(panel.getByLabel('Agent 导航')).toContainText('路线可达');
    await expect(panel.getByRole('img',{name:'导航路线俯视预览'})).toBeVisible();
    await panel.getByRole('button',{name:'开始导航',exact:true}).click();
    await expect(panel.getByLabel('Agent 导航')).toContainText('状态已验证',{timeout:35000});
    const actor=await call('scene_observe',{target:'actor'});
    expect(actor.position[0]).toBeGreaterThan(10.1);expect(actor.position[1]).toBeGreaterThan(1.1);
    expect((await call('studio_project',{operation:'save'})).status).toBe('succeeded');
  });
});

test('GUI discovers native carry and a managed support, then MCP verifies the same contact',async({page})=>{
  test.setTimeout(95000);
  // Keep the original native load, replace its native support with a managed table.
  const source=carrySource.replace("api.native.bindComponent({id:'support',object:support,physics:{body:'fixed',colliders:'mesh-bounds'},\n        surfaces:[{id:'top',localPosition:[0,.4,0],size:[1.1,1.1]}]});",
    "scene.remove(support);if(!api.actors().agents.some(a=>a.id==='actor'))await api.addModel({id:'support',asset:'builtin://table',position:[3.1,0,0]});");
  expect(source).not.toBe(carrySource);
  await fixture(page,source,async({call,panel})=>{
    const target=panel.getByLabel('交互对象'),choice=panel.locator('#affordance-choice'),execute=panel.locator('#execute-affordance');
    await target.selectOption('load');await choice.selectOption('pickup::native-physics');
    await execute.click();await expect(panel.getByLabel('物理交互')).toContainText('状态已验证',{timeout:25000});
    expect((await call('scene_observe',{target:'load'})).physics.state.heldById).toBe('actor');
    // Closing and reopening the inspector must not erase the session's completed action presentation.
    await page.getByRole('button',{name:'关闭上下文面板',exact:true}).click();
    await page.locator('.utility-rail [data-dock-view="inspect"]').click();
    await expect(panel.getByLabel('物理交互')).toContainText('状态已验证');
    await target.selectOption('support');await choice.selectOption('place::asset');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(panel.getByLabel('物理交互')).toContainText('物理状态已验证',{timeout:30000});
    expect((await call('scene_observe',{target:'load'})).physics.state.held).toBe(false);
    expect((await call('scene_verify',{criteria:[partCriterion('support','PLACE')]})).verification.status).toBe('verified');
  });
});
