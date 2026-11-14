import { describe, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';

describe('Remote MCP real HTTP and physics',()=>{
 it('isolates owners, validates inputs, executes real cabinet/cup task and exports',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-mcp-'));
  const token=randomBytes(32).toString('hex'),other=randomBytes(32).toString('hex');
  const app=await startServer({tokens:[{identity:'alice',token},{identity:'bob',token:other}],port:0,root});
  const url=new URL(`http://127.0.0.1:${app.port}/mcp`);
  const client=new Client({name:'acceptance',version:'1'}),bob=new Client({name:'isolation',version:'1'});
  const call=async(c,name,args={})=>{const r=await c.callTool({name,arguments:args});return {error:r.isError,...JSON.parse(r.content[0].text)};};
  try {
   expect((await fetch(url,{method:'POST',body:'{}'})).status).toBe(401);
   expect((await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,Origin:'https://evil.example'},body:'{}'})).status).toBe(403);
   expect((await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:'x'.repeat(65537)})).status).toBe(413);
   await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
   await bob.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:`Bearer ${other}`}}}));
   const discovered = (await client.listTools()).tools;
   expect(discovered).toHaveLength(41);
   expect(discovered.filter(tool => !tool.name.startsWith('scene_'))).toHaveLength(29);
   expect(discovered.map(tool=>tool.name)).toEqual(expect.arrayContaining(['session_create','action_execute','world_observe','world_save','world_restore','scene_apply','scene_import','scene_interact','scene_job','scene_thermal','studio_project']));
   expect(new Set(discovered.map(tool=>tool.name)).size).toBe(41);
   const a=await call(client,'session_create'),b=await call(bob,'session_create');
   const args={worldSessionId:a.worldSessionId};
   expect(a.worldSessionId).toBeTruthy();
   expect((await call(bob,'world_observe',args)).code).toBe('SESSION_NOT_FOUND');
   expect((await call(client,'world_observe',{worldSessionId:randomUUID()})).code).toBe('SESSION_NOT_FOUND');
   const observed=await call(client,'world_observe',args); expect(observed.objects).toHaveLength(4);
   expect((await call(client,'skills_list',args)).error).toBeFalsy();
   expect((await call(client,'object_inspect',{...args,id:'cup_01'})).object).toBeTruthy();
   expect((await call(client,'action_execute',{...args,requestId:randomUUID(),skill:'moveObject',args:{id:'cup_01',position:[1,2,3],profile:'admin'}})).code).toBe('INVALID_ARGUMENTS');
   const evidence=[];
   for(const [skill,input] of [['approachAndInteract',{actorId:'agent_01',targetId:'cabinet_01',action:'open'}],['approachAndPickup',{actorId:'agent_01',targetId:'cup_01'}],['approachAndPlace',{actorId:'agent_01',supportId:'table_01',surfaceId:'top'}]]) {
    const request={...args,skill,args:input,requestId:randomUUID()};
    const result=await call(client,'action_execute',request); expect(result.state).toBe('verified');
    expect(await call(client,'action_execute',request)).toEqual(result); evidence.push(result);
   }
   const verification=await call(client,'world_verify',args); expect(verification.state).toBe('verified');
   expect(verification.carry.status).toBe('empty');
   const exported=await call(client,'world_export',args); expect(exported.snapshot.objects).toHaveLength(4);
   expect((await readdir(path.join(root,a.worldSessionId))).some(n=>n.endsWith('.tmp'))).toBe(false);
   if(process.env.AGENTSCAPE_MCP_RECORD_EVIDENCE==='1') await writeFile(new URL('../../apps/mcp-server/acceptance-evidence.json',import.meta.url),JSON.stringify({schema:'agentscape.remote-mcp.acceptance',actions:evidence.map(e=>({state:e.state,status:e.result.status,steps:e.steps})),verification,export:{bytes:exported.bytes,scope:exported.scope}},null,2));
   await call(client,'session_close',args);
   expect((await call(bob,'world_observe',{worldSessionId:b.worldSessionId})).objects).toHaveLength(4);
   await call(bob,'session_close',{worldSessionId:b.worldSessionId});
  } finally {await client.close();await bob.close();await app.close();await rm(root,{recursive:true,force:true});}
 },60000);
});
