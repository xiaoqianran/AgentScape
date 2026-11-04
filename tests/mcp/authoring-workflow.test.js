import { it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../../apps/mcp-server/main.mjs';
import { createIsolatedAuthoringExecutor } from '../../apps/mcp-server/IsolatedAuthoringExecutor.js';

it('authors a new mesh over authenticated MCP, installs it through real asset compilation, picks it up and verifies custom criteria',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'agentscape-authoring-'));
 const token=randomBytes(32).toString('hex');
 const app=await startServer({tokens:[{identity:'author',token}],port:0,root,dataRoot:path.join(root,'assets'),managerOptions:{hostOptions:{executorFactory:createIsolatedAuthoringExecutor}}});
 const client=new Client({name:'authoring-acceptance',version:'1'});
 const call=async(name,args)=>{
  const response=await client.callTool({name,arguments:args});
  if (response.isError) return {error:true};
  return JSON.parse(response.content[0].text);
 };
 try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
  const session=await call('session_create',{});
  const base={worldSessionId:session.worldSessionId};
  const mutation=(name,args={})=>call(name,{...base,...args,requestId:randomUUID()});
  const code="const texture=new THREE.DataTexture(new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),2,2);const box=new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3),new THREE.MeshStandardMaterial({map:texture}));box.userData.authoringId='ai-box';box.name='AI Box';box.position.set(0,.2,5);scene.add(box);";
  const request={...base,code,label:'AI Box',requestId:randomUUID()};
  const authored=await call('authoring_execute',request);
  expect(authored.result.status).toBe('authoring-code-applied');
  expect(await call('authoring_execute',request)).toEqual(authored);
  expect((await call('world_observe',base)).objects).toHaveLength(4);
  expect((await mutation('authoring_execute',{code:'scene.clear();throw new Error("broken");'})).result.status).toBe('authoring-code-failed');
  const prepared=await mutation('authoring_prepare',{nodeId:'ai-box',usage:'movable'});
  expect(prepared.result.status).toBe('authoring-prepared');
  expect(prepared.result.admission.status).toBe('provisional');
  expect((await mutation('authoring_promote',{nodeId:'ai-box',usage:'movable'})).error).toBe(true);
  const promoted=await mutation('authoring_promote',{nodeId:'ai-box',usage:'movable',allowProvisional:true});
  expect(promoted.result.status).toBe('authoring-provisional');
  const targetId=promoted.result.entityId;
  const record=app.manager.get('author',session.worldSessionId).host.world.store.get(targetId);
  const meshes=[];record.object.traverse(o=>{if(o.isMesh)meshes.push(o);});
  expect(meshes[0].material.map?.image?.width).toBe(2);
  expect(promoted.result.verification.physics.registered).toBe(true);
  expect((await call('world_observe',base)).objects).toHaveLength(5);
  const pickup=await mutation('action_execute',{skill:'approachAndPickup',args:{actorId:'agent_01',targetId}});
  expect(pickup.state,JSON.stringify(pickup)).toBe('verified');
  expect((await call('world_verify',{...base,criteria:[{id:'picked',kind:'interaction-verified',targetId,capability:'PICKUP'}]})).state).toBe('verified');
  const placed=await mutation('action_execute',{skill:'approachAndPlace',args:{actorId:'agent_01',supportId:'table_01',surfaceId:'top'}});
  expect(placed.state,JSON.stringify(placed)).toBe('verified');
  const verify=await call('world_verify',{...base,criteria:[{id:'exists',kind:'object-exists',targetId},{id:'pickup',kind:'interaction-verified',targetId,capability:'PICKUP'},{id:'support',kind:'relation-exists',subject:targetId,predicate:'ON',object:'table_01',surfaceId:'top'}]});
  expect(verify.state).toBe('verified');
  // Source and editable data survive export; failed builds and idempotent retries add no source revision.
  const exported=await call('authoring_export',base);
  expect(exported.draft.sources.map(s=>s.code)).toEqual([code]);
  const saved=JSON.parse(await readFile(path.join(root,session.worldSessionId,exported.fileName),'utf8'));
  expect(saved.document.root.children[0].id).toBe('ai-box');
  expect(saved.promotions.entries[0].entityId).toBe(targetId);
  expect((await call('world_verify',{...base,criteria:[]})).error).toBe(true);
  expect((await call('session_close',base)).state).toBe('closed');
 } finally {await client.close();await app.close();await rm(root,{recursive:true,force:true});}
},60000);
