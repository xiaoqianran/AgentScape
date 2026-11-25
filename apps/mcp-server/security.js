import { createHash, timingSafeEqual } from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest();
export function createSecurity(tokens,{origins=[],hosts=['127.0.0.1','localhost'],maxBody=65536,maxImportBody=4*1024*1024+4096,rate=120}={}) {
 if(!tokens.length || tokens.some(t=>typeof t.token!=='string'||t.token.length<32||!t.identity)) throw new Error('Configure independent MCP tokens (32+ characters)');
 const buckets=new Map();
 return async(req)=>{
  let host; try {host=new URL(`http://${req.headers.host}`).hostname;} catch {throw Object.assign(new Error(),{status:403});}
  if(!hosts.includes(host) || req.headers.origin && !origins.includes(req.headers.origin)) throw Object.assign(new Error(),{status:403});
  const value=String(req.headers.authorization||'').replace(/^Bearer /,'');
  const principal=tokens.find(t=>timingSafeEqual(digest(t.token),digest(value)));
  if(!principal) throw Object.assign(new Error(),{status:401});
  const now=Date.now(),bucket=buckets.get(principal.identity)||{start:now,count:0};
  if(now-bucket.start>60000){bucket.start=now;bucket.count=0;} buckets.set(principal.identity,bucket);
  if(++bucket.count>rate) throw Object.assign(new Error(),{status:429,retryAfter:Math.max(1,Math.ceil((60000-(now-bucket.start))/1000))});
  // Allow the bounded scene bundle plus its JSON-RPC envelope on the full MCP endpoint.
  // Authentication and rate limiting above still run before any body is buffered.
  const limit=req.url==='/mcp' && req.method==='POST' ? Math.max(maxBody,maxImportBody) : maxBody;
  if(Number(req.headers['content-length'])>limit) throw Object.assign(new Error(),{status:413});
  let size=0; const chunks=[];
  for await(const chunk of req) {size+=chunk.length;if(size>limit) throw Object.assign(new Error(),{status:413});chunks.push(chunk);}
  let body; try {body=size?JSON.parse(Buffer.concat(chunks).toString()):undefined;} catch {throw Object.assign(new Error(),{status:size>maxBody?413:400});}
  if(size>maxBody && (Array.isArray(body) || body?.method!=='tools/call' || body?.params?.name!=='scene_import')) throw Object.assign(new Error(),{status:413});
  return {owner:principal.identity,body};
 };
}
