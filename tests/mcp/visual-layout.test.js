import { expect,it } from 'vitest';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';

it('verifies declared visual assembly contacts via real MCP without changing strict world validation',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mcp-visual-layout-')),token=randomBytes(32).toString('hex');
 const app=await startServer({root,dataRoot:path.join(root,'assets'),port:0,tokens:[{identity:'a',token}]});
 const client=new Client({name:'visual-layout',version:'1'});
 const call=async(name,args={})=>{const res=await client.callTool({name,arguments:args});const value=JSON.parse(res.content[0].text);expect(res.isError,JSON.stringify(value)).not.toBe(true);return value;};
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+app.port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  const session={worldSessionId:(await call('session_create')).worldSessionId};
  const initial=await call('scene_observe',session);
  await call('scene_apply',{...session,requestId:randomUUID(),operations:initial.objects.map(o=>({type:'remove',id:o.id}))});
  const source='export function createAsset(T){const g=new T.Group();const m=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial());m.position.y=.5;g.add(m);return g;}';
  for(const [id,x] of [['wheel',0],['axle',.45]])await call('scene_add_model',{...session,requestId:randomUUID(),model:{id,position:[x,0,0],asset:{kind:'three-code',source}}});
  const layout={id:'layout',kind:'visual-layout',expectedOverlaps:[{object:'wheel',other:'axle',reason:'Visual assembly joint'}]};
  const strict={id:'strict',kind:'world-valid'};
  const check=(await call('scene_verify',{...session,criteria:[layout,strict]})).value;
  expect(check.status).toBe('world-incomplete');
  expect(check.checks[0]).toMatchObject({verified:true,evidence:{scope:'visual-layout-only',acknowledged:[{finding:{code:'P_OVERLAP'}}]}});
  expect(check.checks[1]).toMatchObject({verified:false,reason:'WORLD_VALIDATION_FAILED'});
  const file=(await call('scene_save',{...session,format:'world-file'})).value;
  const b={worldSessionId:(await call('session_create')).worldSessionId};
  await call('scene_import',{...b,requestId:randomUUID(),fileId:file.fileId});
  const reopened=(await call('scene_verify',{...b,criteria:[layout]})).value;
  expect(reopened).toMatchObject({status:'world-accepted',checks:[{verified:true}]});
  await call('session_close',session);await call('session_close',b);
 }finally{await client.close();await app.close();await rm(root,{recursive:true,force:true});}
},30000);
