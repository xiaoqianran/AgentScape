import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';

const source="export function createProject({THREE,container}){\n  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,100);\n  scene.background=new THREE.Color('#e3ebe1');camera.position.set(3.5,3,4);camera.lookAt(.9,.6,0);\n  const renderer=new THREE.WebGLRenderer({antialias:true});container.appendChild(renderer.domElement);\n  const resize=new ResizeObserver(()=>{const w=container.clientWidth||1,h=container.clientHeight||1;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(container);\n  const make=(size)=>new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial({color:0x9e8d66}));\n  const floor=make([20,.2,20]);floor.position.y=-.1;scene.add(floor);\n  const machine=new THREE.Group();machine.name='NativeMachine';machine.position.set(.9,.85,0);scene.add(machine);\n  const base=make([.4,.4,.4]);base.position.y=-.45;machine.add(base);\n  const hinge=new THREE.Group();hinge.name='Hinge';hinge.position.set(0,0,.22);machine.add(hinge);\n  const panel=make([.42,.38,.08]);panel.position.x=.21;hinge.add(panel);\n  const drawer=make([.36,.2,.36]);drawer.name='Drawer';drawer.position.set(0,0,-.55);machine.add(drawer);\n  const rootPhysics={body:'fixed',colliders:[{shape:'box',halfExtents:[.2,.2,.2],translation:[0,-.45,0]}]};\n  const parts={\n    hinge:{node:'Hinge',physics:{body:'dynamic',mass:.5,colliders:[{shape:'box',halfExtents:[.21,.19,.04],translation:[.21,0,0]}]},\n      joint:{type:'revolute',axis:[0,1,0],limits:[0,.9],motor:{stiffness:120,damping:16}}},\n    drawer:{node:'Drawer',physics:{body:'dynamic',mass:1,colliders:[{shape:'box',halfExtents:[.18,.1,.18]}]},\n      joint:{type:'prismatic',axis:[0,0,-1],limits:[0,.6],motor:{stiffness:100,damping:15}}}\n  };\n  return {scene,camera,renderer,walkableMesh:floor,dispose(){resize.disconnect();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();},\n    async setup({scene:api}){\n      api.native.bindComponent({id:'machine',object:machine,physics:rootPhysics,parts});\n      if(!api.actors().agents.some(a=>a.id==='actor'))await api.addModel({id:'actor',asset:'builtin://agent',position:[0,0,0]});\n    }\n  };\n}";
test('native revolute and prismatic joints through live Studio MCP and saved history',async({page})=>{
  test.setTimeout(90000);
  const root=await mkdtemp(path.join(tmpdir(),'native-articulation-mcp-'));
  const token=randomBytes(32).toString('hex');let server,client;
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  try{
    server=await startServer({tokens:[{identity:'native-joints-mcp',token}],root,port:0,dataRoot:path.join(root,'assets'),studioOrigins:[test.info().project.use.baseURL]});
    client=new Client({name:'native-joints-mcp',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
    const call=async(name,args={})=>{
      const response=await client.callTool({name,arguments:args});
      expect(response.isError,response.content[0].text).toBeFalsy();return JSON.parse(response.content[0].text);
    };
    const invoke=async(partName,name,args)=>{
      const job=await call('scene_interact',{requestId:randomUUID(),interaction:{action:'invoke',actor:'actor',target:'machine',partName,name,source:'native-physics',args}});
      let terminal;
      await expect.poll(async()=>{terminal=await call('scene_job',{jobId:job.id});return terminal.status;},{timeout:25000}).not.toBe('running');
      expect(terminal.status,JSON.stringify(terminal)).toBe('succeeded');return terminal.result.value;
    };
    const read=()=>call('scene_observe',{target:'machine',actor:'actor'});
    const joint=async part=>(await read()).physics.joints.find(j=>j.partName===part);
    const criterion=(partName,capability)=>({id:partName,kind:'interaction-verified',targetId:'machine',partName,capability,source:'native-physics'});
    await page.goto('/studio/?page=world&mcpPort='+server.port);
    await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
    await expect.poll(async()=>{try{return (await call('session_attach')).connected;}catch{return false;}},{timeout:40000}).toBe(true);
    await call('studio_project',{operation:'create',name:'Native machine',source,requestId:randomUUID()});
    const running=await call('studio_project',{operation:'run',requestId:randomUUID()});
    const query=()=>call('scene_query',{operation:'search',expectedRevision:running.revision,query:'Hinge'});
    const uuid=(await query()).items[0].objectUuid;
    expect((await read()).capabilities).toEqual(expect.arrayContaining([expect.objectContaining({partName:'hinge',name:'rotateJoint',source:'native-physics'}),expect.objectContaining({partName:'drawer',name:'slide',source:'native-physics'})]));
    expect(await invoke('hinge','rotateJoint',{target:.55})).toMatchObject({physicsVerified:true,partName:'hinge',historyRecorded:true});
    expect(await invoke('drawer','slide',{target:.3})).toMatchObject({physicsVerified:true,partName:'drawer',historyRecorded:true});
    const proof=await call('scene_verify',{criteria:[criterion('hinge','ROTATEJOINT'),criterion('drawer','SLIDE')],snapshot:'visual'});
    expect(proof.verification.status).toBe('verified');
    expect(proof.snapshot.image.playback.frames).toBe(proof.snapshot.frame);
    const pixels=await sharp(Buffer.from(proof.snapshot.image.imageBase64,'base64')).stats();
    expect(Math.max(...pixels.channels.slice(0,3).map(c=>c.stdev))).toBeGreaterThan(4);
    await call('scene_history',{operation:'undo',requestId:randomUUID()});
    expect((await joint('drawer')).coordinate).toBeCloseTo(0,1);
    await call('scene_history',{operation:'redo',requestId:randomUUID()});
    expect((await joint('drawer')).coordinate).toBeCloseTo(.3,1);
    expect((await query()).items[0].objectUuid).toBe(uuid);
    expect((await call('studio_project',{operation:'save'})).status).toBe('succeeded');
    const rerun=await call('studio_project',{operation:'run',requestId:randomUUID()});
    expect(rerun.runtimeId).not.toBe(running.runtimeId);
    expect(rerun.nativeRestore).toEqual({restored:1,skipped:[]});
    expect((await joint('drawer')).coordinate).toBeCloseTo(.3,1);
    expect((await joint('hinge')).coordinate).toBeCloseTo(.55,1);
    expect((await call('scene_verify',{criteria:[criterion('hinge','ROTATEJOINT')]})).verification.status).toBe('unverified');
    await invoke('hinge','rotateJoint',{target:0});await invoke('drawer','slide',{target:0});
    expect((await joint('hinge')).coordinate).toBeCloseTo(0,1);expect((await joint('drawer')).coordinate).toBeCloseTo(0,1);
    expect(pageErrors).toEqual([]);
  }finally{await client?.close().catch(()=>{});await server?.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
});
