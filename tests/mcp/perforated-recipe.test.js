import {expect,it} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';
import {createHeadlessGLTFLoader} from '../../apps/mcp-server/HeadlessGLTFLoader.js';

it('preserves a 60-hole two-layer bench through MCP compilation, world-file restore and GLB export',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'perforated-recipe-'));
  const token=randomBytes(32).toString('hex'),headers={Authorization:'Bearer '+token};
  const app=await startServer({root,dataRoot:path.join(root,'assets'),port:0,tokens:[{identity:'test',token}]});
  const origin='http://127.0.0.1:'+app.port;
  const client=new Client({name:'perforated-recipe',version:'1'});
  const call=async(name,args={})=>{
    const response=await client.callTool({name,arguments:args});
    const value=JSON.parse(response.content[0].text);
    expect(response.isError,JSON.stringify(value)).toBeFalsy();
    expect(value.status).not.toBe('failed');
    return value;
  };
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers}}));
    const session={worldSessionId:(await call('session_create')).worldSessionId};
    const holes=Array.from({length:60},(_,i)=>({center:[-1.18+Math.floor(i/5)*.215,-.4+i%5*.2],radius:.018}));
    const asset={schema:'agentscape.asset-recipe',schemaVersion:1,id:'test/bench',parts:[
      {id:'top',position:[0,.93,0],geometry:{type:'perforated-box',size:[2.65,.075,1.05],holes}},
      {id:'backing',position:[0,.8325,0],geometry:{type:'perforated-box',size:[2.55,.12,.95],holes}}
    ]};
    await call('scene_add_model',{...session,requestId:randomUUID(),model:{id:'bench',position:[0,0,0],asset}});
    const file=(await call('scene_save',{...session,format:'world-file'})).value;
    const reopened={worldSessionId:(await call('session_create')).worldSessionId};
    await call('scene_import',{...reopened,requestId:randomUUID(),fileId:file.fileId});
    const result=await call('scene_export_glb',{...reopened,options:{objectIds:['bench']}});
    const response=await fetch(origin+'/files/'+result.fileId+'/content',{headers});
    expect(response.status).toBe(200);
    const bytes=Buffer.from(await response.arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.sha256);
    const scene=await createHeadlessGLTFLoader().loadBytes(bytes);
    scene.updateMatrixWorld(true);
    const hits=(x,z)=>new THREE.Raycaster(new THREE.Vector3(x,1.3,z),new THREE.Vector3(0,-1,0),0,.6).intersectObject(scene,true);
    expect(holes.filter(({center:[x,z]})=>hits(x,z).length===0)).toHaveLength(60);
    expect(hits(0,0).length).toBeGreaterThan(0);
  }finally{
    await client.close();await app.close();await rm(root,{recursive:true,force:true});
  }
});
