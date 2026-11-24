import {describe,it,expect} from 'vitest';
import http from 'node:http';
import {acceptedSceneChecks,runPiAgent} from '../../apps/agent-host/PiAgentBackend.js';

import {changesWorld} from '../../apps/agent-host/McpWorldTools.js';

it('accepts explicit Runtime evidence and rejects empty, partial and legacy-looking successes',()=>{
  const checks=['house','tree'].map(targetId=>({targetId,verified:true}));
  const evidence={status:'world-accepted',checks};
  const result={schema:'agentscape.scene-result',operation:'verify',status:'succeeded',verification:{status:'verified',evidence}};
  expect(acceptedSceneChecks(result)).toEqual(checks);
  expect(acceptedSceneChecks({verified:true})).toEqual([]);
  evidence.checks=[];
  expect(acceptedSceneChecks(result)).toEqual([]);
  evidence.checks=[checks[0],{...checks[1],verified:false}];
  expect(acceptedSceneChecks(result)).toEqual([]);
  expect(changesWorld('studio_project',{operation:'read'})).toBe(false);
  expect(changesWorld('studio_project',{operation:'run'})).toBe(true);
  expect(changesWorld('studio_project',{operation:'save'})).toBe(false);
  expect(changesWorld('scene_history',{operation:'status'})).toBe(false);
  expect(changesWorld('scene_history',{operation:'undo'})).toBe(true);
  expect(changesWorld('scene_history',{operation:'redo'})).toBe(true);
});

describe('Pi SDK integration without remote model charges',()=>{
  it('executes a real Pi Agent turn against a mock OpenAI stream',async()=>{
    const requests=[];
    const upstream=http.createServer(async(req,res)=>{
      if(req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
      let content='';
      for await(const part of req)content+=part;
      requests.push(JSON.parse(content));
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
      const packet={id:'chatcmpl-test',object:'chat.completion.chunk',created:123456,
        model:'mock-model',choices:[{index:0,delta:{role:'assistant',content:'Pi loop is active'},finish_reason:null}]};
      res.write('data: '+JSON.stringify(packet)+'\n\n');
      res.write('data: '+JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:123456,
        model:'mock-model',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');
      res.end('data: [DONE]\n\n');
    });
    await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
    const events=[], port=upstream.address().port;
    try{
      const result=await runPiAgent({
        prompt:'Say hello',configuration:{baseUrl:'http://127.0.0.1:'+port+'/v1',apiKey:'fake-key',modelId:'mock-model',
          mcpToken:'unused-in-mock'},
        mcpConnector:async()=>({worldSessionId:'mock-world',mutations:[],tools:[],close:async()=>{}}),
        emit:event=>events.push(event)
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].model).toBe('mock-model');
      expect(result.message).toContain('Pi loop is active');
      expect(result.taskStatus).toBe('no-mutation');
      expect(events.some(event=>event.type==='run.started')).toBe(true);
    }finally{await new Promise(resolve=>upstream.close(resolve));}
  },20000);
});


describe('Pi tool turns and Runtime acceptance',()=>{
  it.each([
    ['accepted',['add','verify','save'],'completed'],
    ['missing entity',['add','partial'],'incomplete'],
    ['stale evidence',['add','verify','edit'],'incomplete'],
    ['draft without activation',['edit','verify'],'incomplete'],
    ['failed write followed by read',['error','read'],'incomplete'],
    ['repeated failure',['error','error','error'],'incomplete']
  ])('%s', async (_label,turns,expected)=>{
    let index=0;
    const mutations=[];
    const events=[];
    const parameters={type:'object',properties:{operation:{type:'string'},model:{type:'object'}}};
    const names={add:'scene_add_model',verify:'scene_verify',partial:'scene_verify',save:'studio_project',
      edit:'studio_project',read:'studio_project',error:'scene_add_model'};
    const upstream=http.createServer(async(req,res)=>{
      for await(const _chunk of req){}
      const turn=turns[index++];
      const args=turn==='add'||turn==='error'?{model:{id:'house'}}:{operation:turn==='edit'?'write':turn};
      const delta=turn?{role:'assistant',tool_calls:[{index:0,id:'call_'+index,type:'function',
        function:{name:names[turn],arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'Done'};
      res.writeHead(200,{'content-type':'text/event-stream'});
      for(const choice of [{delta,finish_reason:null},{delta:{},finish_reason:turn?'tool_calls':'stop'}])
        res.write('data: '+JSON.stringify({id:'chat',object:'chat.completion.chunk',created:1,model:'model',
          choices:[{index:0,...choice}]})+'\n\n');
      res.end('data: [DONE]\n\n');
    });
    await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
    try {
      const tools=[...new Set(Object.values(names))].map(name=>({name,label:name,description:name,parameters,
        execute:async(_id,args)=>{
          if(turns[index-1]==='error')throw new Error('INVALID_RECIPE');
          if(changesWorld(name,args))mutations.push({tool:name});
          const checks=[{targetId:'tree',verified:true}];
          if(turns[index-1]==='verify')checks.push({targetId:'house',verified:true});
          const value=name==='scene_verify'?{schema:'agentscape.scene-result',operation:'verify',status:'succeeded',
            verification:{status:'verified',evidence:{status:'world-accepted',checks}}}:{status:'succeeded'};
          return {content:[{type:'text',text:JSON.stringify(value)}],details:{}};
        }}));
      const result=await runPiAgent({prompt:'Build the world',configuration:{baseUrl:'http://127.0.0.1:'+upstream.address().port+'/v1',
        apiKey:'test',modelId:'model'},emit:event=>events.push(event),
        mcpConnector:async()=>({worldSessionId:'fixture',tools,mutations,close:async()=>{}})});
      expect(result.taskStatus).toBe('incomplete'); // AgentHost decides final admission.
      expect(result.execution).toHaveLength(turns.length);
      expect(events.filter(event=>event.type==='tool.end')).toHaveLength(turns.length);
      if(turns.every(turn=>turn==='error'))expect(index).toBe(3);
    } finally {await new Promise(resolve=>upstream.close(resolve));}
  },20000);
});
