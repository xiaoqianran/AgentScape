import { it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';
import { box } from '../../apps/mcp-server/examples/procedural-assets.js';

it('inspects actual Three.js nodes and applies one instance definition patch', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-three-refine-'));
  const token=randomBytes(32).toString('hex');
  const app=await startServer({tokens:[{identity:'three-refine',token}],port:0,root});
  const client=new Client({name:'three-refine',version:'1'});
  const call=async(name,args={})=>{
    const response=await client.callTool({name,arguments:args});
    const body=JSON.parse(response.content[0].text);
    expect(response.isError,JSON.stringify(body)).toBeFalsy();
    return body;
  };
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+app.port+'/mcp'),{
      requestInit:{headers:{Authorization:'Bearer '+token}}
    }));
    const session=await call('session_create'),base={worldSessionId:session.worldSessionId};
    const create=async id=>call('scene_add_model',{...base,requestId:randomUUID(),model:{
      id,position:id==='code_a'?[0,3,0]:[4,3,0],asset:{kind:'three-code',...box}
    }});
    await create('code_a');
    await create('code_b');
    const old=await call('scene_object_definition',{...base,operation:'inspect',objectId:'code_a'});
    expect(old.analysis.observed.nodes.some(n=>n.name==='Body' && n.mesh)).toBe(true);
    expect(old.definition.definition.physics.mass).toBe(.3);
    const preview=await call('scene_object_definition',{...base,operation:'preview',objectId:'code_a',
      expectedRevision:1,requestId:randomUUID(),changes:[{path:'/definition/physics/mass',value:.6}]});
    expect(preview.verification).toBe('not-run');
    const applied=await call('scene_object_definition',{...base,operation:'apply',objectId:'code_a',
      expectedRevision:1,previewId:preview.previewId,requestId:randomUUID()});
    expect(applied).toMatchObject({status:'object-patch-applied',revision:2});
    const a=await call('scene_object_definition',{...base,operation:'inspect',objectId:'code_a'});
    const b=await call('scene_object_definition',{...base,operation:'inspect',objectId:'code_b'});
    expect(a.definition.definition.physics.mass).toBe(.6);
    expect(b.definition.definition.physics.mass).toBe(.3);
    expect(a.assetId).not.toBe(b.assetId);
    await call('session_close',base);
  }finally{
    await client.close().catch(()=>{});
    await app.close();
    await rm(root,{recursive:true,force:true});
  }
},120000);
