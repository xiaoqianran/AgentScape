import { it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';

it('round-trips local school assets via MCP scene_save and scene_import', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agentscape-school-import-'));
  const token = randomBytes(32).toString('hex');
  const app = await startServer({ tokens:[{identity:'school-import-test',token}], port:0, root });
  const client = new Client({ name:'school-import', version:'1' });
  const call = async (name, args={}) => {
    const response = await client.callTool({ name, arguments:args });
    const body = JSON.parse(response.content[0].text);
    expect(response.isError,JSON.stringify(body)).toBeFalsy();
    return body;
  };
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+app.port+'/mcp'), {
      requestInit:{headers:{Authorization:'Bearer '+token}}
    }));
    const first = await call('session_create');
    const a={worldSessionId:first.worldSessionId};
    const model = {id:'school_playground',level:'visual',position:[8,0,0],
      asset:{schema:'agentscape.asset-recipe',schemaVersion:1,id:'school/test_field',
        parts:[{id:'ground',geometry:{type:'box',size:[6,.1,8]},position:[0,.05,0]}]}};
    await call('scene_add_model',{...a,requestId:randomUUID(),model});
    const saved=await call('scene_save',a);
    expect(saved.value.schema).toBe('agentscape.project-bundle');
    expect(saved.value.assets.some(asset => asset.id.startsWith('asset_'))).toBe(true);
    const second=await call('session_create');
    const b={worldSessionId:second.worldSessionId};
    const imported=await call('scene_import',{...b,requestId:randomUUID(),bundle:saved.value});
    expect(imported.status).toBe('succeeded');
    expect((await call('scene_observe',{...b,target:'school_playground'})).physics.registered).toBe(false);
    const broken=structuredClone(saved.value);
    broken.assets[0].sha256='0'.repeat(64);
    const bad=await client.callTool({name:'scene_import',arguments:{...b,requestId:randomUUID(),bundle:broken}});
    expect(bad.isError).toBe(true);
    expect((await call('scene_observe',{...b,target:'school_playground'})).id).toBe('school_playground');
    await call('session_close',a);
    await call('session_close',b);
  } finally {
    await client.close().catch(()=>{});
    await app.close();
    await rm(root,{recursive:true,force:true});
  }
},90000);
