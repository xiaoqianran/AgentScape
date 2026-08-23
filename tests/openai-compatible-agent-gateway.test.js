import { describe, expect, it, vi } from 'vitest';
import {
  createAgentGateway,
  createUpstreamPayload,
  isAllowedOrigin,
  startServer,
  fromOpenAIResponse,
  toOpenAIMessages,
  toOpenAITools
} from '../scripts/openai-compatible-agent-gateway.mjs';

describe('OpenAI-compatible local test gateway', () => {
  it('converts the canonical SkillRegistry tool shape without maintaining a second tool catalog', () => {
    expect(toOpenAITools([{ name:'navigateTo', description:'walk', parameters:{ type:'object', properties:{ id:{type:'string'} } } }])).toEqual([
      { type:'function', function:{ name:'navigateTo', description:'walk', parameters:{ type:'object', properties:{ id:{type:'string'} } } } }
    ]);
  });

  it('preserves assistant tool-call history before native OpenAI tool results', () => {
    expect(toOpenAIMessages([
      { role:'user', content:'walk there' },
      { role:'assistant', content:'', toolCalls:[{ id:'call_1', name:'navigateTo', args:{ id:'agent_01', end:[3,0,2] } }] },
      { role:'tool', toolCallId:'call_1', name:'navigateTo', content:'{"status":"arrived"}' }
    ])).toEqual([
      { role:'user', content:'walk there' },
      { role:'assistant', content:null, tool_calls:[{ id:'call_1', type:'function', function:{ name:'navigateTo', arguments:'{"id":"agent_01","end":[3,0,2]}' } }] },
      { role:'tool', tool_call_id:'call_1', content:'{"status":"arrived"}' }
    ]);
  });

  it('normalizes native OpenAI tool calls into AgentScape gateway responses', () => {
    expect(fromOpenAIResponse({ choices:[{ message:{ content:null, tool_calls:[{ id:'abc', type:'function', function:{ name:'findPath', arguments:'{"start":[0,0,0],"end":[1,0,0]}' } }] } }] })).toEqual({
      message:'', final:false,
      toolCalls:[{ id:'abc', name:'findPath', args:{ start:[0,0,0], end:[1,0,0] } }]
    });
  });

  it('fails closed on malformed model tool arguments instead of silently changing intent', () => {
    expect(() => fromOpenAIResponse({ choices:[{ message:{ tool_calls:[{ id:'abc', function:{ name:'open', arguments:'{broken' } }] } }] })).toThrow(/invalid JSON arguments/i);
  });

  it('sends auth only to the configured upstream and returns provider-neutral output', async () => {
    const fetchImpl=vi.fn(async(url,options)=>{
      expect(url).toBe('https://upstream.test/v1/chat/completions');
      expect(options.headers.authorization).toBe('Bearer secret-local-only');
      const body=JSON.parse(options.body);
      expect(body).toMatchObject({ model:'test-model', temperature:0, tool_choice:'auto' });
      return new Response(JSON.stringify({ choices:[{ message:{ content:'done', tool_calls:[] } }] }), { status:200, headers:{'content-type':'application/json'} });
    });
    const complete=createAgentGateway({ baseUrl:'https://upstream.test/v1', apiKey:'secret-local-only', model:'test-model', fetchImpl });
    await expect(complete({ messages:[{role:'user',content:'hi'}], tools:[] })).resolves.toEqual({ message:'done', final:true, toolCalls:[] });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('creates a deterministic payload and preserves the current provider-neutral world context', () => {
    const payload=createUpstreamPayload({
      messages:[{role:'system',content:'system'},{role:'user',content:'x'}], tools:[],
      context:{world:[{id:'agent_01',type:'agent'}]}
    }, 'm');
    expect(payload).toMatchObject({ model:'m', temperature:0, stream:false, tool_choice:'auto' });
    expect(payload.messages[1]).toMatchObject({role:'system'});
    expect(payload.messages[1].content).toContain('agent_01');
    expect(payload.messages[1].content).toContain('tools remain authoritative');
  });

  it('allows loopback browser origins but rejects arbitrary websites by default', () => {
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedOrigin('http://localhost:9999')).toBe(true);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('https://trusted.example', ['https://trusted.example'])).toBe(true);
    expect(isAllowedOrigin(null)).toBe(true);
  });

  it('rejects foreign browser origins before any upstream API request', async () => {
    const fetchImpl=vi.fn();
    const server=startServer({ baseUrl:'https://upstream.test/v1', apiKey:'secret', model:'m', fetchImpl, host:'127.0.0.1', port:0, quiet:true });
    await new Promise((resolve,reject)=>{ server.once('listening',resolve); server.once('error',reject); });
    const port=server.address().port;
    try {
      const response=await fetch(`http://127.0.0.1:${port}/agent`, {
        method:'POST', headers:{'content-type':'application/json',origin:'https://evil.example'},
        body:JSON.stringify({messages:[],tools:[]})
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve)=>server.close(resolve));
    }
  });

  it('echoes an allowed loopback origin and proxies the request', async () => {
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{status:200,headers:{'content-type':'application/json'}}));
    const server=startServer({ baseUrl:'https://upstream.test/v1', apiKey:'secret', model:'m', fetchImpl, host:'127.0.0.1', port:0, quiet:true });
    await new Promise((resolve,reject)=>{ server.once('listening',resolve); server.once('error',reject); });
    const port=server.address().port;
    try {
      const origin='http://127.0.0.1:5173';
      const response=await fetch(`http://127.0.0.1:${port}/agent`, {
        method:'POST', headers:{'content-type':'application/json',origin},
        body:JSON.stringify({messages:[{role:'user',content:'hi'}],tools:[]})
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(await response.json()).toMatchObject({message:'ok',final:true});
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      await new Promise((resolve)=>server.close(resolve));
    }
  });

});
