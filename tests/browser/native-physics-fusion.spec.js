import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';

const source="export function createProject({THREE,container}){\n  const scene=new THREE.Scene();scene.background=new THREE.Color('#dbe8d8');\n  const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(5,4,7);camera.lookAt(0,1,0);\n  const renderer=new THREE.WebGLRenderer({antialias:true});container.appendChild(renderer.domElement);\n  const resize=new ResizeObserver(()=>{const w=container.clientWidth||1,h=container.clientHeight||1;\n    renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(container);\n  const make=(size,color)=>new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial({color}));\n  const ground=make([10,.2,10],0x61795e);ground.position.y=-.1;scene.add(ground);\n  const gate=new THREE.Group();gate.name='Rail platform';gate.position.y=1;\n  for(const x of [-1.5,1.5]){const part=make([1,.2,2],0x8b6849);part.position.x=x;gate.add(part);}\n  const load=make([.4,.4,.4],0xf0a42e);load.name='Golden load';load.position.set(-1.5,3,0);\n  const gap=make([.4,.4,.4],0x4282b0);gap.name='Blue load';gap.position.set(0,3,0);\n  scene.add(gate,load,gap);let opened=false;\n  return {scene,camera,renderer,walkableMesh:ground,\n    setup({scene:api}){/* BINDINGS */},\n    dispose(){resize.disconnect();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();}\n  };\n}";
const bindings="api.native.bindComponent({id:'rail_platform',object:gate,physics:{body:'kinematic',colliders:'mesh-bounds'},\n      semantic:{read:()=>({opened})},actions:[{name:'open',execute(){gate.position.z=4;opened=true;},verify:({after})=>after.opened}]});\n      api.native.bindComponent({id:'golden_load',object:load,physics:{body:'dynamic',mass:1,colliders:'mesh-bounds'}});\n      api.native.bindComponent({id:'blue_load',object:gap,physics:{body:'dynamic',mass:1,colliders:'mesh-bounds'}});";

test('native mesh discovery, explicit source binding and physical behavior via real Studio MCP',async({page})=>{
  const root=await mkdtemp(path.join(tmpdir(),'native-physics-mcp-'));
  const token=randomBytes(32).toString('hex');let server,client;
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  try{
    server=await startServer({tokens:[{identity:'native-physics-mcp',token}],root,port:0,
      dataRoot:path.join(root,'assets'),studioOrigins:[test.info().project.use.baseURL]});
    client=new Client({name:'native-physics-mcp',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.port+'/mcp'),{
      requestInit:{headers:{Authorization:'Bearer '+token}}
    }));
    const call=async(name,args={})=>{
      const response=await client.callTool({name,arguments:args});
      const value=JSON.parse(response.content[0].text);
      expect(response.isError,JSON.stringify(value)).toBeFalsy();
      return value;
    };
    await page.goto('/studio/?page=world&mcpPort='+server.port);
    await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
    await expect.poll(async()=>{try{return (await call('session_attach')).connected;}catch{return false;}},{timeout:40000}).toBe(true);
    await call('studio_project',{operation:'create',name:'Native physics',source,requestId:randomUUID()});
    const first=await call('studio_project',{operation:'run',requestId:randomUUID()});
    const search=await call('scene_query',{operation:'search',expectedRevision:first.revision,query:'Rail platform'});
    const node=search.items[0];
    expect(node.name).toBe('Rail platform');
    const candidate=await call('scene_query',{operation:'physics_candidate',expectedRevision:first.revision,
      expectedRuntimeId:first.runtimeId,expectedSceneRevision:search.sceneRevision,nodePath:node.nodePath,objectUuid:node.objectUuid});
    expect(candidate).toMatchObject({status:'physics-candidate',meshCount:2,physicsVerified:false,colliderSource:'mesh-bounds'});
    expect((await call('scene_observe')).project.entities).toHaveLength(0);
    const patch=await call('studio_files',{operation:'patch',expectedRevision:first.revision,requestId:randomUUID(),
      oldText:'/* BINDINGS */',newText:bindings});
    const running=await call('studio_project',{operation:'run',expectedRevision:patch.revision,requestId:randomUUID()});
    expect(running.runtimeId).not.toBe(first.runtimeId);
    const stale=await client.callTool({name:'scene_query',arguments:{operation:'physics_candidate',expectedRevision:patch.revision,
      expectedRuntimeId:first.runtimeId,nodePath:node.nodePath,objectUuid:node.objectUuid}});
    expect(stale.isError).toBeTruthy();
    const observe=id=>call('scene_observe',{target:id});
    await expect.poll(async()=>Math.abs((await observe('golden_load')).physics.position[1]-1.3),{timeout:20000}).toBeLessThan(.08);
    await expect.poll(async()=>Math.abs((await observe('blue_load')).physics.position[1]-.2),{timeout:20000}).toBeLessThan(.08);
    const criteria=[{id:'body',kind:'state-equals',targetId:'golden_load',source:'native-physics',stateKey:'body',value:'dynamic'},
      {id:'colliders',kind:'state-equals',targetId:'rail_platform',source:'native-physics',stateKey:'colliderCount',value:2}];
    const proof=await call('scene_verify',{criteria,snapshot:'visual'});
    expect(proof.verification.status).toBe('verified');
    expect(proof.snapshot.image.playback.frames).toBe(proof.snapshot.frame);
    const pixels=await sharp(Buffer.from(proof.snapshot.image.imageBase64,'base64')).stats();
    expect(Math.max(...pixels.channels.slice(0,3).map(c=>c.stdev))).toBeGreaterThan(4);
    const job=await call('scene_interact',{requestId:randomUUID(),interaction:{action:'invoke',target:'rail_platform',name:'open',source:'project'}});
    await expect.poll(async()=>(await call('scene_job',{jobId:job.id})).status).toBe('succeeded');
    await expect.poll(async()=>Math.abs((await observe('golden_load')).physics.position[1]-.2),{timeout:20000}).toBeLessThan(.08);
    expect((await observe('rail_platform')).physics.position[2]).toBeCloseTo(4,2);
    expect((await observe('rail_platform')).state.opened).toBe(true);
    const saved=await call('studio_project',{operation:'save'});
    expect(saved.value.source).toContain("colliders:'mesh-bounds'");
    expect(pageErrors).toEqual([]);
  }finally{await client?.close().catch(()=>{});await server?.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
});
