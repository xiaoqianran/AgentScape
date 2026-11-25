import * as z from 'zod/v4';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const createSchema=z.object({bytes:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
const completeSchema=z.object({partIds:z.array(z.string().regex(/^part_[a-f0-9-]{36}$/)).max(1024)}).strict();
const json=(res,status,data)=>res.writeHead(status,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify(data));
export async function handleTransferHttp(req,res,authorize,store){
 const route=/^\/(uploads|files)(?:\/((?:upload|file)_[a-f0-9-]{36}))?(?:\/(parts|complete|cancel|content))?$/.exec(req.url);
 if(!route)return false;
 const [,type,id,action]=route,method=req.method;
 const raw=type==='uploads'&&action==='parts'&&method==='POST';
 const {owner,body}=await authorize(req,{raw,bodyLimit:raw?store.maxPartBytes:65536});
 try{
  if(type==='uploads'){
   if(!id&&method==='POST'&&!action){json(res,201,await store.create(owner,createSchema.parse(body)));return true;}
   if(id&&method==='GET'&&!action){json(res,200,store.metadata(store.get(owner,id,'pending')));return true;}
   if(id&&method==='POST'&&action==='parts'){json(res,201,await store.part(owner,id,req));return true;}
   if(id&&method==='POST'&&action==='complete'){json(res,200,await store.complete(owner,id,completeSchema.parse(body).partIds));return true;}
   if(id&&method==='POST'&&action==='cancel'){json(res,200,await store.cancel(owner,id,'pending'));return true;}
  }else if(id){
   if(method==='GET'&&!action){json(res,200,store.metadata(store.get(owner,id,'complete')));return true;}
   if(method==='DELETE'&&!action){json(res,200,await store.cancel(owner,id,'complete'));return true;}
   if(method==='GET'&&action==='content'){
    const lease=store.lease(owner,id);try{
     res.writeHead(200,{'content-type':'application/octet-stream','content-length':lease.metadata.bytes,'x-content-sha256':lease.metadata.sha256});
     // Keep one chunk of lookahead. All disk reads are closed before sending
     // the last chunk; clients that read Content-Length can immediately delete.
     async function* content(){
      let pending;
      try{for await(const chunk of lease.source()){if(pending)yield pending;pending=chunk;}
       lease.release();if(pending)yield pending;
      }finally{lease.release();}
     }
     await pipeline(Readable.from(content()),res);
    }finally{lease.release();}return true;
   }
  }
  json(res,405,{error:'METHOD_NOT_ALLOWED'});
 }catch(error){
  if(res.headersSent){res.destroy();return true;}
  if(error instanceof z.ZodError)json(res,400,{error:'INVALID_ARGUMENTS'});
  else if(error.status)json(res,error.status,{error:error.code??'TRANSFER_REJECTED'});
  else throw error;
 }
 return true;
}
