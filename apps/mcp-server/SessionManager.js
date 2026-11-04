import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { HeadlessWorldHost } from './HeadlessWorldHost.js';
export class SessionManager {
 constructor({root,maxSessions=4,ttlMs=900000,maxExportBytes=4194304,hostOptions={},repository=null}={}) {
  this.root=path.resolve(root); this.maxSessions=maxSessions; this.ttlMs=ttlMs; this.maxExportBytes=maxExportBytes; this.hostOptions=hostOptions; this.sessions=new Map(); this.pending=0;
  this.timer=setInterval(()=>this.reap().catch(()=>{}),Math.min(ttlMs,30000)); this.timer.unref();
  this.repository=repository;this.restoreRequests=new Map();
 }
 async create(owner,{assetIds=[]}={}) {
  if(this.disposed) throw new Error('MANAGER_CLOSED');
  if(this.sessions.size+this.pending>=this.maxSessions) throw new Error('SESSION_LIMIT');
  this.pending++;
  let host;
  try {
   host=await HeadlessWorldHost.create({...this.hostOptions,owner,repository:this.repository,assetIds});
   if(this.disposed) throw new Error('MANAGER_CLOSED');
   const id=randomUUID(),directory=path.join(this.root,id); await mkdir(directory,{recursive:true});
   this.sessions.set(id,{id,owner,host,directory,lastUsed:Date.now(),active:null,closing:false,requests:new Map()});
   return this.status(owner,id);
  } catch(e) { host?.close(); throw e; } finally { this.pending--; }
 }
 get(owner,id) { const s=this.sessions.get(id); if(!s || s.owner!==owner || s.closing) throw new Error('SESSION_NOT_FOUND'); s.lastUsed=Date.now(); return s; }
 status(owner,id) { const s=this.get(owner,id); return {worldSessionId:id,environmentId:s.host.world.environment.id,tick:s.host.world.simulation.tick,execution:s.active?'running':'idle',expiresAt:s.lastUsed+this.ttlMs}; }
 async run(owner,id,operation,{requestId,fingerprint,signal}={}) {
  const s=this.get(owner,id);
  if(requestId && s.requests.has(requestId)) {
   const previous=s.requests.get(requestId); if(previous.fingerprint!==fingerprint) throw new Error('IDEMPOTENCY_CONFLICT'); return previous.promise;
  }
  if(s.active) throw new Error('SESSION_BUSY');
  if(requestId && s.requests.size>=256) throw new Error('REQUEST_BUDGET_EXHAUSTED');
  const controller=new AbortController(); const abort=()=>controller.abort(); signal?.addEventListener('abort',abort,{once:true}); if(signal?.aborted) abort();
  const promise=Promise.resolve().then(()=>operation(s,controller.signal)); s.active={controller,promise};
  if(requestId) s.requests.set(requestId,{fingerprint,promise});
  try { return await promise; } finally { signal?.removeEventListener('abort',abort); s.active=null; s.lastUsed=Date.now(); }
 }
 async export(s) {
  const snapshot=s.host.world.serialize({name:'Remote MCP snapshot'}),json=JSON.stringify(snapshot);
  if(Buffer.byteLength(json)>this.maxExportBytes) throw new Error('EXPORT_LIMIT');
  const name=`snapshot-${randomUUID()}.json`,temporary=path.join(s.directory,`${name}.tmp`),target=path.join(s.directory,name);
  try { await writeFile(temporary,json,{flag:'wx'}); JSON.parse(await readFile(temporary,'utf8')); await rename(temporary,target); }
  finally { await rm(temporary,{force:true}); }
  return {state:'exported',fileName:name,bytes:Buffer.byteLength(json),snapshot,scope:'scene-json-only'};
 }
 async save(owner,s) {
  if(!this.repository)throw new Error('PERSISTENCE_UNAVAILABLE');
  return this.repository.saveWorld(owner,s.host.world.serialize({name:'Saved MCP world'}));
 }
 async restore(owner,saveId,requestId) {
  if(!this.repository)throw new Error('PERSISTENCE_UNAVAILABLE');
  const key=JSON.stringify([owner,requestId]);
  const existing=this.restoreRequests.get(key);
  if(existing){if(existing.saveId!==saveId)throw new Error('IDEMPOTENCY_CONFLICT');return existing.promise;}
  if(this.restoreRequests.size>=256)throw new Error('RESTORE_REQUEST_LIMIT');
  const promise=(async()=>{
   const data=await this.repository.loadWorld(owner,saveId);
   const session=await this.create(owner,{assetIds:data.dependencies.map(d=>d.assetId)});
   try{await this.run(owner,session.worldSessionId,s=>s.host.world.restoreSnapshot(data.snapshot));return this.status(owner,session.worldSessionId);}
   catch(error){await this.close(owner,session.worldSessionId);throw error;}
  })();
  this.restoreRequests.set(key,{saveId,promise});return promise;
 }
 async exportAuthoring(s) {
  const document=s.host.session.authoring.export();
  const draft={schema:'agentscape.remote-authoring',schemaVersion:1,sources:s.host.authoringSources,document,promotions:s.host.session.promotion.exportState()};
  const json=JSON.stringify(draft);
  if(Buffer.byteLength(json)>this.maxExportBytes) throw new Error('EXPORT_LIMIT');
  const fileName=`authoring-${randomUUID()}.json`,temporary=path.join(s.directory,`${fileName}.tmp`),target=path.join(s.directory,fileName);
  try {await writeFile(temporary,json,{flag:'wx'});JSON.parse(await readFile(temporary,'utf8'));await rename(temporary,target);}
  finally {await rm(temporary,{force:true});}
  return {state:'exported',fileName,bytes:Buffer.byteLength(json),scope:'authoring-source-and-document-only',draft};
 }
 async close(owner,id) { const s=this.get(owner,id); s.closing=true; s.active?.controller.abort(); try { await s.active?.promise.catch(()=>{}); s.host.close(); } finally { this.sessions.delete(id); } return {worldSessionId:id,state:'closed'}; }
 async reap() { for(const s of this.sessions.values()) if(!s.active && Date.now()-s.lastUsed>=this.ttlMs) await this.close(s.owner,s.id); }
 async dispose() { this.disposed=true; clearInterval(this.timer); await Promise.all([...this.sessions.values()].map(s=>this.close(s.owner,s.id))); }
}
