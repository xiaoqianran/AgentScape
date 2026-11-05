import {describe,it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';
import {StudioLiveBridge} from '../../apps/mcp-server/StudioLiveBridge.js';
import {createSession} from '../../application/createSession.js';
import {createBlankWorld} from '../../modules/world/content/blankWorld.js';
import {StudioLiveBridgeClient} from '../../apps/studio/bridge/StudioLiveBridgeClient.js';

const origin='http://127.0.0.1:5173';
const randomToken=()=>randomBytes(32).toString('hex');
const requestJson=async(url,data,headers={})=>{
  const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json',Origin:origin,...headers},body:JSON.stringify(data)});
  return {status:res.status,body:await res.json()};
};

describe('Studio Live Bridge through real MCP HTTP',()=>{
  it('cleans pending RPCs and queues after a timeout',async()=>{
    const broker=new StudioLiveBridge({rpcTimeoutMs:20});
    try{
      const pair=broker.pair('alice');
      broker.connect(pair.pairCode);
      const work=broker.call('alice',pair.worldSessionId,'observe',{}, {requestId:'idempotent-task'});
      await expect(work).rejects.toMatchObject({code:'STUDIO_TIMEOUT'});
      const entry=broker.ownerSession('alice',pair.worldSessionId);
      expect(entry.pending.size).toBe(0);
      expect(entry.queue).toHaveLength(0);
      await expect(broker.call('alice',pair.worldSessionId,'observe',{}, {requestId:'idempotent-task'})).rejects.toMatchObject({code:'STUDIO_TIMEOUT'});
    }finally{broker.dispose();}
  });
  it('requires human pairing, enforces ownership, forwards Scene calls and revokes on world switch',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'agentscape-studio-bridge-'));
    const tokens=[{identity:'alice',token:randomToken()},{identity:'bob',token:randomToken()}];
    const app=await startServer({tokens,port:0,root,dataRoot:path.join(root,'assets')});
    const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`),
      {requestInit:{headers:{Authorization:'Bearer '+tokens[0].token}}});
    const otherTransport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`),
      {requestInit:{headers:{Authorization:'Bearer '+tokens[1].token}}});
    const client=new Client({name:'studio-live-test',version:'1'});
    const bob=new Client({name:'studio-other-owner',version:'1'});
    const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'studio-test-empty'})});
    await session.world.init();
    const page=new StudioLiveBridgeClient({
      world:session.world,scene:session.scene,serverUrl:`http://127.0.0.1:${app.port}`,
      fetchImpl:(url,init)=>fetch(url,{...init,headers:{...init.headers,Origin:origin}})
    });
    const call=async(mcp,name,args={})=>{
      const result=await mcp.callTool({name,arguments:args});
      return {isError:!!result.isError,...JSON.parse(result.content[0].text)};
    };
    try{
      await client.connect(transport);
      await bob.connect(otherTransport);
      const listed=(await client.listTools()).tools.map(tool=>tool.name);
      expect(listed).toEqual(expect.arrayContaining(['studio_pair_create','studio_session_status','session_attach','studio_session_close']));
      const pair=await call(client,'studio_pair_create');
      const worldSessionId=pair.worldSessionId;
      expect(pair.pairCode).toHaveLength(64);
      expect((await call(client,'session_attach',{worldSessionId})).code).toBe('STUDIO_DISCONNECTED');
      expect((await call(bob,'studio_session_status',{worldSessionId})).code).toBe('SESSION_NOT_FOUND');
      expect((await call(bob,'scene_observe',{worldSessionId})).code).toBe('SESSION_NOT_FOUND');
      expect((await requestJson(`http://127.0.0.1:${app.port}/studio-bridge/connect`,
        {pairCode:pair.pairCode},{Origin:'https://evil.test'})).status).toBe(403);
      await page.connect(pair.pairCode);
      expect((await call(client,'session_attach',{worldSessionId})).connected).toBe(true);
      expect((await requestJson(`http://127.0.0.1:${app.port}/studio-bridge/connect`,
        {pairCode:pair.pairCode})).status).toBe(400);

      const initial=await call(client,'scene_observe',{worldSessionId});
      expect(initial.objects).toHaveLength(0);
      const added=await call(client,'scene_add_model',{worldSessionId,requestId:randomUUID(),
        model:{id:'live_cup',asset:'builtin://cup',position:[0,0,0]}});
      expect(added.id).toBe('live_cup');
      expect(session.world.store.has('live_cup')).toBe(true);
      expect((await call(client,'scene_observe',{worldSessionId,target:'live_cup'})).source).toBe('asset');
      const verified=await call(client,'scene_verify',{worldSessionId,criteria:[{id:'cup',kind:'object-exists',targetId:'live_cup'}]});
      expect(verified.verification.status).toBe('verified');
      expect((await call(bob,'scene_observe',{worldSessionId})).code).toBe('SESSION_NOT_FOUND');

      // Current-world replacement revokes the capability before stale MCP edits can land.
      session.world.events.emit('environment.replaced',{});
      await new Promise(resolve=>setTimeout(resolve,20));
      expect(page.snapshot().status).toBe('disconnected');
      expect((await call(client,'scene_observe',{worldSessionId})).code).toBe('SESSION_NOT_FOUND');
    }finally{
      page.dispose();session.scene.close();session.world.dispose();
      await client.close().catch(()=>{});await bob.close().catch(()=>{});
      await app.close();await rm(root,{recursive:true,force:true});
    }
  },120000);
});
