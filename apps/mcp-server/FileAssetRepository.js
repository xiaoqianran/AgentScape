import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { parseDefinition, canonical, proceduralContract } from '../../application/programmatic-assets/ProgrammaticAssetContract.js';
import { validateAssetManifest } from '../../modules/asset/model/schema.js';

export const hash=value=>createHash('sha256').update(value).digest('hex');
export const assetVersion=(source,definition,environment)=>hash(canonical({contract:proceduralContract,source,definition,environment}));
const assetPattern=/^pa_[a-f0-9]{64}$/;
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class FileAssetRepository {
 constructor(root) {this.root=path.resolve(root);}
 ownerRoot(owner) {return path.join(this.root,'owners',hash(owner));}
 target(owner,kind,id) {
  if(!['assets','builds','requests','worlds'].includes(kind)||!(kind==='assets'?assetPattern:uuidPattern).test(id))throw new Error('STORAGE_ID_INVALID');
  return path.join(this.ownerRoot(owner),kind,id);
 }
 async read(file,max=4194304) {
  const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('STORAGE_INTEGRITY_FAILED');
  return readFile(file);
 }
 async json(file) {return JSON.parse((await this.read(file)).toString('utf8'));}
 async atomic(file,value) {
  await mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${randomUUID()}.tmp`;
  try{await writeFile(temp,JSON.stringify(value),{flag:'wx'});await rename(temp,file);}finally{await rm(temp,{force:true});}
 }
 async ids(owner,kind) {try{return(await readdir(path.join(this.ownerRoot(owner),kind))).filter(id=>(kind==='assets'?assetPattern:uuidPattern).test(id));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 async save(owner,{source,definition,environment,...result}) {
  const version=assetVersion(source,definition,environment),assetId=`pa_${version}`;
  const target=this.target(owner,'assets',assetId);
  const manifestJSON=JSON.stringify(result.manifest);
  const hashes={source:hash(source),definition:hash(canonical(definition)),glb:hash(result.bytes),manifest:hash(manifestJSON)};
  try{const previous=await this.get(owner,assetId);if(previous.build.hashes.glb!==hashes.glb)throw new Error('BUILD_NONDETERMINISTIC');return previous;}catch(e){if(e.code!=='ENOENT')throw e;}
  if((await this.ids(owner,'assets')).length>=128)throw new Error('ASSET_STORAGE_QUOTA');
  const build={schema:proceduralContract,assetId,logicalId:definition?.id || 'visual',version,owner:hash(owner),definition,environment,hashes,admission:result.admission,validation:result.validation,security:result.security,createdAt:new Date().toISOString()};
  if(Buffer.byteLength(JSON.stringify(build))>1048576||Buffer.byteLength(manifestJSON)>262144)throw new Error('BUILD_METADATA_LIMIT');
  await mkdir(path.dirname(target),{recursive:true});const staging=path.join(path.dirname(target),`.tmp-${randomUUID()}`);
  try{
   await mkdir(staging);await writeFile(path.join(staging,'source.js'),source);await writeFile(path.join(staging,'asset.glb'),result.bytes);await writeFile(path.join(staging,'manifest.json'),manifestJSON);await writeFile(path.join(staging,'build.json'),JSON.stringify(build));
   if(hash(await this.read(path.join(staging,'asset.glb')))!==hashes.glb)throw new Error('STORAGE_INTEGRITY_FAILED');
   try{await rename(staging,target);}catch(error){
    if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;
    const previous=await this.get(owner,assetId);if(previous.build.hashes.glb!==hashes.glb)throw new Error('BUILD_NONDETERMINISTIC');
   }
  }finally{await rm(staging,{recursive:true,force:true});}
  return this.get(owner,assetId);
 }
 async get(owner,assetId,{published=false}={}) {
  const directory=this.target(owner,'assets',assetId);
  const [build,source,bytes,manifestBytes]=await Promise.all([this.json(path.join(directory,'build.json')),this.read(path.join(directory,'source.js'),131072),this.read(path.join(directory,'asset.glb')),this.read(path.join(directory,'manifest.json'),262144)]);
  if(build.owner!==hash(owner)||build.assetId!==assetId||build.schema!==proceduralContract||build.environment.threeVersion!=='0.186.0'||assetVersion(source.toString('utf8'),(build.definition == null ? null : parseDefinition(build.definition)),build.environment)!==build.version||assetId!==`pa_${build.version}`||hash(source)!==build.hashes.source||hash(canonical(build.definition))!==build.hashes.definition||hash(bytes)!==build.hashes.glb||hash(manifestBytes)!==build.hashes.manifest)throw new Error('STORAGE_INTEGRITY_FAILED');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));validateAssetManifest(manifest);
  if(manifest.id!==assetId||manifest.source.kind!=='compiled'||manifest.source.key!==assetId||manifest.source.fallbackUrl)throw new Error('STORAGE_INTEGRITY_FAILED');
  let isPublished=false;try{const marker=await this.json(path.join(directory,'published.json'));if(marker.assetId!==assetId||marker.owner!==hash(owner))throw new Error('STORAGE_INTEGRITY_FAILED');isPublished=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(published&&!isPublished)throw new Error('ASSET_NOT_PUBLISHED');
  return {build,manifest,source:source.toString('utf8'),bytes,published:isPublished};
 }
 async publish(owner,assetId) {const asset=await this.get(owner,assetId);await this.atomic(path.join(this.target(owner,'assets',assetId),'published.json'),{assetId,owner:hash(owner)});return asset;}
 async list(owner) {
  const result=[];for(const id of await this.ids(owner,'assets')){const asset=await this.get(owner,id);if(asset.published)result.push({assetId:id,logicalId:asset.build.logicalId,version:asset.build.version,label:asset.manifest.label,admission:asset.build.admission});}return result;
 }
 compiledStore(owner) {
  const memory=new Map();return {
   put:async(key,bytes,metadata)=>{if(assetPattern.test(key))throw new Error('ASSET_VERSION_IMMUTABLE');memory.set(key,{bytes,metadata});return key;},
   get:async key=>assetPattern.test(key)?{bytes:(await this.get(owner,key,{published:true})).bytes}:memory.get(key),
   has:async key=>assetPattern.test(key)?Boolean(await this.get(owner,key,{published:true})):memory.has(key)
  };
 }
 async attach(owner,assets,ids=null) {
  for(const assetId of ids || (await this.list(owner)).map(a=>a.assetId)){const asset=await this.get(owner,assetId,{published:true});await assets.registerManifest(asset.manifest);}
 }
 async saveWorld(owner,snapshot) {
  if((await this.ids(owner,'worlds')).length>=128)throw new Error('WORLD_STORAGE_QUOTA');
  const dependencies=[];
  for(const assetId of new Set(snapshot.objects.map(o=>o.assetId))){
   if(assetPattern.test(assetId)){const a=await this.get(owner,assetId,{published:true});dependencies.push({assetId,manifestHash:a.build.hashes.manifest});}
   else if(!['agent','cabinet','cup','table'].includes(assetId))throw new Error('WORLD_ASSET_NOT_PUBLISHED');
  }
  const saveId=randomUUID(),snapshotText=JSON.stringify(snapshot);
  if(Buffer.byteLength(snapshotText)>4194304)throw new Error('EXPORT_LIMIT');
  const record={schema:'agentscape.saved-world.v1',owner:hash(owner),hash:hash(snapshotText),snapshot,dependencies,createdAt:new Date().toISOString()};
  if(Buffer.byteLength(JSON.stringify(record))>4194304)throw new Error('EXPORT_LIMIT');
  await this.atomic(this.target(owner,'worlds',saveId),record);
  return {saveId,dependencies,objects:snapshot.objects.length};
 }
 async loadWorld(owner,saveId) {
  const data=await this.json(this.target(owner,'worlds',saveId));
  if(data.schema!=='agentscape.saved-world.v1'||data.owner!==hash(owner)||hash(JSON.stringify(data.snapshot))!==data.hash)throw new Error('STORAGE_INTEGRITY_FAILED');
  for(const dependency of data.dependencies){const asset=await this.get(owner,dependency.assetId,{published:true});if(asset.build.hashes.manifest!==dependency.manifestHash)throw new Error('STORAGE_INTEGRITY_FAILED');}
  const resolved=new Set(data.dependencies.map(d=>d.assetId));
  if(data.snapshot.objects.some(o=>assetPattern.test(o.assetId)&&!resolved.has(o.assetId)))throw new Error('STORAGE_INTEGRITY_FAILED');
  return data;
 }
}
