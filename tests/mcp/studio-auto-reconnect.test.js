import {it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer} from '../../apps/mcp-server/main.mjs';
import {createSession} from '../../application/createSession.js';
import {createBlankWorld} from '../../modules/world/content/blankWorld.js';
import {StudioLiveBridgeClient} from '../../apps/studio/bridge/StudioLiveBridgeClient.js';

const waitFor=async(predicate,timeout=16000)=>{
  const end=Date.now()+timeout;
  while(Date.now()<end){
    if(await predicate())return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('CONNECTION_DID_NOT_RECOVER');
};
it('automatically reconnects after the local MCP server restarts without a new pairing code',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-studio-restart-'));
  const token=randomBytes(32).toString('hex');
  const args={tokens:[{identity:'local',token}],root,dataRoot:path.join(root,'assets')};
  let app=await startServer({...args,port:0});
  const port=app.port;
  const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'restart-world'})});
  await session.world.init();
  const page=new StudioLiveBridgeClient({
    world:session.world,scene:session.scene,instance:randomUUID(),
    serverUrl:'http://127.0.0.1:'+port,
    fetchImpl:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:'http://127.0.0.1:5173'}})
  });
  try{
    page.setAutoEnabled(true);
    await waitFor(()=>page.snapshot().status==='connected');
    const oldId=page.snapshot().worldSessionId;
    await app.close();
    app=null;
    await waitFor(()=>page.snapshot().status==='disconnected');
    app=await startServer({...args,port});
    await waitFor(()=>page.snapshot().status==='connected'&&page.snapshot().worldSessionId!==oldId);
    expect(app.studioBridge.currentSession().worldId).toBe('restart-world');
  }finally{
    page.dispose();
    session.scene.close();session.world.dispose();
    if(app)await app.close();
    await rm(root,{recursive:true,force:true});
  }
},45000);
