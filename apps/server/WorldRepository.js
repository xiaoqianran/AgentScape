import { mkdir, lstat, readFile, readdir, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorldDiskStorage } from './WorldDiskStorage.js';
import { WorldStorage, WORLD_BLOCK_BYTES, hashBytes, checkHash } from '../../application/scene/WorldStorage.js';
import { parseCodeProject } from '../../application/native-scene/CodeProject.js';
import { parseAuthoringDocument } from '../../application/world-authoring/AuthoringDocument.js';

const MAX_WORLD_BYTES = 24 * 1024 * 1024;
const MAX_WORLDS = 128;
const MAX_POINTER_BYTES = 8192;
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,95}$/;
const fail = (code,status=400) => Object.assign(new Error(code),{code,status});
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8',{fatal:true});
const clone = value => structuredClone(value);

/** Pure immutable WorldRepository records, separately from actual live Object3D instances. */
export class WorldRepository {
  constructor({ directory = path.resolve('.studio-world-repository'), maxWorldBytes = MAX_WORLD_BYTES,
    maxWorlds = MAX_WORLDS, now = () => new Date().toISOString() } = {}) {
    this.directory=path.resolve(directory);
    this.recordsDirectory=path.join(this.directory,'records');
    this.blocksDirectory=path.join(this.directory,'blocks');
    this.maxWorldBytes=maxWorldBytes;
    this.maxWorlds=maxWorlds;
    this.now=now;
    this.backend=new WorldDiskStorage(this.blocksDirectory);
    this.storage=new WorldStorage(this.backend);
    this.initPromise=null;
  }
  validateId(id) {
    if(typeof id!=='string'||!idPattern.test(id))throw fail('WORLD_REPOSITORY_ID_INVALID');
    return id;
  }
  async initialize() {
    if(this.initPromise)return this.initPromise;
    this.initPromise=(async()=>{
      for(const directory of [this.directory,this.recordsDirectory]){
        await mkdir(directory,{recursive:true,mode:0o700});
        const info=await lstat(directory);
        if(!info.isDirectory()||info.isSymbolicLink())throw fail('WORLD_REPOSITORY_DIRECTORY_INVALID',500);
      }
      await this.backend.initialize();
      return this;
    })();
    try{return await this.initPromise;}catch(error){this.initPromise=null;throw error;}
  }
  pointerPath(id) {return path.join(this.recordsDirectory,this.validateId(id)+'.json');}
  async getPointer(id) {
    await this.initialize();
    let file;
    try{
      const fullPath=this.pointerPath(id);
      const info=await lstat(fullPath);
      if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_POINTER_BYTES)throw fail('WORLD_REPOSITORY_POINTER_INVALID',500);
      const handle=await open(fullPath,constants.O_RDONLY | (constants.O_NOFOLLOW||0));
      try{file=await handle.readFile();}finally{await handle.close();}
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(file.length>MAX_POINTER_BYTES)throw fail('WORLD_REPOSITORY_POINTER_INVALID',500);
    let item;
    try{item=JSON.parse(decoder.decode(file));}catch{throw fail('WORLD_REPOSITORY_POINTER_INVALID',500);}
    if(item?.schema!=='agentscape.world-repository-entry'||item?.schemaVersion!==1||
      item?.id!==id||!['code-project','authoring-draft'].includes(item.kind)||
      !Number.isSafeInteger(item.version)||item.version<1||
      typeof item.name!=='string'||item.name.length>128||
      !Number.isSafeInteger(item.totalBytes)||item.totalBytes<=0||item.totalBytes>this.maxWorldBytes||
      !Array.isArray(item.blocks)||!item.blocks.length||item.blocks.length>Math.ceil(this.maxWorldBytes/WORLD_BLOCK_BYTES)||
      item.blocks.some(ref=>!Number.isSafeInteger(ref.bytes)||ref.bytes<=0||ref.bytes>WORLD_BLOCK_BYTES||
        !/^[a-f0-9]{64}$/.test(ref.hash))||
      item.blocks.reduce((sum,ref)=>sum+ref.bytes,0)!==item.totalBytes)throw fail('WORLD_REPOSITORY_POINTER_INVALID',500);
    checkHash(item.digest);
    return item;
  }
  metadata(pointer) {
    const { blocks, ...meta }=pointer;
    return { ...meta, totalBlocks:blocks.length };
  }
  async list({offset=0,limit=30,kind=null}={}) {
    await this.initialize();
    if(!Number.isInteger(offset)||offset<0||offset>MAX_WORLDS ||
      !Number.isInteger(limit)||limit<1||limit>50||
      (kind!==null&&!['code-project','authoring-draft'].includes(kind)))throw fail('WORLD_REPOSITORY_QUERY_INVALID');
    const entries=await readdir(this.recordsDirectory,{withFileTypes:true});
    const filenames=entries.filter(entry=>entry.name.endsWith('.json')).map(entry=>entry.name);
    if(filenames.length>this.maxWorlds)throw fail('WORLD_REPOSITORY_CAPACITY_EXCEEDED',500);
    const records=[];
    for(const filename of filenames){
      if(!idPattern.test(filename.slice(0,-5)))throw fail('WORLD_REPOSITORY_POINTER_INVALID',500);
      const item=await this.getPointer(filename.slice(0,-5));
      if(item&&(!kind||kind===item.kind))records.push(this.metadata(item));
    }
    records.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
    return {schema:'agentscape.world-repository-list',schemaVersion:1,worlds:records.slice(offset,offset+limit),
      total:records.length,nextOffset:offset+limit<records.length?offset+limit:null};
  }
  async load(id) {
    const pointer=await this.getPointer(this.validateId(id));
    if(!pointer)throw fail('WORLD_REPOSITORY_NOT_FOUND',404);
    const chunks=[];
    for(const ref of pointer.blocks)chunks.push(await this.storage.read(ref));
    const bytes=new Uint8Array(pointer.totalBytes);
    let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(hashBytes(bytes)!==pointer.digest)throw fail('WORLD_REPOSITORY_INTEGRITY_MISMATCH',500);
    let content;
    try{content=JSON.parse(decoder.decode(bytes));}
    catch{throw fail('WORLD_REPOSITORY_CONTENT_INVALID',500);}
    await this.validateContent(pointer.kind,id,content);
    return {...this.metadata(pointer),content};
  }
  async validateContent(kind,id,content) {
    if(kind==='code-project'){
      const parsed=await parseCodeProject(content,{maxBytes:this.maxWorldBytes});
      if(parsed.id!==id)throw fail('WORLD_REPOSITORY_ID_MISMATCH');
      return parsed;
    }
    if(kind==='authoring-draft'){
      if(!content||content.id!==id||typeof content.name!=='string'||
        !content.document||typeof content.document!=='object')
        throw fail('WORLD_REPOSITORY_CONTENT_INVALID');
      parseAuthoringDocument(content.document);
      if(content.promotions!=null && (typeof content.promotions!=='object'||Array.isArray(content.promotions)))
        throw fail('WORLD_REPOSITORY_CONTENT_INVALID');
      return clone(content);
    }
    throw fail('WORLD_REPOSITORY_KIND_INVALID');
  }
  async publish({id,kind,baseVersion,content}={}) {
    this.validateId(id);
    if(baseVersion!==null && (!Number.isSafeInteger(baseVersion)||baseVersion<1))
      throw fail('WORLD_REPOSITORY_BASE_VERSION_REQUIRED');
    if(!['code-project','authoring-draft'].includes(kind))throw fail('WORLD_REPOSITORY_KIND_INVALID');
    const normalized=await this.validateContent(kind,id,content);
    const bytes=encoder.encode(JSON.stringify(normalized));
    if(bytes.byteLength>this.maxWorldBytes)throw fail('WORLD_REPOSITORY_SIZE_LIMIT',413);
    await this.initialize();
    const lockPath=path.join(this.recordsDirectory,id+'.lock');
    let lock;
    try{lock=await open(lockPath,'wx',0o600);}
    catch(error){if(error.code==='EEXIST')throw fail('WORLD_REPOSITORY_BUSY',409);throw error;}
    try{
      const previous=await this.getPointer(id);
      if(previous ? (baseVersion!==previous.version||previous.kind!==kind) : baseVersion!==null)
        throw fail('WORLD_REPOSITORY_VERSION_CONFLICT',409);
      if(!previous&&(await readdir(this.recordsDirectory)).filter(name=>name.endsWith('.json')).length>=this.maxWorlds)
        throw fail('WORLD_REPOSITORY_CAPACITY_EXCEEDED',413);
      const blocks=[];
      for(let offset=0;offset<bytes.length;offset+=WORLD_BLOCK_BYTES){
        blocks.push(await this.storage.put(bytes.subarray(offset,Math.min(bytes.length,offset+WORLD_BLOCK_BYTES))));
      }
      const pointer={
        schema:'agentscape.world-repository-entry',schemaVersion:1,
        id,kind,name:String(normalized.name||id).slice(0,128),
        version:(previous?.version||0)+1,createdAt:previous?.createdAt||this.now(),updatedAt:this.now(),
        digest:hashBytes(bytes),totalBytes:bytes.length,blocks
      };
      const temporary=path.join(this.recordsDirectory,'.pending-'+randomUUID());
      const handle=await open(temporary,'wx',0o600);
      try{await handle.writeFile(JSON.stringify(pointer));await handle.sync();}
      finally{await handle.close();}
      try{await rename(temporary,this.pointerPath(id));}
      finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      return this.metadata(pointer);
    }finally{await lock.close();await unlink(lockPath).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
}
