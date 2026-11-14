import { it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';
import { hash } from '../../apps/mcp-server/FileAssetRepository.js';

it('persists editable project assets and explicitly publishes owner-pinned global versions',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-asset-lifecycle-'));
  const tokens=[{identity:'alice',token:randomBytes(32).toString('hex')},
    {identity:'bob',token:randomBytes(32).toString('hex')}];
  let app,alice,bob;
  const connect=async()=>{
    app=await startServer({tokens,port:0,root:path.join(root,'sessions'),dataRoot:path.join(root,'assets')});
    const open=async (identity,token)=>{
      const client=new Client({name:identity,version:'1'});
      await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+app.port+'/mcp'),{
        requestInit:{headers:{Authorization:'Bearer '+token}}
      }));
      return client;
    };
    alice=await open('alice',tokens[0].token);bob=await open('bob',tokens[1].token);
  };
  const raw=async(client,name,args={})=>{
    const result=await client.callTool({name,arguments:args});
    return {isError:!!result.isError,body:JSON.parse(result.content[0].text)};
  };
  const call=async(client,name,args={})=>{
    const r=await raw(client,name,args);
    expect(r.isError,JSON.stringify(r.body)).toBe(false);
    return r.body;
  };
  const local=(session)=>({worldSessionId:session.worldSessionId});
  try {
    await connect();
    const session=await call(alice,'session_create'),first=local(session);
    const draft={schema:'agentscape.asset-recipe',schemaVersion:1,id:'school/chair',
      parts:[{id:'seat',geometry:{type:'box',size:[1,.2,1]},position:[0,.5,0]}]};
    await call(alice,'scene_add_model',{...first,requestId:randomUUID(),model:{
      id:'chair_01',level:'visual',position:[12,0,0],asset:draft
    }});
    const inspect=async base=>call(alice,'scene_object_definition',{...base,objectId:'chair_01',operation:'inspect'});
    expect((await inspect(first)).revision).toBe(1);
    const export1=await call(alice,'scene_save',first);
    expect(export1.value.editable).toHaveLength(1);
    expect(export1.value.editable[0]).toMatchObject({id:'chair_01',revision:1,definition:{schema:'agentscape.asset-recipe'}});
    const broken=structuredClone(export1.value);
    broken.editable[0].definition.parts[0].geometry.size[0]=3;
    const attempted=await raw(alice,'scene_import',{...first,requestId:randomUUID(),bundle:broken});
    expect(attempted.isError).toBe(true);
    expect(attempted.body.code).toBe('PROJECT_INTEGRITY_MISMATCH');

    const published1=await call(alice,'asset_publish_project',{...first,objectId:'chair_01',requestId:randomUUID()});
    expect(published1).toMatchObject({published:true,scope:'owner-global'});
    expect(published1.assetId).toMatch(/^pa_[a-f0-9]{64}$/);
    expect((await call(alice,'asset_list')).assets.some(a=>a.assetId===published1.assetId)).toBe(true);
    expect((await raw(bob,'asset_inspect',{assetId:published1.assetId})).isError).toBe(true);

    const second=local(await call(alice,'session_create'));
    await call(alice,'scene_add_model',{...second,requestId:randomUUID(),model:{
      id:'global_chair',asset:published1.reference,level:'visual',position:[10,0,0]
    }});
    expect((await call(alice,'scene_observe',{...second,target:'global_chair'})).id).toBe('global_chair');
    expect((await call(alice,'world_save',second)).saveId).toBeDefined();
    const portableGlobal=await call(alice,'scene_save',second);
    const copySession=local(await call(alice,'session_create'));
    const restoredGlobal=await call(alice,'scene_import',{...copySession,requestId:randomUUID(),bundle:portableGlobal.value});
    expect(restoredGlobal.value.objects).toBeGreaterThan(0);
    await call(alice,'session_close',copySession);
    // Fork one global asset reference into a project-local editable instance.
    await call(alice,'scene_add_model',{...second,requestId:randomUUID(),model:{
      id:'global_chair_fork',asset:published1.reference,level:'visual',position:[20,0,0]
    }});
    const forked=await call(alice,'scene_object_definition',{...second,objectId:'global_chair_fork',
      operation:'fork',requestId:randomUUID()});
    expect(forked).toMatchObject({status:'object-project-forked',originAssetId:published1.assetId,revision:1});
    const forkPreview=await call(alice,'scene_object_definition',{...second,objectId:'global_chair_fork',
      operation:'preview',expectedRevision:1,requestId:randomUUID(),
      changes:[{path:'/parts/@seat/geometry/size',value:[1.2,.2,1]}]});
    await call(alice,'scene_object_definition',{...second,objectId:'global_chair_fork',
      operation:'apply',expectedRevision:1,previewId:forkPreview.previewId,requestId:randomUUID()});
    expect(app.manager.get('alice',second.worldSessionId).host.world.store.get('global_chair').assetId).toBe(published1.assetId);
    const localFork=await call(alice,'scene_object_definition',{...second,objectId:'global_chair_fork',operation:'inspect'});
    expect(localFork).toMatchObject({revision:2,originAssetId:published1.assetId});
    expect(localFork.assetId).not.toBe(published1.assetId);
    const forkBundle=await call(alice,'scene_save',second);
    const forkCopy=local(await call(alice,'session_create'));
    await call(alice,'scene_import',{...forkCopy,requestId:randomUUID(),bundle:forkBundle.value});
    const restoredFork=await call(alice,'scene_object_definition',{...forkCopy,
      objectId:'global_chair_fork',operation:'inspect'});
    expect(restoredFork).toMatchObject({revision:2,originAssetId:published1.assetId});
    expect(restoredFork.definition.parts[0].geometry.size).toEqual([1.2,.2,1]);
    await call(alice,'session_close',forkCopy);


    const preview=await call(alice,'scene_object_definition',{...first,operation:'preview',objectId:'chair_01',
      expectedRevision:1,requestId:randomUUID(),changes:[{path:'/parts/@seat/geometry/size',value:[1.4,.2,1]}]});
    await call(alice,'scene_object_definition',{...first,operation:'apply',objectId:'chair_01',expectedRevision:1,
      previewId:preview.previewId,requestId:randomUUID()});
    expect((await inspect(first)).revision).toBe(2);
    const published2=await call(alice,'asset_publish_project',{...first,objectId:'chair_01',requestId:randomUUID()});
    expect(published2.assetId).not.toBe(published1.assetId);
    expect((await call(alice,'asset_inspect',{assetId:published1.assetId})).published).toBe(true);
    expect(app.manager.get('alice',second.worldSessionId).host.world.store.get('global_chair').assetId).toBe(published1.assetId);
    const saved=await call(alice,'scene_save',first);
    expect(saved.value.editable[0].revision).toBe(2);
    const badSource=structuredClone(saved.value);
    badSource.editable[0].assetId=published1.assetId;
    expect((await raw(alice,'scene_import',{...second,requestId:randomUUID(),bundle:badSource})).isError).toBe(true);
    await call(alice,'session_close',first);
    await alice.close();await bob.close();await app.close();alice=null;bob=null;app=null;

    await connect();
    const third=local(await call(alice,'session_create'));
    const restored=await call(alice,'scene_import',{...third,requestId:randomUUID(),bundle:saved.value});
    expect(restored.value.editableRestored).toBe(1);
    const restoredSource=await inspect(third);
    expect(restoredSource).toMatchObject({revision:2,definition:{parts:[{geometry:{size:[1.4,.2,1]}}]}});
    const patch=await call(alice,'scene_object_definition',{...third,operation:'preview',objectId:'chair_01',
      expectedRevision:2,requestId:randomUUID(),changes:[{path:'/parts/@seat/geometry/size',value:[1.6,.2,1]}]});
    expect((await call(alice,'scene_object_definition',{...third,operation:'apply',objectId:'chair_01',
      expectedRevision:2,previewId:patch.previewId,requestId:randomUUID()})).revision).toBe(3);
    expect((await call(alice,'asset_list')).assets.filter(a=>a.assetId===published1.assetId||a.assetId===published2.assetId)).toHaveLength(2);
    // Tampering with persisted source bytes must not alter an immutable global version.
    const sourceFile=path.join(root,'assets','owners',hash('alice'),'assets',published2.assetId,'source.json');
    await writeFile(sourceFile,'{}');
    const corrupted=await raw(alice,'asset_inspect',{assetId:published2.assetId});
    expect(corrupted.isError).toBe(true);
    expect(corrupted.body.code).toBe('STORAGE_INTEGRITY_FAILED');
    await call(alice,'session_close',third);
  }finally{
    await alice?.close().catch(()=>{});await bob?.close().catch(()=>{});await app?.close();
    await rm(root,{recursive:true,force:true});
  }
},120000);
