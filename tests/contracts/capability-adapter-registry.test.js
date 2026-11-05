import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  CAPABILITIES,
  capabilityAvailability,
  invokeCapability,
  probeCapabilities,
  sendCapabilityHealth,
  sendCapabilityStatus
} from '../../apps/server/CapabilityAdapterRegistry.js';

function responseRecorder(){return{statusCode:0,headers:{},body:Buffer.alloc(0),setHeader(key,value){this.headers[String(key).toLowerCase()]=String(value);},end(value=''){this.body=Buffer.isBuffer(value)?value:Buffer.from(value);}};}

describe('deployment capability adapter registry',()=>{
  it('aborts the adapter request when the browser connection closes',async()=>{
    const res=Object.assign(new EventEmitter(),responseRecorder());
    let signal;
    const fetchImpl=vi.fn(async(_url,options)=>{
      signal=options.signal;
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));
    });
    const run=invokeCapability({method:'POST',headers:{'content-type':'application/json'},body:{}},res,CAPABILITIES.AGENT,{env:{AGENT_ADAPTER_URL:'https://agent.test/run'},fetchImpl});
    await vi.waitFor(()=>expect(signal).toBeDefined());
    res.destroyed=true;res.emit('close');await run;
    expect(signal.aborted).toBe(true);expect(res.body).toHaveLength(0);expect(res.listenerCount('close')).toBe(0);
  });
  it('reports only capability availability and validates adapter URLs',()=>{
    expect(capabilityAvailability({
      AGENT_ADAPTER_URL:'https://agent.test/run',
      ASSET_COMPILE_ADAPTER_URL:'invalid'
    })).toEqual({
      agent:{available:true},
      'asset.compile':{available:false}
    });
  });

  it('returns 503 without leaking adapter details when a capability is unavailable',async()=>{
    const res=responseRecorder();
    await invokeCapability({method:'POST',headers:{},body:{}},res,CAPABILITIES.AGENT,{env:{}});
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body.toString())).toEqual({code:'CAPABILITY_UNAVAILABLE'});
  });

  it('uses deployment adapter authorization instead of browser authorization',async()=>{
    const fetchImpl=vi.fn(async(url,options)=>{
      expect(url).toBe('https://agent.test/run');
      expect(options.headers).toEqual({'content-type':'application/json','accept':'application/json',authorization:'Bearer server-secret'});
      expect(JSON.parse(options.body.toString())).toEqual({task:'hello'});
      return new Response(JSON.stringify({ok:true}),{status:201,headers:{'content-type':'application/json'}});
    });
    const res=responseRecorder();
    await invokeCapability({method:'POST',headers:{'content-type':'application/json',accept:'application/json',authorization:'browser-secret'},body:{task:'hello'}},res,CAPABILITIES.AGENT,{
      env:{AGENT_ADAPTER_URL:'https://agent.test/run',AGENT_ADAPTER_AUTHORIZATION:'Bearer server-secret'},fetchImpl
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body.toString())).toEqual({ok:true});
  });

  it('preserves multipart compiler bytes',async()=>{
    const raw=Buffer.from('multipart-body');
    const fetchImpl=vi.fn(async(_url,options)=>{
      expect(options.headers['content-type']).toBe('multipart/form-data; boundary=test');
      expect(Buffer.compare(options.body,raw)).toBe(0);
      return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}});
    });
    const res=responseRecorder();
    await invokeCapability({method:'POST',headers:{'content-type':'multipart/form-data; boundary=test'},body:raw},res,CAPABILITIES.ASSET_COMPILE,{
      env:{ASSET_COMPILE_ADAPTER_URL:'https://compiler.test/compile'},fetchImpl
    });
    expect(res.statusCode).toBe(200);
  });

  it('capability status never exposes adapter URLs',()=>{
    const res=responseRecorder();
    sendCapabilityStatus({method:'GET'},res,{AGENT_ADAPTER_URL:'https://secret-host.test/agent'});
    const body=res.body.toString();
    expect(body).not.toContain('secret-host');
    expect(JSON.parse(body).capabilities.agent.available).toBe(true);
  });

  it('reports every capability unavailable when no adapter environment is configured',()=>{
    expect(capabilityAvailability({})).toEqual({
      agent:{available:false},
      'asset.compile':{available:false}
    });
  });

  it('requires a complete valid endpoint before marking a capability available',()=>{
    expect(capabilityAvailability({AGENT_ADAPTER_URL:'not a url'}).agent.available).toBe(false);
    expect(capabilityAvailability({AGENT_ADAPTER_URL:'   '}).agent.available).toBe(false);
    expect(capabilityAvailability({AGENT_ADAPTER_URL:'ftp://agent.test/run'}).agent.available).toBe(false);
    expect(capabilityAvailability({ASSET_COMPILE_ADAPTER_URL:'not a url'})['asset.compile'].available).toBe(false);
    expect(capabilityAvailability({AGENT_ADAPTER_URL:'https://agent.test/run'})).toEqual({
      agent:{available:true},
      'asset.compile':{available:false}
    });
  });

  it('rejects unknown capabilities with 404 instead of proxying anywhere',async()=>{
    const fetchImpl=vi.fn();
    const res=responseRecorder();
    await invokeCapability({method:'POST',headers:{},body:{}},res,'unknown.capability',{env:{},fetchImpl});
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body.toString())).toEqual({code:'CAPABILITY_NOT_FOUND'});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards only allowlisted method, headers and body to the adapter',async()=>{
    const fetchImpl=vi.fn(async(_url,options)=>{
      expect(options.method).toBe('POST');
      expect(options.redirect).toBe('error');
      expect(options.headers).toEqual({
        'content-type':'application/json',
        accept:'application/json',
        authorization:'Bearer server-secret'
      });
      return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
    });
    const res=responseRecorder();
    await invokeCapability({
      method:'POST',
      headers:{
        'content-type':'application/json',accept:'application/json',
        authorization:'Bearer browser-secret',cookie:'session=abc',host:'agentscape.test','x-api-key':'browser-key'
      },
      body:{task:'hello'}
    },res,CAPABILITIES.AGENT,{env:{AGENT_ADAPTER_URL:'https://agent.test/run',AGENT_ADAPTER_AUTHORIZATION:'Bearer server-secret'},fetchImpl});
    expect(res.statusCode).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();

    const rejected=responseRecorder();
    await invokeCapability({method:'GET',headers:{}},rejected,CAPABILITIES.AGENT,{env:{AGENT_ADAPTER_URL:'https://agent.test/run'},fetchImpl});
    expect(rejected.statusCode).toBe(405);
    expect(rejected.headers.allow).toBe('POST');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('preserves upstream status and content-type without hop-by-hop headers',async()=>{
    const fetchImpl=vi.fn(async()=>new Response('compiled',{
      status:200,
      headers:{'content-type':'application/octet-stream','connection':'keep-alive','transfer-encoding':'chunked','keep-alive':'timeout=5'}
    }));
    const res=responseRecorder();
    await invokeCapability({method:'POST',headers:{'content-type':'application/json'},body:{x:1}},res,CAPABILITIES.ASSET_COMPILE,{
      env:{ASSET_COMPILE_ADAPTER_URL:'https://compiler.test/compile'},fetchImpl
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.toString()).toBe('compiled');
    expect(res.headers).toEqual({'content-type':'application/octet-stream','cache-control':'no-store'});
  });

  it('returns a stable status payload with booleans only',()=>{
    const res=responseRecorder();
    sendCapabilityStatus({method:'GET'},res,{AGENT_ADAPTER_URL:'https://secret-host.test/agent',AGENT_ADAPTER_AUTHORIZATION:'Bearer secret'});
    expect(JSON.parse(res.body.toString())).toEqual({
      capabilities:{
        agent:{available:true},
        'asset.compile':{available:false}
      }
    });
  });
});

describe('capability health probing',()=>{
  const env={AGENT_ADAPTER_URL:'https://agent.test/run',AGENT_ADAPTER_AUTHORIZATION:'Bearer server-secret',ASSET_COMPILE_ADAPTER_URL:'https://compiler.test/compile'};

  it('reports unconfigured adapters without any network call',async()=>{
    const fetchImpl=vi.fn();
    const result=await probeCapabilities({},{fetchImpl});
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.agent).toMatchObject({available:false,state:'unconfigured',reason:'NOT_CONFIGURED',latencyMs:null});
  });

  it('derives /health from the invoke URL and forwards only deployment authorization',async()=>{
    const fetchImpl=vi.fn(async()=>new Response('{}',{status:200}));
    await probeCapabilities(env,{fetchImpl});
    const calls=Object.fromEntries(fetchImpl.mock.calls.map(([url,options])=>[url,options]));
    expect(Object.keys(calls).sort()).toEqual(['https://agent.test/health','https://compiler.test/health']);
    expect(calls['https://agent.test/health'].headers.authorization).toBe('Bearer server-secret');
    expect(calls['https://compiler.test/health'].headers.authorization).toBeUndefined();
  });

  it('classifies ok, slow, http failures and timeouts',async()=>{
    let t=0;
    const now=()=>t;
    const fetchImpl=vi.fn(async(url)=>{
      if(url.startsWith('https://agent.test')){t+=2000;return new Response('{}',{status:200});}
      t+=10;return new Response('no',{status:503});
    });
    const result=await probeCapabilities(env,{fetchImpl,now});
    expect(result.agent.state).toBe('slow');
    expect(result['asset.compile']).toMatchObject({state:'down',reason:'HTTP_503'});

    const hanging=vi.fn((_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('x'),{name:'AbortError'})))));
    const timedOut=await probeCapabilities({AGENT_ADAPTER_URL:env.AGENT_ADAPTER_URL},{fetchImpl:hanging,timeoutMs:5});
    expect(timedOut.agent).toMatchObject({state:'down',reason:'TIMEOUT'});
    const refused=await probeCapabilities({AGENT_ADAPTER_URL:env.AGENT_ADAPTER_URL},{fetchImpl:async()=>{throw new Error('ECONNREFUSED secret-host');}});
    expect(refused.agent).toMatchObject({state:'down',reason:'UNREACHABLE'});
  });

  it('never leaks adapter URLs or upstream bodies through the health endpoint',async()=>{
    const res=responseRecorder();
    await sendCapabilityHealth({method:'GET'},res,env,{fetchImpl:async()=>new Response('SECRET-UPSTREAM-BODY',{status:500})});
    const body=res.body.toString();
    expect(body).not.toMatch(/agent\.test|compiler\.test|SECRET|server-secret/);
    expect(res.headers['cache-control']).toBe('no-store');
    const post=responseRecorder();
    await sendCapabilityHealth({method:'POST'},post);
    expect(post.statusCode).toBe(405);
  });

  it('turns an adapter that never answers an invoke into a bounded 504',async()=>{
    const fetchImpl=vi.fn((_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('x'),{name:'AbortError'})))));
    const res=responseRecorder();
    await invokeCapability({method:'POST',headers:{},body:Buffer.from('{}')},res,CAPABILITIES.AGENT,{env,fetchImpl,timeoutMs:5});
    expect(res.statusCode).toBe(504);
    expect(JSON.parse(res.body.toString()).code).toBe('ADAPTER_TIMEOUT');
  });
});
