import { createHash, timingSafeEqual } from 'node:crypto';
import { MCP_MESSAGE_BYTES } from './TransferLimits.js';
const digest=value=>createHash('sha256').update(value).digest();
export function createSecurity(tokens,{origins=[],hosts=['127.0.0.1','localhost'],maxBody=MCP_MESSAGE_BYTES,rate=600}={}) {
 if(!tokens.length || tokens.some(t=>typeof t.token!=='string'||t.token.length<32||!t.identity)) throw new Error('Configure independent MCP tokens (32+ characters)');
 const buckets=new Map();
 return async(req,{raw=false,bodyLimit=maxBody}={})=>{
  let host; try {host=new URL(`http://${req.headers.host}`).hostname;} catch {throw Object.assign(new Error(),{status:403});}
  if(!hosts.includes(host) || req.headers.origin && !origins.includes(req.headers.origin)) throw Object.assign(new Error(),{status:403});
  const value=String(req.headers.authorization||'').replace(/^Bearer /,'');
  const principal=tokens.find(t=>timingSafeEqual(digest(t.token),digest(value)));
  if(!principal) throw Object.assign(new Error(),{status:401});
  const now=Date.now(),bucket=buckets.get(principal.identity)||{start:now,count:0};
  if(now-bucket.start>60000){bucket.start=now;bucket.count=0;} buckets.set(principal.identity,bucket);
  if(++bucket.count>rate) throw Object.assign(new Error(),{status:429,retryAfter:Math.max(1,Math.ceil((60000-(now-bucket.start))/1000))});
  if(Number(req.headers['content-length'])>bodyLimit) throw Object.assign(new Error(),{status:413});
  if(raw)return {owner:principal.identity};
  let size=0; const chunks=[];
  for await(const chunk of req) {size+=chunk.length;if(size>bodyLimit) throw Object.assign(new Error(),{status:413});chunks.push(chunk);}
  let body; try {body=size?JSON.parse(Buffer.concat(chunks).toString()):undefined;} catch {throw Object.assign(new Error(),{status:400});}
  return {owner:principal.identity,body};
 };
}
