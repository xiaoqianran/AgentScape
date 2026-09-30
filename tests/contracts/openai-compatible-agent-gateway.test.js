import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HOST,
  createAgentGateway,
  createUpstreamPayload,
  isAllowedOrigin,
  isDirectEntry,
  loadEnvFile,
  startServer,
  fromOpenAIResponse,
  toOpenAIMessages,
  toOpenAITools
} from '../../apps/server/openai-compatible-agent-gateway.mjs';

async function listen(options) {
  const server = startServer(options);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return { server, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

describe('OpenAI-compatible local test gateway', () => {
  it('detects the CLI entry point across Windows and file URL path formats', () => {
    const entry = 'D:\\repo\\apps\\server\\openai-compatible-agent-gateway.mjs';
    expect(isDirectEntry('file:///D:/repo/apps/server/openai-compatible-agent-gateway.mjs', entry)).toBe(true);
    expect(isDirectEntry('file:///D:/repo/apps/server/openai-compatible-agent-gateway.mjs', 'D:\\repo\\other.mjs')).toBe(false);
  });
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
      expect(body).toMatchObject({ model:'test-model', temperature:0 });
      expect(body).not.toHaveProperty('tools');
      expect(body).not.toHaveProperty('tool_choice');
      return new Response(JSON.stringify({ choices:[{ message:{ content:'done', tool_calls:[] } }] }), { status:200, headers:{'content-type':'application/json'} });
    });
    const complete=createAgentGateway({ baseUrl:'https://upstream.test/v1', apiKey:'secret-local-only', model:'test-model', fetchImpl });
    await expect(complete({ messages:[{role:'user',content:'hi'}], tools:[] })).resolves.toEqual({ message:'done', final:true, toolCalls:[] });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('falls back across configured models only for retryable upstream failures', async () => {
    const seen=[];
    const fetchImpl=vi.fn(async(_url,options)=>{
      const body=JSON.parse(options.body); seen.push(body.model);
      if(seen.length===1) return new Response(JSON.stringify({error:{message:'temporary'}}),{status:502,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{status:200,headers:{'content-type':'application/json'}});
    });
    const complete=createAgentGateway({baseUrl:'https://upstream.test/v1',apiKey:'secret',models:['primary','fallback'],fetchImpl});
    await expect(complete({messages:[{role:'user',content:'hi'}],tools:[]})).resolves.toMatchObject({message:'ok',final:true});
    expect(seen).toEqual(['primary','fallback']);
  });

  it('does not hide non-retryable upstream contract/auth failures behind model fallback', async () => {
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({error:{message:'bad request'}}),{status:400,headers:{'content-type':'application/json'}}));
    const complete=createAgentGateway({baseUrl:'https://upstream.test/v1',apiKey:'secret',models:['primary','fallback'],fetchImpl});
    await expect(complete({messages:[],tools:[]})).rejects.toThrow(/bad request/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('omits tools and tool_choice when no tools are supplied', () => {
    const payload=createUpstreamPayload({ messages:[{role:'user',content:'x'}], tools:[] }, 'm');
    expect(payload).toMatchObject({ model:'m', temperature:0, stream:false });
    expect(payload).not.toHaveProperty('tools');
    expect(payload).not.toHaveProperty('tool_choice');
  });

  it('creates a deterministic payload and preserves the current provider-neutral world context', () => {
    const payload=createUpstreamPayload({
      messages:[{role:'system',content:'system'},{role:'user',content:'x'}], tools:[{name:'listObjects',description:'List objects',parameters:{type:'object',properties:{}}}],
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
    expect(isAllowedOrigin('http://[::1]:5173')).toBe(true);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('https://trusted.example', ['https://trusted.example'])).toBe(true);
    expect(isAllowedOrigin(null)).toBe(true);
  });

  it('loads env files without overwriting explicit variables and ignores malformed lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentscape-env-'));
    const file = path.join(dir, '.env.local');
    fs.writeFileSync(file, [
      '# comment',
      '',
      'no_equals_sign',
      '=empty-key',
      'AGENTSCAPE_LLM_API_KEY=file-value',
      'QUOTED="quoted value"',
      "SINGLE='single value'",
      'EXISTING=file-should-not-win'
    ].join('\n'));
    const target = { EXISTING: 'explicit-win' };
    try {
      expect(loadEnvFile(file, target)).toBe(true);
      expect(target.AGENTSCAPE_LLM_API_KEY).toBe('file-value');
      expect(target.QUOTED).toBe('quoted value');
      expect(target.SINGLE).toBe('single value');
      expect(target.EXISTING).toBe('explicit-win');
      expect(target.no_equals_sign).toBeUndefined();
      expect(Object.keys(target).sort()).toEqual(['AGENTSCAPE_LLM_API_KEY', 'EXISTING', 'QUOTED', 'SINGLE']);
      expect(loadEnvFile(path.join(dir, 'missing.env'), target)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an empty upstream model chain with a clear error', () => {
    expect(() => createAgentGateway({ baseUrl: 'https://upstream.test/v1', apiKey: 'k', models: [] }))
      .toThrow(/At least one LLM model/);
    expect(() => createAgentGateway({ baseUrl: 'https://upstream.test/v1', apiKey: 'k', model: '   ' }))
      .toThrow(/At least one LLM model/);
  });

  it('trims and deduplicates the configured model chain', async () => {
    const { port, close } = await listen({
      baseUrl: 'https://upstream.test/v1', apiKey: 'k', models: [' primary ', 'primary', 'fallback', ''],
      fetchImpl: vi.fn(), host: DEFAULT_HOST, port: 0, quiet: true
    });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(await response.json()).toEqual({ ok: true, model: 'primary', models: ['primary', 'fallback'] });
    } finally {
      await close();
    }
  });

  it('falls back across models for 408, 425 and 429 upstream failures', async () => {
    for (const status of [408, 425, 429]) {
      const seen = [];
      const fetchImpl = vi.fn(async (_url, options) => {
        seen.push(JSON.parse(options.body).model);
        if (seen.length === 1) return new Response(JSON.stringify({ error: { message: 'busy' } }), { status, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      const complete = createAgentGateway({ baseUrl: 'https://upstream.test/v1', apiKey: 'k', models: ['primary', 'fallback'], fetchImpl });
      await expect(complete({ messages: [], tools: [] })).resolves.toMatchObject({ message: 'ok' });
      expect(seen).toEqual(['primary', 'fallback']);
    }
  }, 20000);

  it('continues down the model chain when the upstream fetch itself fails', async () => {
    const seen = [];
    const fetchImpl = vi.fn(async (_url, options) => {
      seen.push(JSON.parse(options.body).model);
      if (seen.length === 1) throw new Error('ECONNRESET');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const complete = createAgentGateway({ baseUrl: 'https://upstream.test/v1', apiKey: 'k', models: ['primary', 'fallback'], fetchImpl });
    await expect(complete({ messages: [], tools: [] })).resolves.toMatchObject({ message: 'recovered', final: true });
    expect(seen).toEqual(['primary', 'fallback']);
  });

  it('rejects an over-2MiB request body before parsing JSON or calling upstream', async () => {
    const fetchImpl = vi.fn();
    const { port, close } = await listen({ baseUrl: 'https://upstream.test/v1', apiKey: 'k', model: 'm', fetchImpl, host: DEFAULT_HOST, port: 0, quiet: true });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/agent`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(2 * 1024 * 1024 + 1)
      });
      expect(response.status).toBe(502);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('serves a secret-free health payload, CORS preflight and a minimal route surface', async () => {
    const fetchImpl = vi.fn();
    const { port, close } = await listen({
      baseUrl: 'https://upstream.test/v1', apiKey: 'super-secret-key', models: ['m1'],
      fetchImpl, host: DEFAULT_HOST, port: 0, quiet: true
    });
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      const healthText = await health.text();
      expect(health.status).toBe(200);
      expect(healthText).not.toContain('super-secret-key');
      expect(healthText).not.toContain('upstream.test');
      expect(JSON.parse(healthText)).toEqual({ ok: true, model: 'm1', models: ['m1'] });

      const origin = 'http://127.0.0.1:5173';
      const preflight = await fetch(`http://127.0.0.1:${port}/agent`, { method: 'OPTIONS', headers: { origin } });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
      expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
      expect(preflight.headers.get('access-control-allow-headers')).toContain('content-type');
      expect(fetchImpl).not.toHaveBeenCalled();

      const notFound = await fetch(`http://127.0.0.1:${port}/other`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(notFound.status).toBe(404);
      const wrongMethod = await fetch(`http://127.0.0.1:${port}/agent`);
      expect(wrongMethod.status).toBe(404);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('binds to loopback by default instead of all interfaces', async () => {
    const { server, close } = await listen({ baseUrl: 'https://upstream.test/v1', apiKey: 'k', model: 'm', fetchImpl: vi.fn(), port: 0, quiet: true });
    try {
      expect(server.address().address).toBe(DEFAULT_HOST);
      expect(DEFAULT_HOST).toBe('127.0.0.1');
    } finally {
      await close();
    }
  });

  it('rejects foreign browser origins before any upstream API request', async () => {
    const fetchImpl=vi.fn();
    const server=startServer({ baseUrl:'https://upstream.test/v1', apiKey:'secret', model:'m', fetchImpl, host:'127.0.0.1', port:0, quiet:true, allowedOrigins:['https://trusted.example'] });
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
