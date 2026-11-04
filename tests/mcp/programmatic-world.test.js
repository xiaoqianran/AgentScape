import { it,expect } from 'vitest';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,cp,rm,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';
import { box,table,fridge } from '../../apps/mcp-server/examples/procedural-assets.js';

it.runIf(process.env.AGENTSCAPE_SANDBOX_INTEGRATION==='1')('builds box/table/fridge, executes physical tasks, restarts the service and restores immutable world dependencies',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'procedural-world-'));
 const dataRoot=path.join(directory,'assets');await mkdir(dataRoot);await cp('D:/AgentScapeData/mcp-assets/sandbox.json',path.join(dataRoot,'sandbox.json'));
 const tokens=[{identity:'alice',token:randomBytes(32).toString('hex')},{identity:'bob',token:randomBytes(32).toString('hex')}];
 let app,client;
 const connect=async()=>{
  app=await startServer({tokens,port:0,root:path.join(directory,'sessions'),dataRoot});
  client=new Client({name:'procedural-world',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${tokens[0].token}`}}}));
 };
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});expect(r.isError,JSON.stringify(r)).not.toBe(true);return JSON.parse(r.content[0].text);};
 try {
  await connect();
  const published=[];
  for(const example of [box,table,fridge]){
   const job=await call('asset_build_submit',{contract:'agentscape.procedural-asset.v1',...example,requestId:randomUUID()});
   await app.assets.running.get(job.buildId)?.promise;
   const status=await call('asset_build_status',{buildId:job.buildId});
   expect(status.status,JSON.stringify(status)).toBe('succeeded');
   published.push(await call('asset_publish',{buildId:job.buildId}));
  }
  const created=await call('session_create');let base={worldSessionId:created.worldSessionId};
  const action=async(skill,args)=>call('action_execute',{...base,skill,args,requestId:randomUUID()});
  for(const [index,id,position] of [[0,'my_box',[0,0,5]],[1,'my_table',[2,0,3]],[2,'my_fridge',[-5.2,0,-1]]]){
   const r=await action('spawnAsset',{assetId:published[index].assetId,position,instanceId:id});expect(r.result,JSON.stringify(r)).toBe(id);
  }
  expect((await action('approachAndPickup',{actorId:'agent_01',targetId:'my_box'})).state).toBe('verified');
  expect((await action('approachAndPlace',{actorId:'agent_01',supportId:'my_table',surfaceId:'top'})).state).toBe('verified');
  expect((await action('approachAndInteract',{actorId:'agent_01',targetId:'my_fridge',action:'open'})).state).toBe('verified');
  expect((await action('approachAndInteract',{actorId:'agent_01',targetId:'my_fridge',action:'close'})).state).toBe('verified');
  const criteria=[{id:'support',kind:'relation-exists',subject:'my_box',predicate:'ON',object:'my_table',surfaceId:'top'},{id:'opened',kind:'interaction-verified',targetId:'my_fridge',capability:'OPEN'}];
  expect((await call('world_verify',{...base,criteria})).state).toBe('verified');
  const saved=await call('world_save',base);
  const nextSource=box.source.replace('0xff8844','0x4488ff');
  const next=await call('asset_build_submit',{contract:'agentscape.procedural-asset.v1',source:nextSource,definition:box.definition,requestId:randomUUID()});
  await app.assets.running.get(next.buildId)?.promise;
  const upgraded=await call('asset_publish',{buildId:next.buildId});
  expect(upgraded.assetId).not.toBe(published[0].assetId);
  expect(app.manager.get('alice',base.worldSessionId).host.world.store.get('my_box').assetId).toBe(published[0].assetId);
  const runtime=app.manager.get('alice',base.worldSessionId).host.world;
  const ensure=runtime.navigation.ensureCurrent;
  runtime.navigation.ensureCurrent=async()=>({success:false});
  try{
   const failed=await client.callTool({name:'action_execute',arguments:{...base,skill:'replaceAsset',args:{id:'my_box',assetId:upgraded.assetId},requestId:randomUUID()}});
   expect(failed.isError).toBe(true);
   expect(runtime.store.get('my_box').assetId).toBe(published[0].assetId);
   expect(runtime.physics.getPosition('my_box')).toBeTruthy();
  }finally{runtime.navigation.ensureCurrent=ensure;}
  expect((await action('replaceAsset',{id:'my_box',assetId:upgraded.assetId})).result.assetId).toBe(upgraded.assetId);
  await call('session_close',base);await client.close();await app.close();app=null;client=null;
  await connect();
  const restored=await call('world_restore',{saveId:saved.saveId,requestId:randomUUID()});base={worldSessionId:restored.worldSessionId};
  expect((await call('world_observe',base)).objects).toHaveLength(7);
  expect(app.manager.get('alice',base.worldSessionId).host.world.store.get('my_box').assetId).toBe(published[0].assetId);
  expect((await call('world_verify',{...base,criteria})).state).toBe('unverified');
  expect((await action('approachAndInteract',{actorId:'agent_01',targetId:'my_fridge',action:'open'})).state).toBe('verified');
  expect((await call('world_verify',{...base,criteria})).state).toBe('verified');
  const inspected=await call('asset_inspect',{assetId:published[2].assetId,includeSource:true});expect(inspected.source).toBe(fridge.source);
  await expect(app.manager.restore('bob',saved.saveId,randomUUID())).rejects.toThrow();
  await expect(app.assets.inspect('bob',published[0].assetId,true)).rejects.toThrow();
  await call('session_close',base);
 }finally{await client?.close();await app?.close();await rm(directory,{recursive:true,force:true});}
},90000);
