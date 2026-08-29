import { describe, expect, it, vi } from 'vitest';
import {
  CAPABILITIES,
  capabilityAvailability,
  invokeCapability,
  sendCapabilityStatus
} from '../../api/_server/CapabilityAdapterRegistry.js';

function responseRecorder(){return{statusCode:0,headers:{},body:Buffer.alloc(0),setHeader(key,value){this.headers[String(key).toLowerCase()]=String(value);},end(value=''){this.body=Buffer.isBuffer(value)?value:Buffer.from(value);}};}

describe('deployment capability adapter registry',()=>{
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
});
