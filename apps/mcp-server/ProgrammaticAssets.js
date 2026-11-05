import { randomUUID } from 'node:crypto';
import { parseDefinition, canonical } from '../../application/programmatic-assets/ProgrammaticAssetContract.js';
import { assetVersion, hash } from './FileAssetRepository.js';

export class ProgrammaticAssets {
 constructor({repository,builder,runner}) {Object.assign(this,{repository,builder,runner});this.running=new Map();this.locks=new Map();this.closed=false;}
 async exclusive(owner,fn) {const previous=this.locks.get(owner)||Promise.resolve();const next=previous.catch(()=>{}).then(fn);this.locks.set(owner,next);try{return await next;}finally{if(this.locks.get(owner)===next)this.locks.delete(owner);}}
 summary(job) {return {buildId:job.buildId,status:job.status,assetId:job.assetId,admission:job.admission,error:job.error,...(job.diagnostics?{diagnostics:job.diagnostics}:{})};}
 async submit(owner,{source,definition,requestId,forceRebuild=false}) {
  if(this.closed)throw new Error('ASSET_SERVICE_CLOSED');
  if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>32768)throw new Error('BUILD_SOURCE_LIMIT');
  definition=parseDefinition(definition);
  const environment=await this.runner.environment();
  const version=assetVersion(source,definition,environment),assetId=`pa_${version}`;
  return this.exclusive(owner,async()=>{
   if(this.closed)throw new Error('ASSET_SERVICE_CLOSED');
   const requestFile=this.repository.target(owner,'requests',requestId),fingerprint=hash(canonical({source,definition,environment,forceRebuild}));
   try{const existing=await this.repository.json(requestFile);if(existing.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return this.status(owner,existing.buildId);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!forceRebuild){
    const matching=[...this.running.entries()].find(([,entry])=>entry.owner===owner&&entry.assetId===assetId);
    if(matching){await this.repository.atomic(requestFile,{fingerprint,buildId:matching[0]});return this.status(owner,matching[0]);}
   }
   if(this.running.size>=4||[...this.running.values()].filter(j=>j.owner===owner).length>=2)throw new Error('BUILD_LIMIT');
   if((await this.repository.ids(owner,'builds')).length>=1024)throw new Error('BUILD_STORAGE_QUOTA');
   const job={buildId:randomUUID(),owner:hash(owner),status:'running',assetId};
   if(!forceRebuild){try{const existing=await this.repository.get(owner,assetId);job.status='succeeded';job.admission=existing.build.admission;}catch(e){if(e.code!=='ENOENT')throw e;}}
   const jobFile=this.repository.target(owner,'builds',job.buildId);
   await this.repository.atomic(jobFile,job);await this.repository.atomic(requestFile,{fingerprint,buildId:job.buildId});
   if(job.status==='running'){
    const controller=new AbortController();const entry={owner,assetId,controller,promise:null};this.running.set(job.buildId,entry);
    entry.promise=(async()=>{
     try{
      const built=await this.builder.build({source,definition,assetId},{signal:controller.signal});
      if(controller.signal.aborted)throw new Error('BUILD_CANCELLED');
      if(canonical(built.environment)!==canonical(environment))throw new Error('BUILD_ENVIRONMENT_CHANGED');
      const stored=await this.repository.save(owner,{source,definition,environment,...built});
      job.status='succeeded';job.admission=stored.build.admission;
     }catch(error){job.status=controller.signal.aborted?'cancelled':'failed';job.error=/^[A-Z_]+$/.test(error.message)?error.message:'BUILD_FAILED';if(error.details&&JSON.stringify(error.details).length<=65536)job.diagnostics=error.details;}
     finally{await this.repository.atomic(jobFile,job);this.running.delete(job.buildId);}
    })();
    entry.promise.catch(()=>{});
   }
   return this.summary(job);
  });
 }
 async status(owner,buildId) {
  let job;try{job=await this.repository.json(this.repository.target(owner,'builds',buildId));}catch(e){if(e.code==='ENOENT')throw new Error('BUILD_NOT_FOUND');throw e;}if(job.owner!==hash(owner))throw new Error('BUILD_NOT_FOUND');
  if(job.status==='running'&&!this.running.has(buildId)){job.status='interrupted';job.error='BUILD_INTERRUPTED';await this.repository.atomic(this.repository.target(owner,'builds',buildId),job);}
  return this.summary(job);
 }
 async cancel(owner,buildId) {await this.status(owner,buildId);const entry=this.running.get(buildId);if(entry){entry.controller.abort();await entry.promise;}return this.status(owner,buildId);}
 async publish(owner,buildId,allowProvisional=false) {
  const job=await this.status(owner,buildId);if(job.status!=='succeeded')throw new Error('BUILD_NOT_SUCCEEDED');
  const asset=await this.repository.get(owner,job.assetId);
  if(asset.build.admission.status==='rejected'||(asset.build.admission.status!=='ready'&&!allowProvisional))throw new Error('ASSET_NOT_READY');
  await this.repository.publish(owner,job.assetId);return {assetId:job.assetId,version:asset.build.version,admission:asset.build.admission,published:true};
 }
 async inspect(owner,assetId,includeSource=false) {const a=await this.repository.get(owner,assetId);return {assetId,published:a.published,manifest:a.manifest,build:a.build,...(includeSource?{source:a.source}:{})};}
 async close() {this.closed=true;for(const entry of this.running.values())entry.controller.abort();await Promise.allSettled([...this.running.values()].map(j=>j.promise));this.runner.close();}
}
