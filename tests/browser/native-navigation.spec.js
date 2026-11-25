import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';

const source="export function createProject({THREE,container}){\n  const scene=new THREE.Scene();scene.background=new THREE.Color('#dbe8df');\n  const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(5,9,13);camera.lookAt(3,.6,0);\n  const renderer=new THREE.WebGLRenderer({antialias:true});container.appendChild(renderer.domElement);\n  const resize=new ResizeObserver(()=>{const w=container.clientWidth||1,h=container.clientHeight||1;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(container);\n  const make=(size,position,color)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial({color}));mesh.position.fromArray(position);return mesh;};\n  const terrain=new THREE.Group();terrain.name='Original native terrain';scene.add(terrain);\n  terrain.add(make([10,.2,2.4],[0,-.1,0],0x79927e));\n  for(let n=1;n<=8;n++){const h=n*.16;terrain.add(make([.5,h+.1,2.4],[5+(n-.5)*.5,(h-.1)/2,0],0x8b8066));}\n  terrain.add(make([3,1.38,2.4],[10.5,.59,0],0x79927e));\n  const gate=new THREE.Group();gate.name='Gate assembly';scene.add(gate);\n  const door=make([.22,2.4,3.2],[0,1.2,0],0xd8a248);door.name='Gate';gate.add(door);\n  return {scene,camera,renderer,staticMeshes:[terrain],\n    async setup({scene:api}){\n      api.native.bindComponent({id:'gate',object:gate,physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.12,.1,.1],translation:[0,-.2,0]}]},\n        parts:{gate:{node:'Gate',physics:{body:'dynamic',mass:.35,colliders:[{shape:'box',halfExtents:[.11,1.2,1.6]}]},\n        joint:{type:'prismatic',axis:[0,1,0],limits:[0,2.8],motor:{stiffness:600,damping:45}}}}});\n      if(!api.actors().agents.some(a=>a.id==='actor'))await api.addModel({id:'actor',asset:'builtin://agent',position:[-1.2,0,0]});\n    },\n    dispose(){resize.disconnect();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();}\n  };\n}";
test('native terrain, solver gate and upstairs locomotion through real Studio MCP',async({page})=>{
  test.setTimeout(90000);
  const root=await mkdtemp(path.join(tmpdir(),'native-navigation-mcp-'));
  const token=randomBytes(32).toString('hex');let server,client;
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  try{
    server=await startServer({tokens:[{identity:'native-nav-mcp',token}],root,port:0,dataRoot:path.join(root,'assets'),studioOrigins:[test.info().project.use.baseURL]});
    client=new Client({name:'native-nav-mcp',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
    const call=async(name,args={})=>{
      const response=await client.callTool({name,arguments:args});
      expect(response.isError,response.content[0].text).toBeFalsy();return JSON.parse(response.content[0].text);
    };
    const action=async interaction=>{
      const job=await call('scene_interact',{requestId:randomUUID(),interaction});let terminal;
      await expect.poll(async()=>{terminal=await call('scene_job',{jobId:job.id});return terminal.status;},{timeout:30000}).not.toBe('running');
      return terminal;
    };
    const navigate=position=>action({action:'navigate',actor:'actor',position});
    await page.goto('/studio/?page=world&mcpPort='+server.port);
    await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
    await expect.poll(async()=>{try{return (await call('session_attach')).connected;}catch{return false;}},{timeout:40000}).toBe(true);
    await call('studio_project',{operation:'create',name:'Native terrain',source,requestId:randomUUID()});
    const running=await call('studio_project',{operation:'run',requestId:randomUUID()});
    const closed=await navigate([3,0,0]);expect(closed.status,JSON.stringify(closed)).toBe('failed');
    const before=await call('scene_observe',{target:'gate'});
    const diagnosis=await call('scene_navigation',{actor:'actor',position:[10.5,1.28,0]});
    expect(diagnosis,JSON.stringify(diagnosis)).toMatchObject({status:'action-candidate',current:{reachable:false},
      recommendation:{provisional:true,interaction:{target:'gate',partName:'gate',source:'native-physics'}}});
    expect(diagnosis.candidates.some(c=>c.counterfactual.assumption==='joint-target-pose'&&c.counterfactual.reachable)).toBe(true);
    expect((await call('scene_observe',{target:'gate'})).physics.joints[0].coordinate).toBeCloseTo(before.physics.joints[0].coordinate,2);
    expect((await call('scene_navigation',{actor:'actor',position:[10.5,1.28,0]})).current.reachable).toBe(false);
    const opened=await action(diagnosis.recommendation.interaction);
    expect(opened,JSON.stringify(opened)).toMatchObject({status:'succeeded',result:{value:{physicsVerified:true}}});
    expect((await call('scene_navigation',{actor:'actor',position:[10.5,1.28,0]})).current.reachable).toBe(true);
    const upstairs=await navigate([10.5,1.28,0]);
    expect(upstairs,JSON.stringify(upstairs)).toMatchObject({status:'succeeded',result:{value:{status:'arrived'}}});
    const position=upstairs.result.value.position;expect(position[0]).toBeGreaterThan(10.1);expect(position[1]).toBeGreaterThan(1.1);
    const proof=await call('scene_verify',{criteria:[{id:'gate',kind:'interaction-verified',targetId:'gate',partName:'gate',capability:'SLIDE',source:'native-physics'},{id:'actor',kind:'object-exists',targetId:'actor'}],snapshot:'visual'});
    expect(proof.verification.status).toBe('verified');expect(proof.snapshot.image.playback.frames).toBe(proof.snapshot.frame);
    const pixels=await sharp(Buffer.from(proof.snapshot.image.imageBase64,'base64')).stats();
    expect(Math.max(...pixels.channels.slice(0,3).map(c=>c.stdev))).toBeGreaterThan(4);
    expect((await call('studio_project',{operation:'save'})).status).toBe('succeeded');
    const rerun=await call('studio_project',{operation:'run',requestId:randomUUID()});
    expect(rerun.runtimeId).not.toBe(running.runtimeId);expect(rerun.nativeRestore).toEqual({restored:1,skipped:[]});
    const gate=(await call('scene_observe',{target:'gate'})).physics.joints[0];expect(gate.coordinate).toBeCloseTo(diagnosis.recommendation.interaction.args.target,1);
    const downstairs=await navigate([-2,0,0]);expect(downstairs,JSON.stringify(downstairs)).toMatchObject({status:'succeeded',result:{value:{status:'arrived'}}});
    expect(downstairs.result.value.position[0]).toBeLessThan(-1.7);expect(Math.abs(downstairs.result.value.position[1])).toBeLessThan(.2);
    expect(pageErrors).toEqual([]);
  }finally{await client?.close().catch(()=>{});await server?.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
});
