import { expect,it } from 'vitest';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';
import { TransferStore } from '../../apps/mcp-server/TransferStore.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

it('streams a real world archive through HTTP, imports it, rejects foreign files and rolls back a corrupt archive',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mcp-world-file-')),token=randomBytes(32).toString('hex'),foreign=randomBytes(32).toString('hex');
 const app=await startServer({root,dataRoot:path.join(root,'assets'),port:0,tokens:[{identity:'a',token},{identity:'b',token:foreign}]});
 const base='http://127.0.0.1:'+app.port,client=new Client({name:'world-transfer',version:'1'});
 const headers={Authorization:'Bearer '+token};
 const request=(route,method='GET',body,auth=token)=>fetch(base+route,{method,headers:{Authorization:'Bearer '+auth,...(body instanceof Uint8Array?{'Content-Type':'application/octet-stream'}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)});
 const json=async(route,method,body,status=200)=>{const res=await request(route,method,body);const value=await res.json();expect(res.status,JSON.stringify(value)).toBe(status);return value;};
 const call=async(name,args={},error=false)=>{const res=await client.callTool({name,arguments:args});const value=JSON.parse(res.content[0].text);expect(!!res.isError,JSON.stringify(value)).toBe(error);return value;};
 const upload=async bytes=>{
  const task=await json('/uploads','POST',{bytes:bytes.length,sha256:hash(bytes)},201);
  const split=Math.floor(bytes.length/2),a=await json('/uploads/'+task.id+'/parts','POST',bytes.subarray(0,split),201);
  const b=await json('/uploads/'+task.id+'/parts','POST',bytes.subarray(split),201);
  const file=await json('/uploads/'+task.id+'/complete','POST',{partIds:[a.id,b.id]});expect(file.sha256).toBe(hash(bytes));return file;
 };
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers}}));
  const a={worldSessionId:(await call('session_create')).worldSessionId};
  const initial=await call('scene_observe',a);
  await call('scene_apply',{...a,requestId:randomUUID(),operations:initial.objects.map(o=>({type:'remove',id:o.id}))});
  await call('scene_add_model',{...a,requestId:randomUUID(),model:{id:'world_box',position:[0,0,0],asset:{schema:'agentscape.asset-recipe',schemaVersion:1,id:'test/worldbox',parts:[{id:'box',geometry:{type:'box',size:[1,1,1]},position:[0,.5,0]}]}}});
  const saved=(await call('scene_save',{...a,format:'world-file'})).value;
  const res=await request('/files/'+saved.fileId+'/content');
  expect(res.status).toBe(200);const bytes=Buffer.from(await res.arrayBuffer());
  expect(bytes.subarray(0,8).toString()).toBe('ASWORLD1');expect(hash(bytes)).toBe(saved.sha256);
  expect((await request('/files/'+saved.fileId+'/content','GET',undefined,foreign)).status).toBe(404);
  await json('/files/'+saved.fileId,'DELETE');
  const file=await upload(bytes);
  const b={worldSessionId:(await call('session_create')).worldSessionId};
  const imported=await call('scene_import',{...b,requestId:randomUUID(),fileId:file.id});
  expect(imported.status).toBe('succeeded');
  expect((await call('scene_observe',b)).objects.map(o=>o.id)).toEqual(['world_box']);
  await json('/files/'+file.id,'DELETE');
  // Live lazy asset storage must remain after uploaded file is deleted.
  const again=(await call('scene_save',{...b,format:'world-file'})).value;
  expect(again.bytes).toBeGreaterThan(0);
  const broken=Buffer.from(bytes);broken[broken.length-8]^=255;
  const bad=await upload(broken);
  await call('scene_import',{...b,requestId:randomUUID(),fileId:bad.id},true);
  expect((await call('scene_observe',b)).objects.map(o=>o.id)).toEqual(['world_box']);
  await call('session_close',a);await call('session_close',b);
 }finally{await client.close().catch(()=>{});await app.close();await rm(root,{recursive:true,force:true});}
},90000);

it('enforces part, disk, digest, expiry and reader lease limits without retaining failed parts',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mcp-transfer-store-'));let now=0;
 const store=await new TransferStore(root,{maxFileBytes:16,maxPartBytes:8,maxDiskBytes:16,ttlMs:1000,now:()=>now}).initialize();
 const chunks=async function*(...items){for(const item of items)yield Buffer.from(item);};
 try{
  const task=await store.create('a',{bytes:12,sha256:hash(Buffer.from('abcdefghijkl'))});
  await expect(store.create('b',{bytes:5})).rejects.toMatchObject({code:'TRANSFER_DISK_LIMIT'});
  await expect(store.part('b',task.id,chunks('abcd'))).rejects.toMatchObject({code:'TRANSFER_NOT_FOUND'});
  await expect(store.part('a',task.id,chunks('123456789'))).rejects.toMatchObject({code:'TRANSFER_PART_LIMIT'});
  expect(store.metadata(store.get('a',task.id,'pending')).receivedBytes).toBe(0);
  const a=await store.part('a',task.id,chunks('abcd')),b=await store.part('a',task.id,chunks('efghijkl'));
  await expect(store.complete('a',task.id,[b.id,a.id])).rejects.toMatchObject({code:'TRANSFER_HASH_MISMATCH'});
  await expect(store.complete('a',task.id,[a.id])).rejects.toMatchObject({code:'TRANSFER_INCOMPLETE'});
  const file=await store.complete('a',task.id,[a.id,b.id]);
  const lease=store.lease('a',file.id);
  await expect(store.cancel('a',file.id,'complete')).rejects.toMatchObject({code:'TRANSFER_BUSY'});
  lease.release();await store.cancel('a',file.id,'complete');expect(store.bytes).toBe(0);
  const expiring=await store.create('a',{bytes:16});now=1001;
  await expect(store.part('a',expiring.id,chunks('a'))).rejects.toMatchObject({code:'TRANSFER_EXPIRED'});
  await store.reap();expect(store.bytes).toBe(0);
  const cancelled=await store.create('a',{bytes:16});await store.cancel('a',cancelled.id,'pending');expect(store.bytes).toBe(0);
 }finally{await store.close();await rm(root,{recursive:true,force:true});}
});
