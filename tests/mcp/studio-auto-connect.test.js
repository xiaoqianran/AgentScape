import {describe,it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';
import {createSession} from '../../application/createSession.js';
import {createBlankWorld} from '../../modules/world/content/blankWorld.js';
import {StudioLiveBridgeClient} from '../../apps/studio/bridge/StudioLiveBridgeClient.js';

const origin='http://127.0.0.1:5173';
const waitFor=async(predicate,timeout=10000)=>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    if(await predicate())return;
    await new Promise(resolve=>setTimeout(resolve,70));
  }
  throw new Error('TIMED_OUT_WAITING_FOR_CONDITION');
};
const autoPage=(session,port)=>new StudioLiveBridgeClient({
  world:session.world,scene:session.scene,instance:randomUUID(),
  serverUrl:'http://127.0.0.1:'+port,
  fetchImpl:(url,init)=>fetch(url,{...init,headers:{...init.headers,Origin:origin}})
});
const parse=async(client,name,args={})=>{
  const response=await client.callTool({name,arguments:args});
  return {isError:Boolean(response.isError),...JSON.parse(response.content[0].text)};
};

describe('local automatic Studio MCP',()=>{
  it('automatically targets a single Studio, revokes old worlds and requires explicit ID for multiple tabs',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'agentscape-auto-mcp-'));
    const token=randomBytes(32).toString('hex');
    const app=await startServer({tokens:[{identity:'owner',token}],root,port:0,dataRoot:path.join(root,'assets')});
    const client=new Client({name:'auto-studio-test',version:'1'});
    const transport=new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+app.port+'/mcp'),
      {requestInit:{headers:{Authorization:'Bearer '+token}}});
    const first=createSession(null,{environmentFactory:()=>createBlankWorld({id:'empty_one'})});
    const second=createSession(null,{environmentFactory:()=>createBlankWorld({id:'empty_two'})});
    await first.world.init();
    await second.world.init();
    const page1=autoPage(first,app.port);
    const page2=autoPage(second,app.port);
    try{
      await client.connect(transport);
      expect((await parse(client,'scene_observe')).code).toBe('STUDIO_NOT_CONNECTED');
      page1.setAutoEnabled(true);
      await waitFor(()=>page1.snapshot().status==='connected');
      const initial=await parse(client,'scene_observe');
      expect(initial.objects).toHaveLength(0);
      const current=await parse(client,'session_attach');
      expect(current.mode).toBe('automatic');
      expect(current.worldId).toBe('empty_one');

      const added=await parse(client,'scene_add_model',{
        requestId:randomUUID(),model:{id:'auto_cup',asset:'builtin://cup',position:[0,0,0]}
      });
      expect(added.isError).toBe(false);
      expect(first.world.store.has('auto_cup')).toBe(true);
      expect(second.world.store.has('auto_cup')).toBe(false);

      page2.setAutoEnabled(true);
      await waitFor(()=>page2.snapshot().status==='connected');
      expect((await parse(client,'scene_observe')).code).toBe('STUDIO_MULTIPLE_WORLDS');
      const explicit=await parse(client,'scene_observe',{worldSessionId:current.worldSessionId});
      expect(explicit.objects).toHaveLength(1);

      page2.setAutoEnabled(false);
      await waitFor(()=>!app.studioBridge.sessions.has(page2.snapshot().worldSessionId)&&app.studioBridge.autoByInstance.size===1);
      const oldId=page1.snapshot().worldSessionId;
      first.world.events.emit('environment.replaced',{});
      expect(page1.snapshot().status).toBe('disconnected');
      first.world.environment.id='empty_replaced';
      first.world.events.emit('world.session.changed',{id:'empty_replaced'});
      await waitFor(()=>page1.snapshot().status==='connected'&&page1.snapshot().worldSessionId!==oldId);
      expect((await parse(client,'scene_observe',{worldSessionId:oldId})).code).toBe('SESSION_NOT_FOUND');
      expect((await parse(client,'session_attach')).worldId).toBe('empty_replaced');

      page1.setAutoEnabled(false);
      await waitFor(()=>app.studioBridge.autoByInstance.size===0);
      expect((await parse(client,'scene_observe')).code).toBe('STUDIO_NOT_CONNECTED');
      page1.setAutoEnabled(true);
      await waitFor(()=>page1.snapshot().status==='connected');
      expect((await parse(client,'session_attach')).mode).toBe('automatic');
    }finally{
      page1.dispose();page2.dispose();
      first.scene.close();first.world.dispose();
      second.scene.close();second.world.dispose();
      await client.close().catch(()=>{});
      await app.close();
      await rm(root,{recursive:true,force:true});
    }
  },120000);
});
