import { it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';

it('edits one object draft by field, rejects invalid changes and preserves other instances',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-object-forge-'));
  const token=randomBytes(32).toString('hex');
  const app=await startServer({tokens:[{identity:'object-forge',token}],port:0,root});
  const client=new Client({name:'object-forge',version:'1'});
  const raw=async(name,args={})=>{
    const response=await client.callTool({name,arguments:args});
    return {body:JSON.parse(response.content[0].text),isError:!!response.isError};
  };
  const call=async(name,args={})=>{const r=await raw(name,args);expect(r.isError,JSON.stringify(r.body)).toBe(false);return r.body;};
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+app.port+'/mcp'),{
      requestInit:{headers:{Authorization:'Bearer '+token}}
    }));
    const session=await call('session_create'),base={worldSessionId:session.worldSessionId};
    const draft={schema:'agentscape.mechanical-draft',schemaVersion:1,name:'School Hinge',type:'school_hinge',
      components:[{id:'Frame',parent:null,shape:'box',position:[-.78,1,0],size:[.10,2,.12],color:'#778899',collision:true},
        {id:'Hinge',parent:null,shape:'group',position:[-.65,1,.1],size:[1,1,1],color:'#996633',collision:false},
        {id:'Panel',parent:'Hinge',shape:'box',position:[.65,0,0],size:[1.25,1.9,.06],color:'#b07849',collision:true}],
      motions:[{id:'door',node:'Hinge',type:'revolute',axis:[0,1,0],limits:[0,1.57],open:1.4,mass:5}]};
    await call('scene_add_model',{...base,requestId:randomUUID(),model:{id:'door_a',asset:draft,position:[0,0,0]}});
    await call('scene_add_model',{...base,requestId:randomUUID(),model:{id:'door_b',asset:draft,position:[10,0,0]}});
    const info=await call('scene_object_definition',{...base,operation:'inspect',objectId:'door_a'});
    expect(info).toMatchObject({revision:1,analysis:{declared:{motions:[{status:'candidate',physicsVerified:false}]}}});
    const beforeB=(await call('scene_observe',{...base,target:'door_b'})).actions.find(a=>a.action==='open').contract.effects[0].target;
    const invalid=await raw('scene_object_definition',{...base,operation:'preview',objectId:'door_a',expectedRevision:1,
      requestId:randomUUID(),changes:[{path:'/motions/@door/open',value:5}]});
    expect(invalid.isError).toBe(true);
    expect((await call('scene_object_definition',{...base,operation:'inspect',objectId:'door_a'})).revision).toBe(1);
    const preview=await call('scene_object_definition',{...base,operation:'preview',objectId:'door_a',expectedRevision:1,
      requestId:randomUUID(),changes:[{path:'/components/@Panel/color',value:'#dd8844'}]});
    expect(preview).toMatchObject({status:'object-patch-preview',verification:'not-run'});
    const applied=await call('scene_object_definition',{...base,operation:'apply',objectId:'door_a',
      expectedRevision:1,previewId:preview.previewId,requestId:randomUUID()});
    expect(applied).toMatchObject({status:'object-patch-applied',revision:2,verification:{runtimeActionVerification:'not-run'}});
    const afterA=(await call('scene_observe',{...base,target:'door_a'})).actions.find(a=>a.action==='open').contract.effects[0].target;
    const afterB=(await call('scene_observe',{...base,target:'door_b'})).actions.find(a=>a.action==='open').contract.effects[0].target;
    expect(afterA).toBe(1.4);
    expect((await call('scene_object_definition',{...base,operation:'inspect',objectId:'door_a'})).definition.components[2].color).toBe('#dd8844');
    expect(afterB).toBe(beforeB);
    expect((await call('scene_object_definition',{...base,operation:'inspect',objectId:'door_a'})).assetId).not.toBe(info.assetId);
    expect((await raw('scene_object_definition',{...base,operation:'preview',objectId:'door_a',expectedRevision:1,
      requestId:randomUUID(),changes:[{path:'/motions/@door/open',value:1.1}]})).body.code).toBe('OBJECT_REVISION_CONFLICT');
    expect((await raw('scene_object_definition',{...base,operation:'preview',objectId:'door_a',expectedRevision:2,
      requestId:randomUUID(),changes:[{path:'/motions/0/__proto__/polluted',value:true}]})).body.code).toBe('OBJECT_PATCH_PATH_FORBIDDEN');
    // A failed physics upgrade must not change the original instance or its draft revision.
    const valid=await call('scene_object_definition',{...base,operation:'preview',objectId:'door_a',
      expectedRevision:2,requestId:randomUUID(),
      changes:[{path:'/components/@Frame/size',value:[1.5,2,.12]}]});
    const rejected=await raw('scene_object_definition',{...base,operation:'apply',objectId:'door_a',
      expectedRevision:2,previewId:valid.previewId,requestId:randomUUID()});
    expect(rejected.isError).toBe(true);
    expect(rejected.body.code).toBe('ASSET_PHYSICS_VERIFICATION_FAILED');
    const unchanged=await call('scene_object_definition',{...base,operation:'inspect',objectId:'door_a'});
    expect(unchanged).toMatchObject({revision:2,assetId:applied.assetId});
    expect(unchanged.definition.components[0].size).toEqual([.10,2,.12]);
    await call('session_close',base);
  }finally{await client.close().catch(()=>{});await app.close();await rm(root,{recursive:true,force:true});}
},90000);

it('adds a procedural material to one Recipe instance and exports embedded color and normal maps',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-material-forge-'));
  const token=randomBytes(32).toString('hex');
  const app=await startServer({tokens:[{identity:'material-forge',token}],port:0,root});
  const client=new Client({name:'material-forge',version:'1'});
  const origin='http://127.0.0.1:'+app.port,headers={Authorization:'Bearer '+token};
  const call=async(name,args={},error=false)=>{
    const response=await client.callTool({name,arguments:args});
    const value=JSON.parse(response.content[0].text);
    expect(!!response.isError,JSON.stringify(value)).toBe(error);
    return value;
  };
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers}}));
    const base={worldSessionId:(await call('session_create')).worldSessionId};
    const initial=await call('scene_observe',base);
    await call('scene_apply',{...base,requestId:randomUUID(),operations:initial.objects.map(o=>({type:'remove',id:o.id}))});
    const asset={schema:'agentscape.asset-recipe',schemaVersion:1,id:'material/board',parts:[{id:'body',geometry:{type:'box',size:[1,.15,1]}}]};
    for(const [id,x] of [['board_a',0],['board_b',2]])await call('scene_add_model',{...base,requestId:randomUUID(),model:{id,asset,position:[x,1,0]}});
    const before=await call('scene_object_definition',{...base,operation:'inspect',objectId:'board_b'});
    const material={color:'#ffffff',roughness:.7,texture:{pattern:'wood',seed:42,resolution:64}};
    const preview=await call('scene_object_definition',{...base,operation:'preview',objectId:'board_a',expectedRevision:1,requestId:randomUUID(),changes:[{path:'/parts/@body/material',value:material}]});
    expect(preview.changes[0].previous).toBeNull();
    const applied=await call('scene_object_definition',{...base,operation:'apply',objectId:'board_a',expectedRevision:1,previewId:preview.previewId,requestId:randomUUID()});
    expect(applied).toMatchObject({status:'object-patch-applied',revision:2});
    expect((await call('scene_object_definition',{...base,operation:'inspect',objectId:'board_a'})).definition.parts[0].material).toMatchObject(material);
    expect((await call('scene_object_definition',{...base,operation:'inspect',objectId:'board_b'})).assetId).toBe(before.assetId);
    const file=await call('scene_export_glb',{...base,options:{objectIds:['board_a','board_b']}});
    const response=await fetch(origin+'/files/'+file.fileId+'/content',{headers});
    expect(response.status).toBe(200);
    const bytes=Buffer.from(await response.arrayBuffer());
    const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
    expect(gltf.images).toHaveLength(2);
    expect(gltf.materials.filter(m=>m.pbrMetallicRoughness.baseColorTexture)).toHaveLength(1);
    expect(gltf.materials.filter(m=>m.normalTexture)).toHaveLength(1);
    const save=(await call('scene_save',base)).value;
    const next={worldSessionId:(await call('session_create')).worldSessionId};
    await call('scene_import',{...next,requestId:randomUUID(),bundle:save});
    const recovered=await call('scene_object_definition',{...next,operation:'inspect',objectId:'board_a'});
    expect(recovered.definition.parts[0].material).toMatchObject(material);
    const restored=await call('scene_export_glb',{...next,options:{objectIds:['board_a','board_b']}});
    expect(restored.sha256).toBe(file.sha256);
    await call('session_close',next);
    await call('session_close',base);
  }finally{await client.close().catch(()=>{});await app.close();await rm(root,{recursive:true,force:true});}
},90000);
