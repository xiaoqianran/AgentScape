import { ArtifactContractError, normalizeArtifactHash, requireSafeArtifactId } from './ArtifactDescriptor.js';

const COMMIT_TOKEN=Symbol('artifact-byte-store-commit');

const cloneEntry=(entry)=>entry?{
  key:entry.key,artifactId:entry.artifactId,hash:entry.hash,mime:entry.mime,bytes:entry.bytes,
  data:new Uint8Array(entry.data)
}:null;

class MemoryArtifactByteWriter {
  #store;
  #artifactId;
  #maxBytes;
  #chunks=[];
  #bytes=0;
  #state='open';

  constructor(store,{artifactId,maxBytes}) {
    this.#store=store;
    this.#artifactId=requireSafeArtifactId(artifactId);
    this.#maxBytes=maxBytes;
  }

  get state() { return this.#state; }
  get bytesWritten() { return this.#bytes; }

  async write(chunk) {
    if (this.#state!=='open') throw new ArtifactContractError('ARTIFACT_BYTE_STORE_STATE','Artifact byte writer is not open');
    if (!(chunk instanceof Uint8Array)) throw new ArtifactContractError('ARTIFACT_BYTE_STORE_INVALID','Artifact byte writer requires Uint8Array chunks');
    if (this.#bytes+chunk.byteLength>this.#maxBytes) throw new ArtifactContractError('ARTIFACT_BYTES_LIMIT','Artifact temporary byte store exceeded maxBytes');
    this.#chunks.push(new Uint8Array(chunk));
    this.#bytes+=chunk.byteLength;
  }

  async commit({key,hash,mime,bytes}) {
    if (this.#state!=='open') throw new ArtifactContractError('ARTIFACT_BYTE_STORE_STATE','Artifact byte writer is not open');
    const cacheKey=requireSafeArtifactId(key,'cacheKey');
    const canonicalHash=normalizeArtifactHash(hash);
    const expected=Number(bytes);
    if (!Number.isSafeInteger(expected)||expected<0||expected!==this.#bytes) throw new ArtifactContractError('ARTIFACT_BYTE_STORE_INVALID','Artifact byte store commit length mismatch');
    const data=new Uint8Array(this.#bytes);
    let offset=0;
    for (const chunk of this.#chunks) { data.set(chunk,offset); offset+=chunk.byteLength; }
    const result=this.#store._commit(COMMIT_TOKEN,{
      key:cacheKey,artifactId:this.#artifactId,hash:canonicalHash,mime:String(mime||'').toLowerCase(),bytes:expected,data
    });
    this.#chunks=[];
    this.#state='committed';
    return result;
  }

  async abort() {
    if (this.#state==='open') {
      this.#chunks=[];
      this.#bytes=0;
      this.#state='aborted';
    }
  }
}

export class MemoryArtifactByteStore {
  #entries=new Map();
  #hashIndex=new Map();

  begin({artifactId,maxBytes}) {
    const limit=Number(maxBytes);
    if (!Number.isSafeInteger(limit)||limit<0) throw new ArtifactContractError('ARTIFACT_BYTES_LIMIT','Artifact byte store maxBytes must be a non-negative safe integer');
    return new MemoryArtifactByteWriter(this,{artifactId,maxBytes:limit});
  }

  _commit(token,entry) {
    if (token!==COMMIT_TOKEN) throw new ArtifactContractError('ARTIFACT_BYTE_STORE_STATE','Artifact byte store commit is writer-managed only');
    const previous=this.#entries.get(entry.key);
    if (previous) {
      if (previous.hash!==entry.hash || previous.bytes!==entry.bytes || previous.mime!==entry.mime || previous.artifactId!==entry.artifactId) {
        throw new ArtifactContractError('ARTIFACT_CACHE_KEY_CONFLICT','Artifact cache key already contains different content',{key:entry.key});
      }
      return {key:entry.key,hash:entry.hash,mime:entry.mime,bytes:entry.bytes};
    }
    this.#entries.set(entry.key,entry);
    if (!this.#hashIndex.has(entry.hash)) this.#hashIndex.set(entry.hash,new Set());
    this.#hashIndex.get(entry.hash).add(entry.key);
    return {key:entry.key,hash:entry.hash,mime:entry.mime,bytes:entry.bytes};
  }

  get(key) { return cloneEntry(this.#entries.get(key)); }

  remove(key) {
    const entry=this.#entries.get(key);
    if (!entry) return false;
    this.#entries.delete(key);
    const keys=this.#hashIndex.get(entry.hash);
    keys?.delete(key);
    if (keys && !keys.size) this.#hashIndex.delete(entry.hash);
    return true;
  }

  findByHash(hash) {
    const canonical=normalizeArtifactHash(hash);
    return [...(this.#hashIndex.get(canonical)||[])].sort();
  }
}
