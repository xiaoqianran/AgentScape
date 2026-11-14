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
