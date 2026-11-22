import { mkdir, lstat, readdir, open, rename, unlink, link } from 'node:fs/promises';
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
    this.historyDirectory=path.join(this.directory,'history');
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
      for(const directory of [this.directory,this.recordsDirectory,this.historyDirectory]){
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
  historyPath(id,version) {
    this.validateId(id);
    if(!Number.isSafeInteger(version)||version<1)throw fail('WORLD_REPOSITORY_VERSION_INVALID');
    return path.join(this.historyDirectory,id,String(version)+'.json');
  }
  async historyFolder(id) {
    const folder=path.join(this.historyDirectory,this.validateId(id));
    await mkdir(folder,{recursive:true,mode:0o700});
    const info=await lstat(folder);
    if(!info.isDirectory()||info.isSymbolicLink())throw fail('WORLD_REPOSITORY_DIRECTORY_INVALID',500);
    return folder;
  }
  async readPointer(filePath,id,{version=null,missing=null}={}) {
    let file;
    try{
      const info=await lstat(filePath);
      if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_POINTER_BYTES)
        throw fail('WORLD_REPOSITORY_POINTER_INVALID',500);
      const handle=await open(filePath,constants.O_RDONLY | (constants.O_NOFOLLOW||0));
      try{file=await handle.readFile();}finally{await handle.close();}
    }catch(error){
      if(error.code==='ENOENT'&&missing===null)return null;
      if(error.code==='ENOENT')throw fail(missing,500);
      throw error;
    }
    if(file.length>MAX_POINTER_BYTES)throw fail('WORLD_REPOSITORY_POINTER_INVALID',500);
    let item;
    try{item=JSON.parse(decoder.decode(file));}catch{throw fail('WORLD_REPOSITORY_POINTER_INVALID',500);}
    if(item?.schema!=='agentscape.world-repository-entry'||item?.schemaVersion!==1||
      item?.id!==id||!['code-project','authoring-draft'].includes(item.kind)||
      !Number.isSafeInteger(item.version)||item.version<1||
      (version!==null&&item.version!==version)||
      (item.restoredFromVersion!==undefined&&
        (!Number.isSafeInteger(item.restoredFromVersion)||item.restoredFromVersion<1||
          item.restoredFromVersion>=item.version))||
      typeof item.name!=='string'||item.name.length>128||
      !Number.isSafeInteger(item.totalBytes)||item.totalBytes<=0||item.totalBytes>this.maxWorldBytes||
      !Array.isArray(item.blocks)||!item.blocks.length||item.blocks.length>Math.ceil(this.maxWorldBytes/WORLD_BLOCK_BYTES)||
      item.blocks.some(ref=>!Number.isSafeInteger(ref.bytes)||ref.bytes<=0||ref.bytes>WORLD_BLOCK_BYTES||
        !/^[a-f0-9]{64}$/.test(ref.hash))||
      item.blocks.reduce((sum,ref)=>sum+ref.bytes,0)!==item.totalBytes)
      throw fail('WORLD_REPOSITORY_POINTER_INVALID',500);
    checkHash(item.digest);
    return item;
  }
  async getPointer(id) {
    await this.initialize();
    return this.readPointer(this.pointerPath(this.validateId(id)),id);
  }
  /**
   * v1 records written before historical versioning stay valid: the current head
   * itself is v1. Only when publishing v2 do we archive v1, before replacing head.
   */
  async getVersionPointer(id,version,head=null) {
    head=head||await this.getPointer(id);
    if(!head)throw fail('WORLD_REPOSITORY_NOT_FOUND',404);
    if(!Number.isSafeInteger(version)||version<1)throw fail('WORLD_REPOSITORY_VERSION_INVALID');
    if(version>head.version)throw fail('WORLD_REPOSITORY_VERSION_NOT_FOUND',404);
    if(version===head.version)return head;
    // A validated ID prevents traversal; also reject substituted symlink history directories.
    await this.historyFolder(id);
    const pointer=await this.readPointer(this.historyPath(id,version),id,{
      version,missing:'WORLD_REPOSITORY_HISTORY_MISSING'
    });
    if(pointer.kind!==head.kind)throw fail('WORLD_REPOSITORY_HISTORY_INVALID',500);
    return pointer;
  }
  /** Persist directory entries after file fsync. A history link must be durable
   * before publishing its replacement HEAD, including across sudden power loss.
   */
  async syncDirectory(directory) {
    if(process.platform==='win32')return;
    const handle=await open(directory,'r');
    try{await handle.sync();}finally{await handle.close();}
  }
  /** Archive an old committed head exactly once; never overwrite a committed version.
   * Hard-linking a synced temporary file makes history records visible atomically.
   */
  async archivePointer(pointer) {
    const folder=await this.historyFolder(pointer.id);
    const destination=this.historyPath(pointer.id,pointer.version);
    const temporary=path.join(folder,'.pending-'+randomUUID());
    const handle=await open(temporary,'wx',0o600);
    try{
      await handle.writeFile(JSON.stringify(pointer));
      await handle.sync();
    }finally{await handle.close();}
    try{
      try{await link(temporary,destination);}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        const existing=await this.readPointer(destination,pointer.id,{version:pointer.version});
        if(JSON.stringify(existing)!==JSON.stringify(pointer))
          throw fail('WORLD_REPOSITORY_HISTORY_CONFLICT',409);
      }
    }finally{
      await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
    await this.syncDirectory(folder);
  }
  async replaceHead(pointer) {
    const temporary=path.join(this.recordsDirectory,'.pending-'+randomUUID());
    const handle=await open(temporary,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(pointer));await handle.sync();}
    finally{await handle.close();}
    try{
      await rename(temporary,this.pointerPath(pointer.id));
      await this.syncDirectory(this.recordsDirectory);
    }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  async withWorldLock(id,callback) {
    await this.initialize();
    const lockPath=path.join(this.recordsDirectory,this.validateId(id)+'.lock');
    let lock;
    try{lock=await open(lockPath,'wx',0o600);}
    catch(error){if(error.code==='EEXIST')throw fail('WORLD_REPOSITORY_BUSY',409);throw error;}
    try{return await callback();}
    finally{
      await lock.close();
      await unlink(lockPath).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  }
  async listVersions(id,{offset=0,limit=20}={}) {
    const head=await this.getPointer(this.validateId(id));
    if(!head)throw fail('WORLD_REPOSITORY_NOT_FOUND',404);
    if(!Number.isSafeInteger(offset)||offset<0||offset>1_000_000||
      !Number.isSafeInteger(limit)||limit<1||limit>50)throw fail('WORLD_REPOSITORY_QUERY_INVALID');
    const versions=[];
    for(let version=head.version-offset;version>=Math.max(1,head.version-offset-limit+1);version--){
      const pointer=version===head.version?head:await this.getVersionPointer(id,version,head);
      versions.push(this.metadata(pointer));
    }
    return {schema:'agentscape.world-repository-history',schemaVersion:1,id,
      kind:head.kind,headVersion:head.version,latestVersion:head.version,
      versions,total:head.version,
      nextOffset:offset+limit<head.version?offset+limit:null};
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
  async readContent(pointer) {
    const chunks=[];
    for(const ref of pointer.blocks)chunks.push(await this.storage.read(ref));
    const bytes=new Uint8Array(pointer.totalBytes);
    let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(hashBytes(bytes)!==pointer.digest)throw fail('WORLD_REPOSITORY_INTEGRITY_MISMATCH',500);
    let content;
    try{content=JSON.parse(decoder.decode(bytes));}
    catch{throw fail('WORLD_REPOSITORY_CONTENT_INVALID',500);}
    await this.validateContent(pointer.kind,pointer.id,content);
    return {...this.metadata(pointer),content};
  }
  async load(id,{version=null}={}) {
    const pointer=version===null?await this.getPointer(this.validateId(id)):
      await this.getVersionPointer(this.validateId(id),version);
    if(!pointer)throw fail('WORLD_REPOSITORY_NOT_FOUND',404);
    return this.readContent(pointer);
  }
  /** Public historical read. All blocks and the complete content digest are
   * checked again; historical JS is returned as data and never executed.
   */
  async loadVersion(id,version) {
    return this.readContent(await this.getVersionPointer(this.validateId(id),version));
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
    return this.withWorldLock(id,async()=>{
      const previous=await this.getPointer(id);
      if(previous ? (baseVersion!==previous.version||previous.kind!==kind) : baseVersion!==null)
        throw fail('WORLD_REPOSITORY_VERSION_CONFLICT',409);
      if(previous?.version===Number.MAX_SAFE_INTEGER)throw fail('WORLD_REPOSITORY_VERSION_LIMIT',413);
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
      // Archive the previous head first. The rename below is the ONLY commit point.
      // A crash after archiving but before rename leaves head unchanged, safely retryable.
      if(previous)await this.archivePointer(previous);
      await this.replaceHead(pointer);
      return this.metadata(pointer);
    });
  }
  /**
   * Rollback is a new immutable publication. Never delete history or rewrite
   * an old version. Content blocks are reused only after a full integrity check.
   */
  async rollback({id,targetVersion,baseVersion}={}) {
    this.validateId(id);
    if(!Number.isSafeInteger(targetVersion)||targetVersion<1)
      throw fail('WORLD_REPOSITORY_VERSION_INVALID');
    if(!Number.isSafeInteger(baseVersion)||baseVersion<1)
      throw fail('WORLD_REPOSITORY_BASE_VERSION_REQUIRED');
    return this.withWorldLock(id,async()=>{
      const head=await this.getPointer(id);
      if(!head)throw fail('WORLD_REPOSITORY_NOT_FOUND',404);
      if(baseVersion!==head.version)throw fail('WORLD_REPOSITORY_VERSION_CONFLICT',409);
      if(targetVersion>=head.version)
        throw fail(targetVersion===head.version?'WORLD_REPOSITORY_ALREADY_CURRENT':'WORLD_REPOSITORY_VERSION_NOT_FOUND',
          targetVersion===head.version?400:404);
      if(head.version===Number.MAX_SAFE_INTEGER)throw fail('WORLD_REPOSITORY_VERSION_LIMIT',413);
      const historic=await this.load(id,{version:targetVersion}); // Verifies blocks, SHA-256, kind and schema.
      const source=await this.getVersionPointer(id,targetVersion);
      if(source.kind!==head.kind)throw fail('WORLD_REPOSITORY_HISTORY_INVALID',500);
      const pointer={
        ...head,
        name:source.name,
        version:head.version+1,
        updatedAt:this.now(),
        digest:source.digest,
        totalBytes:source.totalBytes,
        blocks:source.blocks,
        restoredFromVersion:targetVersion
      };
      if(historic.id!==id)throw fail('WORLD_REPOSITORY_ID_MISMATCH');
      await this.archivePointer(head);
      await this.replaceHead(pointer);
      return this.metadata(pointer);
    });
  }
}
