import { describe, expect, it, vi } from 'vitest';
import { createCapabilityDevMiddleware, DEV_CAPABILITY_ROUTES } from '../../dev/capabilityDevPlugin.js';
import capabilityIndex from '../../api/capabilities/index.js';

function responseRecorder(){
  return {
    statusCode:0,headers:{},body:Buffer.alloc(0),headersSent:false,writableEnded:false,
    setHeader(key,value){this.headers[String(key).toLowerCase()]=String(value);},
    end(value=''){this.body=Buffer.isBuffer(value)?value:Buffer.from(value);this.headersSent=true;this.writableEnded=true;}
  };
}

describe('capability dev middleware',()=>{
  it('only mounts known capability routes and passes unknown routes through',async()=>{
    const middleware=createCapabilityDevMiddleware();
    const next=vi.fn();
    const res=responseRecorder();
    await middleware({url:'/api/unknown',method:'GET'},res,next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
    expect(res.body.length).toBe(0);

    const known=responseRecorder();
    await middleware({url:'/api/capabilities/',method:'GET'},known,vi.fn());
    expect(known.statusCode).toBe(200);
    expect(JSON.parse(known.body.toString()).capabilities).toBeDefined();
  });

  it('returns a bounded 500 payload when a handler fails asynchronously',async()=>{
    const middleware=createCapabilityDevMiddleware({
      routes:new Map([['/api/boom',async()=>{throw new Error('handler exploded');}]])
    });
    const res=responseRecorder();
    await middleware({url:'/api/boom',method:'GET'},res,vi.fn());
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body.toString())).toEqual({code:'DEV_CAPABILITY_HANDLER_FAILED'});
  });

  it('does not write twice when the response was already sent before the failure',async()=>{
    const middleware=createCapabilityDevMiddleware({
      routes:new Map([['/api/partial',async(_req,res)=>{res.end('first');throw new Error('late failure');}]])
    });
    const res=responseRecorder();
    await middleware({url:'/api/partial',method:'GET'},res,vi.fn());
    expect(res.statusCode).toBe(0);
    expect(res.body.toString()).toBe('first');
  });

  it('serves the same capability status payload as the Vercel API handler',async()=>{
    const direct=responseRecorder();
    await capabilityIndex({url:'/api/capabilities',method:'GET'},direct);

    const middleware=createCapabilityDevMiddleware();
    const viaMiddleware=responseRecorder();
    await middleware({url:'/api/capabilities',method:'GET'},viaMiddleware,vi.fn());

    expect(DEV_CAPABILITY_ROUTES.get('/api/capabilities')).toBe(capabilityIndex);
    expect(viaMiddleware.statusCode).toBe(direct.statusCode);
    expect(viaMiddleware.body.toString()).toBe(direct.body.toString());
    const payload=JSON.parse(viaMiddleware.body.toString());
    expect(Object.keys(payload.capabilities).sort()).toEqual(['agent','asset.compile']);
    for(const entry of Object.values(payload.capabilities)){
      expect(Object.keys(entry)).toEqual(['available']);
      expect(typeof entry.available).toBe('boolean');
    }
  });
});
