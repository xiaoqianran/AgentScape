import {describe,it,expect} from 'vitest';
import {createAgentHost} from '../../apps/agent-host/AgentHost.mjs';

describe('agent event streaming',()=>{
  it('delivers NDJSON events before final result',async()=>{
    const config={baseUrl:'http://127.0.0.1/test',apiKey:'a',modelId:'m',mcpToken:'x'.repeat(32)};
    const app=createAgentHost({port:0,config,backends:{pi:async({emit})=>{
      emit({type:'tool.start',tool:'scene_observe'});
      return {backend:'pi',taskStatus:'no-mutation',message:'seen'};
    },dsh:async()=>({})}});
    await app.listen();
    try {
      const url='http://127.0.0.1:'+app.server.address().port;
      const res=await fetch(url+'/run',{method:'POST',headers:{
        'origin':'http://localhost:5173','accept':'application/x-ndjson','content-type':'application/json'
      },body:JSON.stringify({runId:'streaming_run_001',backend:'pi',prompt:'look'})});
      expect(res.status).toBe(200);
      const raw=await res.text();
      const events=raw.trim().split('\n').map(line=>JSON.parse(line));
      expect(events[0]).toEqual({type:'tool.start',tool:'scene_observe'});
      expect(events[1].type).toBe('run.finished');
      expect(events[2].type).toBe('run.result');
      expect(events[2].result.message).toBe('seen');
    }finally{await app.close();}
  });
});
