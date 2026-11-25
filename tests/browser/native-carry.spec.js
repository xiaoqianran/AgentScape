import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';

const source="export function createProject({THREE,container}){\n  const scene=new THREE.Scene();scene.background=new THREE.Color('#dbe8d8');\n  const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(5,4,7);camera.lookAt(1.4,.6,0);\n  const renderer=new THREE.WebGLRenderer({antialias:true});container.appendChild(renderer.domElement);\n  const resize=new ResizeObserver(()=>{const w=container.clientWidth||1,h=container.clientHeight||1;\n    renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(container);\n  const make=(size,color)=>new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial({color}));\n  const ground=make([20,.2,20],0x61795e);ground.position.y=-.1;scene.add(ground);\n  const load=make([.26,.26,.26],0xf0a42e);load.name='Original load';load.position.set(.72,.13,0);scene.add(load);\n  const support=make([1.1,.8,1.1],0x8b6849);support.name='Original support';support.position.set(3.1,.4,0);scene.add(support);\n  return {scene,camera,renderer,walkableMesh:ground,\n    async setup({scene:api}){\n      api.native.bindComponent({id:'load',object:load,physics:{body:'dynamic',mass:1,manipulable:true,carryable:true,colliders:'mesh-bounds'}});\n      api.native.bindComponent({id:'support',object:support,physics:{body:'fixed',colliders:'mesh-bounds'},\n        surfaces:[{id:'top',localPosition:[0,.4,0],size:[1.1,1.1]}]});\n      if(!api.actors().agents.some(a=>a.id==='actor')) await api.addModel({id:'actor',asset:'builtin://agent',position:[0,0,0]});\n    },\n    dispose(){resize.disconnect();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();}\n  };\n}";
test('real Studio MCP pushes, picks up, carries and places the original native Three.js body',async({page})=>{
  const root=await mkdtemp(path.join(tmpdir(),'native-carry-mcp-'));
  const token=randomBytes(32).toString('hex');let server,client;
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  try{
    server=await startServer({tokens:[{identity:'native-carry-mcp',token}],root,port:0,
      dataRoot:path.join(root,'assets'),studioOrigins:[test.info().project.use.baseURL]});
    client=new Client({name:'native-carry-mcp',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.port+'/mcp'),{
      requestInit:{headers:{Authorization:'Bearer '+token}}
    }));
    const call=async(name,args={})=>{
      const response=await client.callTool({name,arguments:args});
      const value=JSON.parse(response.content[0].text);
      expect(response.isError,JSON.stringify(value)).toBeFalsy();
      return value;
    };
    const action=async(interaction)=>{
      const job=await call('scene_interact',{requestId:randomUUID(),interaction});let terminal;
      await expect.poll(async()=>{terminal=await call('scene_job',{jobId:job.id});return terminal.status;},{timeout:25000}).not.toBe('running');
      expect(terminal.status,JSON.stringify(terminal)).toBe('succeeded');return terminal.result.value;
    };
    const invoke=(target,name,args={})=>action({action:'invoke',actor:'actor',target,name,source:'native-physics',args});
    const read=target=>call('scene_observe',{target,actor:'actor'});
    const receipt=(targetId,capability)=>({id:capability.toLowerCase(),kind:'interaction-verified',targetId,capability,source:'native-physics'});
    await page.goto('/studio/?page=world&mcpPort='+server.port);
    await expect(page.locator('#runtime-status')).toHaveAttribute('data-state','ready',{timeout:60000});
    await expect.poll(async()=>{try{return (await call('session_attach')).connected;}catch{return false;}},{timeout:40000}).toBe(true);
    await call('studio_project',{operation:'create',name:'Native carry',source,requestId:randomUUID()});
    const running=await call('studio_project',{operation:'run',requestId:randomUUID()});
    const search=await call('scene_query',{operation:'search',expectedRevision:running.revision,query:'Original load'});
    const uuid=search.items[0].objectUuid;
    expect((await read('load')).capabilities).toEqual(expect.arrayContaining([expect.objectContaining({name:'push',source:'native-physics',available:true}),expect.objectContaining({name:'pickup',source:'native-physics',available:true})]));
    const push=await invoke('load','push',{direction:[1,0,0],distance:.2});
    expect(push).toMatchObject({physicsVerified:true,historyRecorded:true,evidenceKind:'rigid-body-force'});
    expect((await call('scene_verify',{criteria:[receipt('load','PUSH')]})).verification.status).toBe('verified');
    const pick=await invoke('load','pickup');expect(pick).toMatchObject({status:'held',graspVerified:false});
    expect((await read('load')).physics.state).toMatchObject({held:true,heldById:'actor',body:'kinematic'});
    const saved=await call('studio_project',{operation:'save'});
    expect(saved.status).toBe('succeeded');
    const carry=await action({action:'navigate',actor:'actor',position:[1.25,0,-.8]});
    expect(carry).toMatchObject({heldId:'load',status:'arrived',graspVerified:false});
    const place=await invoke('support','place',{surfaceId:'top'});
    expect(place).toMatchObject({physicsVerified:true,settled:true,supportVerified:true,support:{contactVerified:true}});
    expect((await read('load')).physics.state).toMatchObject({held:false,heldById:null,body:'dynamic'});
    const after=await call('scene_query',{operation:'search',expectedRevision:running.revision,query:'Original load'});
    expect(after.items[0].objectUuid).toBe(uuid);
    const proof=await call('scene_verify',{criteria:[receipt('load','PICKUP'),receipt('load','CARRY'),receipt('support','PLACE'),
      {id:'released',kind:'state-equals',targetId:'load',source:'native-physics',stateKey:'held',value:false}],snapshot:'visual'});
    expect(proof.verification.status).toBe('verified');
    expect(proof.snapshot.image.playback.frames).toBe(proof.snapshot.frame);
    const pixels=await sharp(Buffer.from(proof.snapshot.image.imageBase64,'base64')).stats();
    expect(Math.max(...pixels.channels.slice(0,3).map(c=>c.stdev))).toBeGreaterThan(4);
    await call('scene_history',{operation:'undo',requestId:randomUUID()});
    expect((await read('load')).physics.state).toMatchObject({held:true,heldById:'actor',body:'kinematic'});
    await call('scene_history',{operation:'redo',requestId:randomUUID()});
    expect((await read('load')).physics.state).toMatchObject({held:false,body:'dynamic'});
    await call('scene_history',{operation:'undo',requestId:randomUUID()});
    const heldSave=await call('studio_project',{operation:'save'});
    expect(heldSave.status).toBe('succeeded');
    const rerun=await call('studio_project',{operation:'run',requestId:randomUUID()});
    expect(rerun.runtimeId).not.toBe(running.runtimeId);
    expect(rerun.nativeRestore).toEqual({restored:2,skipped:[]});
    expect((await read('load')).physics.state).toMatchObject({held:true,heldById:'actor',body:'kinematic'});
    expect((await call('scene_verify',{criteria:[receipt('load','PICKUP')]})).verification.status).toBe('unverified');
    await invoke('support','place',{surfaceId:'top'});
    expect((await read('load')).physics.state).toMatchObject({held:false,body:'dynamic'});
    expect(pageErrors).toEqual([]);
  }finally{await client?.close().catch(()=>{});await server?.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
});
