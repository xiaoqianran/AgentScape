import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { WorldStorage, WORLD_BLOCK_BYTES } from '../../application/scene/WorldStorage.js';
import { WorldDiskStorage } from '../shared/node/WorldDiskStorage.js';
import { TRANSFER_PART_BYTES, TRANSFER_FILE_BYTES, TRANSFER_TTL_MS } from './TransferLimits.js';

const fail=(code,status=400)=>Object.assign(new Error(code),{code,status});
const sha=()=>createHash('sha256');
const abort=signal=>{if(signal?.aborted)throw fail('TRANSFER_CANCELLED',409);};

/** Owner-scoped disk staging, bounded by declared bytes, not JS buffers.
 *  Uploads/files live for this server process; no cross-process sharing.
 */
export class TransferStore {
 constructor(root,{maxFileBytes=TRANSFER_FILE_BYTES,maxPartBytes=TRANSFER_PART_BYTES,
   maxDiskBytes=24_000_000_000,maxEntries=128,maxConcurrent=4,ttlMs=TRANSFER_TTL_MS,now=Date.now}={}){
  Object.assign(this,{root,maxFileBytes,maxPartBytes,maxDiskBytes,maxEntries,maxConcurrent,ttlMs,now});
  for(const value of [maxFileBytes,maxPartBytes,maxDiskBytes,maxEntries,maxConcurrent,ttlMs])if(!Number.isSafeInteger(value)||value<1)throw fail('TRANSFER_CONFIG_INVALID');
  this.entries=new Map();this.bytes=0;this.active=0;
 }
 async initialize(){
  await mkdir(this.root,{recursive:true,mode:0o700});
  this.directory=await mkdtemp(path.join(this.root,'transfer-'));
  this.timer=setInterval(()=>this.reap().catch(()=>{}),Math.min(this.ttlMs,30000));this.timer.unref();
  return this;
 }
 reserve(bytes){if(this.bytes+bytes>this.maxDiskBytes)throw fail('TRANSFER_DISK_LIMIT',413);this.bytes+=bytes;}
 acquire(){if(this.active>=this.maxConcurrent)throw fail('TRANSFER_BUSY',429);this.active++;return()=>{this.active--;};}
 get(owner,id,state){
  const entry=this.entries.get(id);
  if(!entry||entry.owner!==owner||entry.state!==state)throw fail('TRANSFER_NOT_FOUND',404);
  if(state==='pending'&&entry.expiresAt<=this.now())throw fail('TRANSFER_EXPIRED',410);
  return entry;
 }
 metadata(entry){return {id:entry.id,object:entry.state==='complete'?'file':'upload',bytes:entry.expected,
   receivedBytes:entry.received,sha256:entry.digest??null,status:entry.state,
   ...(entry.state==='pending'?{expiresAt:entry.expiresAt,parts:entry.parts.map(({id,bytes,sha256})=>({id,bytes,sha256}))}:{})};}
 async entry(owner,expected,state='pending'){
  if(this.entries.size>=this.maxEntries)throw fail('TRANSFER_ENTRY_LIMIT',429);
  if(!Number.isSafeInteger(expected)||expected<0||expected>this.maxFileBytes)throw fail('TRANSFER_FILE_LIMIT',413);
  this.reserve(expected);
  const id=(state==='pending'?'upload_':'file_')+randomUUID();
  const entry={id,owner,expected,received:0,reserved:expected,state,parts:[],busy:true,readers:0,expiresAt:this.now()+this.ttlMs,directory:path.join(this.directory,id)};
  this.entries.set(id,entry);
  try{await mkdir(entry.directory,{mode:0o700});return entry;}catch(error){this.entries.delete(id);this.bytes-=expected;throw error;}
 }
 async create(owner,{bytes,sha256}){
  const entry=await this.entry(owner,bytes);entry.expectedHash=sha256;entry.busy=false;return this.metadata(entry);
 }
 async drop(entry){
  await rm(entry.directory,{recursive:true,force:true});
  this.entries.delete(entry.id);this.bytes-=entry.reserved;
 }
 async cancel(owner,id,state){
  const entry=this.get(owner,id,state);if(entry.busy||entry.readers)throw fail('TRANSFER_BUSY',409);
  entry.busy=true;try{await this.drop(entry);}catch(error){entry.busy=false;throw error;}
  return {id,status:state==='pending'?'cancelled':'deleted'};
 }
 async part(owner,id,source,{signal}={}){
  const entry=this.get(owner,id,'pending');
  if(entry.busy)throw fail('TRANSFER_BUSY',409);
  if(entry.parts.length>=1024)throw fail('TRANSFER_PART_LIMIT',413);
  const release=this.acquire();entry.busy=true;
  const partId='part_'+randomUUID(),file=path.join(entry.directory,partId);
  let handle,size=0;const digest=sha();
  try{
   handle=await open(file,'wx',0o600);
   for await(const chunk of source){
    abort(signal);size+=chunk.length;
    if(size>this.maxPartBytes||entry.received+size>entry.expected)throw fail('TRANSFER_PART_LIMIT',413);
    digest.update(chunk);await handle.writeFile(chunk);
   }
   if(!size)throw fail('TRANSFER_EMPTY_PART');
   await handle.sync();await handle.close();handle=null;
   const part={id:partId,bytes:size,sha256:digest.digest('hex'),file};
   entry.parts.push(part);entry.received+=size;
   return {id:part.id,bytes:size,sha256:part.sha256};
  }catch(error){await handle?.close().catch(()=>{});await rm(file,{force:true});throw error;}
  finally{entry.busy=false;release();}
 }
 async complete(owner,id,partIds){
  const entry=this.get(owner,id,'pending');
  if(entry.busy)throw fail('TRANSFER_BUSY',409);
  const byId=new Map(entry.parts.map(p=>[p.id,p]));
  if(partIds.length!==entry.parts.length||new Set(partIds).size!==partIds.length||partIds.some(id=>!byId.has(id))||entry.received!==entry.expected)throw fail('TRANSFER_INCOMPLETE',409);
  const release=this.acquire();entry.busy=true;
  try{
   const parts=partIds.map(id=>byId.get(id)),digest=sha();let size=0;
   for(const part of parts){const check=sha();let count=0;for await(const chunk of createReadStream(part.file)){check.update(chunk);digest.update(chunk);count+=chunk.length;}if(count!==part.bytes||check.digest('hex')!==part.sha256)throw fail('TRANSFER_HASH_MISMATCH',422);size+=count;}
   const hash=digest.digest('hex');
   if(size!==entry.expected||(entry.expectedHash&&hash!==entry.expectedHash))throw fail('TRANSFER_HASH_MISMATCH',422);
   this.entries.delete(entry.id);entry.id='file_'+randomUUID();entry.state='complete';entry.digest=hash;entry.parts=parts;this.entries.set(entry.id,entry);
   return this.metadata(entry);
  }finally{entry.busy=false;release();}
 }
 // Acquire the file before returning a stream. Deletion cannot race a download/import.
 lease(owner,id){
  const entry=this.get(owner,id,'complete'),release=this.acquire();entry.readers++;
  let released=false;
  return {metadata:this.metadata(entry),source:async function*(){for(const part of entry.parts)yield* createReadStream(part.file,{highWaterMark:WORLD_BLOCK_BYTES});},
   release:()=>{if(!released){released=true;entry.readers--;release();}}};
 }
 async createFile(owner,produce,signal){
  const release=this.acquire();let entry,handle;
  try{
   entry=await this.entry(owner,0,'staging');
   const file=path.join(entry.directory,'content');handle=await open(file,'wx',0o600);const digest=sha();
   const result=await produce({write:async bytes=>{
    abort(signal);if(entry.received+bytes.length>this.maxFileBytes)throw fail('TRANSFER_FILE_LIMIT',413);
    this.reserve(bytes.length);entry.reserved+=bytes.length;await handle.writeFile(bytes);digest.update(bytes);entry.received+=bytes.length;
   }});
   abort(signal);await handle.sync();await handle.close();handle=null;
   entry.expected=entry.received;entry.digest=digest.digest('hex');entry.parts=[{file,bytes:entry.received,sha256:entry.digest}];entry.state='complete';entry.busy=false;
   return {file:this.metadata(entry),result};
  }catch(error){await handle?.close().catch(()=>{});if(entry)await this.drop(entry);throw error;}
  finally{release();}
 }
 async worldStorage(){
  const directory=await mkdtemp(path.join(this.directory,'world-'));
  const disk=await new WorldDiskStorage(directory).initialize();
  const hashes=new Set();let bytes=0,disposed=false;
  const storage=new WorldStorage({read:(...args)=>disk.read(...args),write:async(hash,data)=>{
   if(hashes.has(hash))return disk.write(hash,data);
   this.reserve(data.length);bytes+=data.length;
   try{await disk.write(hash,data);hashes.add(hash);}catch(error){this.bytes-=data.length;bytes-=data.length;throw error;}
  }});
  return {storage,dispose:async()=>{if(disposed)return;await rm(directory,{recursive:true,force:true});disposed=true;this.bytes-=bytes;}};
 }
 async reap(){for(const entry of this.entries.values())if(entry.state==='pending'&&!entry.busy&&entry.expiresAt<=this.now()){entry.busy=true;try{await this.drop(entry);}catch(error){entry.busy=false;throw error;}}}
 async close(){clearInterval(this.timer);await rm(this.directory,{recursive:true,force:true});this.entries.clear();this.bytes=0;}
}
