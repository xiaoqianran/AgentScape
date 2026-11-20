import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {startServer} from '../../apps/mcp-server/main.mjs';
import {runDshAgent} from '../../apps/agent-host/DshAgentBackend.js';

describe('actual DSH subprocess with mock NewAPI + restricted MCP',()=>{
  it.skipIf(process.env.AGENTSCAPE_DSH_INTEGRATION!=='1')('runs SDK model and invokes Studio scene_observe via restricted MCP',async()=>{
    const work=await mkdtemp(path.join(tmpdir(),'agentscape-dsh-integration-'));
    const saveKeys=['AGENTSCAPE_LLM_BASE_URL','AGENTSCAPE_LLM_MODEL','AGENTSCAPE_LLM_API_KEY',
      'AGENTSCAPE_MCP_TOKEN','AGENTSCAPE_MCP_URL','DSH_SYSTEM_PROMPT'];
    const original=Object.fromEntries(saveKeys.map(key=>[key,process.env[key]]));
    let app,modelServer,modelCalls=0,modelTools=[];
    try{
      const token='test-token-'+'x'.repeat(40);
      app=await startServer({port:0,tokens:[{identity:'test-owner',token}],
        root:path.join(work,'sessions'),dataRoot:path.join(work,'assets')});
      const {worldSessionId,studioToken}=app.studioBridge.registerAuto(randomUUID(),'mock-world');
      const observed=app.studioBridge.poll(worldSessionId,studioToken).then(async({request})=>{
        if(!request)throw new Error('STUDIO_OBSERVE_NOT_REQUESTED');
        await app.studioBridge.reply(worldSessionId,studioToken,{
          requestId:request.requestId,result:{objects:[{id:'apple-tree'}]}
        });
        return request;
      });
      modelServer=http.createServer(async(req,res)=>{
        modelCalls++;
        let body='';
        for await(const chunk of req)body+=chunk;
        const input=JSON.parse(body);
        expect(input.model).toBe('mock-dsh-model');
        modelTools=(input.tools||[]).map(tool=>tool.function?.name||tool.name);
        const alreadyObserved=(input.messages||[]).some(message=>message.role==='tool');
        res.writeHead(200,{'content-type':'text/event-stream'});
        if(!alreadyObserved){
          res.write('data: '+JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:123456,
            model:'mock-dsh-model',choices:[{index:0,delta:{role:'assistant',tool_calls:[{
              index:0,id:'call_scene_observe',type:'function',
              function:{name:'mcp__agentscape__scene_observe',arguments:'{}'}
            }]},finish_reason:null}]})+'\n\n');
          res.write('data: '+JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:123456,
            model:'mock-dsh-model',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\n');
        }else{
          res.write('data: '+JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:123456,
            model:'mock-dsh-model',choices:[{index:0,delta:{role:'assistant',content:'DSH observed apple-tree'},finish_reason:null}]})+'\n\n');
          res.write('data: '+JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:123456,
            model:'mock-dsh-model',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');
        }
        res.end('data: [DONE]\n\n');
      });
      await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));
      process.env.AGENTSCAPE_LLM_BASE_URL='http://127.0.0.1:'+modelServer.address().port+'/v1';
      process.env.AGENTSCAPE_LLM_MODEL='mock-dsh-model';
      process.env.AGENTSCAPE_LLM_API_KEY='mock-only-key';
      process.env.AGENTSCAPE_MCP_TOKEN=token;
      process.env.AGENTSCAPE_MCP_URL='http://127.0.0.1:'+app.port+'/agent-mcp';
      process.env.DSH_SYSTEM_PROMPT='Use scene_observe once, then answer briefly.';
      const config={dshProvider:'agentscape-newapi',dshModel:'mock-dsh-model',
        dshPatch:fileURLToPath(new URL('../../apps/agent-host/dsh-restricted.patch.yml',import.meta.url)),
        dshPatches:[
          fileURLToPath(new URL('../../apps/agent-host/dsh-restricted.patch.yml',import.meta.url)),
          fileURLToPath(new URL('../../apps/agent-host/dsh-newapi.patch.yml',import.meta.url))],
        dshHome:path.join(work,'dsh-home')};
      const result=await runDshAgent({prompt:'Observe the world',configuration:config});
      const observedRequest=await observed;
      expect(observedRequest.method).toBe('observe');
      expect(modelCalls).toBeGreaterThanOrEqual(2);
      expect(modelTools).toContain('mcp__agentscape__scene_observe');
      expect(modelTools).not.toContain('mcp__agentscape__authoring_execute');
      expect(result.message).toContain('DSH observed apple-tree');
      expect(result.taskStatus).toBe('incomplete');
    } finally {
      for(const [key,value] of Object.entries(original)){
        if(value===undefined)delete process.env[key];else process.env[key]=value;
      }
      if(modelServer)await new Promise(resolve=>modelServer.close(resolve));
      await app?.close();
      await rm(work,{recursive:true,force:true});
    }
  },90000);
});
