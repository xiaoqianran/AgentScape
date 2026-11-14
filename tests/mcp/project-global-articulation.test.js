import { it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';

it('publishes mechanical draft versions, retains articulated physics and restores pinned references',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-global-joint-'));
  const token=randomBytes(32).toString('hex');
  const app=await startServer({tokens:[{identity:'owner',token}],port:0,root:path.join(root,'sessions'),dataRoot:path.join(root,'assets')});
  const client=new Client({name:'joint-asset',version:'1'});
  const call=async(name,args={})=>{
    const response=await client.callTool({name,arguments:args});
    const data=JSON.parse(response.content[0].text);
    expect(response.isError,JSON.stringify(data)).toBeFalsy();
    return data;
  };
  const draft={
    schema:'agentscape.mechanical-draft',schemaVersion:1,name:'School Door',type:'school_door',
    components:[
      {id:'Frame',parent:null,shape:'box',position:[-.78,1,0],size:[.10,2,.12],color:'#778899',collision:true},
      {id:'Hinge',parent:null,shape:'group',position:[-.65,1,.1],size:[1,1,1],color:'#996633',collision:false},
      {id:'Panel',parent:'Hinge',shape:'box',position:[.65,0,0],size:[1.25,1.9,.06],color:'#b07849',collision:true}
    ],
    motions:[{id:'door',node:'Hinge',type:'revolute',axis:[0,1,0],limits:[0,1.57],open:1.4,mass:5}]
  };
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+app.port+'/mcp'),{
      requestInit:{headers:{Authorization:'Bearer '+token}}
    }));
    const first=(await call('session_create')).worldSessionId;
    await call('scene_add_model',{worldSessionId:first,requestId:randomUUID(),model:{
      id:'prototype_door',asset:draft,position:[0,0,7]
    }});
    const global=await call('asset_publish_project',{worldSessionId:first,requestId:randomUUID(),objectId:'prototype_door'});
    expect(global.published).toBe(true);
    const second=(await call('session_create')).worldSessionId;
    await call('scene_add_model',{worldSessionId:second,requestId:randomUUID(),model:{
      id:'reused_door',asset:global.reference,position:[0,0,7],level:'interactive'
    }});
    const observed=await call('scene_observe',{worldSessionId:second,target:'reused_door'});
    expect(observed.actions.some(action=>action.action==='open')).toBe(true);
    const job=await call('scene_interact',{worldSessionId:second,requestId:randomUUID(),interaction:{
      action:'invoke',target:'reused_door',name:'open',partName:'door',source:'asset',actor:'agent_01',args:{}
    }});
    let result;
    for(let attempt=0;attempt<500;attempt++){
      result=await call('scene_job',{worldSessionId:second,jobId:job.id});
      if(result.status!=='running')break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    expect(result.status).toBe('succeeded');
    expect(result.result.value.physicsVerified).toBe(true);
    const saved=await call('world_save',{worldSessionId:second});
    expect(saved.dependencies.some(entry=>entry.assetId===global.assetId)).toBe(true);
    const restored=await call('world_restore',{saveId:saved.saveId,requestId:randomUUID()});
    const imported=await call('scene_observe',{worldSessionId:restored.worldSessionId,target:'reused_door'});
    expect(imported.actions.some(action=>action.action==='open')).toBe(true);
    await call('session_close',{worldSessionId:first});
    await call('session_close',{worldSessionId:second});
    await call('session_close',{worldSessionId:restored.worldSessionId});
  }finally{
    await client.close().catch(()=>{});await app.close();await rm(root,{recursive:true,force:true});
  }
},120000);
