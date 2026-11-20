import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {startServer} from '../../apps/mcp-server/main.mjs';
import {createAgentHost} from '../../apps/agent-host/AgentHost.mjs';
import {normalizeExecution} from '../../apps/agent-host/AgentExecution.js';

it('Pi and DSH share a real restricted MCP / Studio Bridge postcondition check',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'agent-final-bridge-'));
  const token='test-'+randomUUID().replaceAll('-','').repeat(2);
  let mcp,host;
  try{
    mcp=await startServer({port:0,tokens:[{identity:'finalizer-test',token}],
      root:path.join(root,'sessions'),dataRoot:path.join(root,'assets')});
    const {worldSessionId,studioToken}=mcp.studioBridge.registerAuto(randomUUID(),'mock-world');
    const criteria=[{id:'tree',kind:'object-exists',targetId:'tree'}];
    const entries=normalizeExecution('pi',[
      {name:'scene_add_model',callId:'add',args:{model:{id:'tree'}},
        result:{content:[{type:'text',text:'{"status":"succeeded"}'}]}},
      {name:'scene_verify',callId:'verify',args:{criteria},
        result:{content:[{type:'text',text:JSON.stringify({
          schema:'agentscape.scene-result',operation:'verify',status:'succeeded',revision:5,
          verification:{status:'verified',evidence:{status:'world-accepted',
            checks:criteria.map(check=>({...check,verified:true}))}}
        })}]}}
    ]);
    const received=[];
    const respondToBridge=(async()=>{
      for(let i=0;i<6;i++){
        const {request}=await mcp.studioBridge.poll(worldSessionId,studioToken);
        if(!request)throw new Error('BRIDGE_REQUEST_NOT_RECEIVED');
        received.push(request.method);
        const answer=request.method==='observe'
          ? {schema:'agentscape.scene-object-page',revision:5,objects:[]}
          : {schema:'agentscape.scene-result',operation:'verify',status:'succeeded',revision:5,
            verification:{status:'verified',evidence:{status:'world-accepted',
              checks:request.args.criteria.map(check=>({...check,verified:true}))}}};
        await mcp.studioBridge.reply(worldSessionId,studioToken,{requestId:request.requestId,result:answer});
      }
    })();
    const config={baseUrl:'http://127.0.0.1/unused',apiKey:'test',modelId:'test',
      mcpToken:token,mcpUrl:'http://127.0.0.1:'+mcp.port+'/agent-mcp',
      dshPatch:'restricted.yml',dshProvider:'test',dshModel:'test'};
    const backend=async({emit})=>{emit({type:'run.started'});return {worldSessionId,taskStatus:'incomplete',
      execution:entries,message:'Tree is ready'};};
    host=createAgentHost({config,port:0,backends:{pi:backend,dsh:backend}});
    const address=await host.listen();
    for(const agent of ['pi','dsh']){
      const response=await fetch('http://127.0.0.1:'+address.port+'/run',{
        method:'POST',headers:{origin:'http://localhost:5173','content-type':'application/json'},
        body:JSON.stringify({runId:agent+'_agent_test_123',backend:agent,prompt:'在当前世界添加苹果树'})
      });
      expect(response.status).toBe(200);
      const output=await response.json();
      expect(output).toMatchObject({backend:agent,taskStatus:'completed',verified:true,
        world:{worldSessionId,sceneRevision:5}});
      expect(output.events.at(-1)).toMatchObject({type:'run.finished',taskStatus:'completed',verified:true});
    }
    await respondToBridge;
    expect(received).toEqual(['observe','verify','observe','observe','verify','observe']);
  } finally {
    await host?.close();
    await mcp?.close();
    await rm(root,{recursive:true,force:true});
  }
},30000);
