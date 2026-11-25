import {startServer} from '../../apps/mcp-server/main.mjs';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
const root=await mkdtemp(path.join(tmpdir(),'as-transfer-pressure-')),token=randomBytes(32).toString('hex');
const app=await startServer({root,dataRoot:path.join(root,'assets'),port:0,tokens:[{identity:'pressure',token}]});
const base='http://127.0.0.1:'+app.port,headers={Authorization:'Bearer '+token};
const json=async(route,method='GET',body)=>{const r=await fetch(base+route,{method,headers:{...headers,'Content-Type':'application/json'},body:body==null?undefined:JSON.stringify(body)});if(!r.ok)throw Error(r.status+':'+await r.text());return r.json();};
let peak=process.memoryUsage().rss;const initial=peak,timer=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),20);
try{
 for(const total of [10*1024*1024,100*1024*1024,1024*1024*1024]){
  const start=performance.now(),expected=createHash('sha256'),task=await json('/uploads','POST',{bytes:total}),parts=[];let sent=0;
  while(sent<total){
   const partBytes=Math.min(64_000_000,total-sent),byte=parts.length%251,block=Buffer.alloc(1024*1024,byte);
   async function* body(){for(let count=0;count<partBytes;){const chunk=block.subarray(0,Math.min(block.length,partBytes-count));expected.update(chunk);count+=chunk.length;yield chunk;}}
   const r=await fetch(base+'/uploads/'+task.id+'/parts',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(partBytes)},body:Readable.from(body()),duplex:'half'});
   if(r.status!==201)throw Error(r.status+':'+await r.text());parts.push((await r.json()).id);sent+=partBytes;
  }
  const uploadedAt=performance.now(),file=await json('/uploads/'+task.id+'/complete','POST',{partIds:parts}),completedAt=performance.now();
  const actual=createHash('sha256'),r=await fetch(base+'/files/'+file.id+'/content',{headers});let received=0;
  for await(const chunk of r.body){actual.update(chunk);received+=chunk.length;}
  const digest=expected.digest('hex');if(received!==total||actual.digest('hex')!==digest||file.sha256!==digest)throw Error('digest mismatch');
  const downloadedAt=performance.now();await json('/files/'+file.id,'DELETE');
  console.log(JSON.stringify({bytes:total,parts:parts.length,uploadSeconds:(uploadedAt-start)/1000,completeSeconds:(completedAt-uploadedAt)/1000,downloadSeconds:(downloadedAt-completedAt)/1000,sha256:digest,verified:true,peakRssMiB:peak/1024/1024,initialRssMiB:initial/1024/1024,reservedAfterDelete:app.transfers.bytes}));
 }
}finally{clearInterval(timer);await app.close();await rm(root,{recursive:true,force:true});}
