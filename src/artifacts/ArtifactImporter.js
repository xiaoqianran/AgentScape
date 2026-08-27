import { ArtifactContractError, requireSafeArtifactId } from './ArtifactDescriptor.js';
import { artifactContentNeedsFullBytes, validateArtifactContent } from './ArtifactContentGate.js';
import { IncrementalSha256 } from './IncrementalSha256.js';

let fallbackId=0;
const defaultIdFactory=(kind)=>{
  const uuid=globalThis.crypto?.randomUUID?.();
  return `${kind}_${uuid ? uuid.replaceAll('-','') : `${Date.now()}_${++fallbackId}`}`;
};
const nowIso=(now)=>new Date(now()).toISOString();
const header=(response,name)=>response?.headers?.get?.(name) ?? response?.headers?.get?.(name.toLowerCase()) ?? null;
const normalizeContentType=(value)=>String(value||'').split(';',1)[0].trim().toLowerCase();
const concat=(chunks,total)=>{
  const out=new Uint8Array(total);
  let offset=0;
  for (const chunk of chunks) { out.set(chunk,offset); offset+=chunk.byteLength; }
  return out;
};
const asChunk=(value)=>{
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  throw new ArtifactContractError('ARTIFACT_STREAM_INVALID','Artifact response stream yielded a non-byte chunk');
};

function contentLength(response) {
  const raw=header(response,'content-length');
  if (raw==null||raw==='') return null;
  if (!/^\d+$/.test(String(raw).trim())) throw new ArtifactContractError('ARTIFACT_LENGTH_INVALID','Artifact Content-Length is invalid');
  const n=Number(raw);
  if (!Number.isSafeInteger(n)||n<0) throw new ArtifactContractError('ARTIFACT_LENGTH_INVALID','Artifact Content-Length is outside safe integer range');
  return n;
}

export class ArtifactImporter {
  constructor({
    registry,
    connectorArtifactClient,
    byteStore,
    maxBytes=256*1024*1024,
    maxStructuredBytes=16*1024*1024,
    maxJsonDepth=64,
    maxJsonNodes=100000,
    maxChunks=65536,
    now=()=>Date.now(),
    idFactory=defaultIdFactory
  }={}) {
    if (!registry?.get||!registry?.verifyIntegrity||!registry?.acquireLease) throw new ArtifactContractError('ARTIFACT_IMPORTER_INVALID','ArtifactImporter requires ArtifactRegistry');
    if (!connectorArtifactClient?.open) throw new ArtifactContractError('ARTIFACT_IMPORTER_INVALID','ArtifactImporter requires ConnectorArtifactClient');
    const limit=Number(maxBytes);
    if (!Number.isSafeInteger(limit)||limit<0) throw new ArtifactContractError('ARTIFACT_BYTES_LIMIT','ArtifactImporter maxBytes must be a non-negative safe integer');
    const structuredLimit=Number(maxStructuredBytes);
    if (!Number.isSafeInteger(structuredLimit)||structuredLimit<0) throw new ArtifactContractError('ARTIFACT_STRUCTURE_LIMIT','ArtifactImporter maxStructuredBytes must be a non-negative safe integer');
    this.registry=registry;
    this.connectorArtifactClient=connectorArtifactClient;
    this.byteStore=byteStore;
    const jsonDepth=Number(maxJsonDepth),jsonNodes=Number(maxJsonNodes),chunkLimit=Number(maxChunks);
    if (!Number.isSafeInteger(jsonDepth)||jsonDepth<1) throw new ArtifactContractError('ARTIFACT_STRUCTURE_LIMIT','ArtifactImporter maxJsonDepth must be a positive safe integer');
    if (!Number.isSafeInteger(jsonNodes)||jsonNodes<1) throw new ArtifactContractError('ARTIFACT_STRUCTURE_LIMIT','ArtifactImporter maxJsonNodes must be a positive safe integer');
    if (!Number.isSafeInteger(chunkLimit)||chunkLimit<1) throw new ArtifactContractError('ARTIFACT_STREAM_LIMIT','ArtifactImporter maxChunks must be a positive safe integer');
    if (!byteStore?.begin||!byteStore?.remove) throw new ArtifactContractError('ARTIFACT_IMPORTER_INVALID','ArtifactImporter byteStore requires begin/remove transaction APIs');
    this.maxBytes=limit;
    this.maxStructuredBytes=Math.min(structuredLimit,limit);
    this.maxJsonDepth=jsonDepth;
    this.maxJsonNodes=jsonNodes;
    this.maxChunks=chunkLimit;
    this.now=now;
    this.idFactory=idFactory;
  }

  async import(artifactId) {
    const id=requireSafeArtifactId(artifactId);
    const descriptor=this.registry.get(id);
    if (!descriptor) throw new ArtifactContractError('ARTIFACT_NOT_FOUND','Artifact does not exist',{id});
    const source=descriptor.locations.find((location)=>
      location.kind==='connector' && location.state==='available' &&
      location.access?.kind==='connector-artifact' && location.access.artifactId===id
    );
    if (!source) throw new ArtifactContractError('ARTIFACT_SOURCE_UNAVAILABLE','Artifact has no available Connector source',{id});
    if (descriptor.bytes>this.maxBytes) throw new ArtifactContractError('ARTIFACT_BYTES_LIMIT','Artifact declared bytes exceed importer maxBytes',{bytes:descriptor.bytes,maxBytes:this.maxBytes});
    if (artifactContentNeedsFullBytes(descriptor.mime) && descriptor.bytes>this.maxStructuredBytes) {
      throw new ArtifactContractError('ARTIFACT_STRUCTURE_LIMIT','Artifact requiring bounded full-byte validation exceeds maxStructuredBytes',{
        bytes:descriptor.bytes,maxStructuredBytes:this.maxStructuredBytes,mime:descriptor.mime
      });
    }

    const leaseId=requireSafeArtifactId(this.idFactory('lease',descriptor),'leaseId');
    const cacheKey=requireSafeArtifactId(this.idFactory('cache',descriptor),'cacheKey');
    const locationId=requireSafeArtifactId(this.idFactory('loc',descriptor),'locationId');
    let writer=null;
    let reader=null;
    let committed=null;
    let locationAdded=false;
    let leaseHeld=false;
    try {
      this.registry.acquireLease(id,{
        id:leaseId,holder:{kind:'transfer',id:leaseId},reason:'artifact-import',createdAt:nowIso(this.now)
      });
      leaseHeld=true;
      const response=await this.connectorArtifactClient.open(id,{accept:descriptor.mime,expectedConnector:source.access.connector});
      const encoding=String(header(response,'content-encoding')||'').trim().toLowerCase();
      if (encoding && encoding!=='identity') throw new ArtifactContractError('ARTIFACT_CONTENT_ENCODING_UNSUPPORTED','Artifact transfer must not use transparent content encoding',{encoding});
      const responseType=normalizeContentType(header(response,'content-type'));
      if (responseType && responseType!==descriptor.mime) {
        throw new ArtifactContractError('ARTIFACT_CONTENT_TYPE_MISMATCH','Artifact Content-Type does not match descriptor MIME',{expected:descriptor.mime,actual:responseType});
      }
      const declaredLength=contentLength(response);
      if (declaredLength!=null) {
        if (declaredLength>this.maxBytes) throw new ArtifactContractError('ARTIFACT_BYTES_LIMIT','Artifact Content-Length exceeds importer maxBytes',{bytes:declaredLength,maxBytes:this.maxBytes});
        if (declaredLength!==descriptor.bytes) throw new ArtifactContractError('ARTIFACT_LENGTH_MISMATCH','Artifact Content-Length does not match descriptor bytes',{expected:descriptor.bytes,actual:declaredLength});
      }
      if (!response.body?.getReader) throw new ArtifactContractError('ARTIFACT_STREAM_UNAVAILABLE','Artifact response must provide a readable byte stream');

      writer=this.byteStore.begin({artifactId:id,maxBytes:this.maxBytes});
      reader=response.body.getReader();
      const hasher=new IncrementalSha256();
      const prefix=new Uint8Array(Math.min(64,descriptor.bytes));
      let prefixLength=0;
      const fullChunks=artifactContentNeedsFullBytes(descriptor.mime)?[]:null;
      let total=0;
      let chunkCount=0;
      try {
        while (true) {
          const {done,value}=await reader.read();
          if (done) break;
          chunkCount++;
          if (chunkCount>this.maxChunks) throw new ArtifactContractError('ARTIFACT_STREAM_LIMIT','Artifact stream exceeded maxChunks',{maxChunks:this.maxChunks});
          const chunk=asChunk(value);
          total+=chunk.byteLength;
          if (total>this.maxBytes) throw new ArtifactContractError('ARTIFACT_BYTES_LIMIT','Artifact stream exceeded importer maxBytes',{maxBytes:this.maxBytes});
          if (total>descriptor.bytes) throw new ArtifactContractError('ARTIFACT_LENGTH_MISMATCH','Artifact stream exceeded descriptor bytes',{expected:descriptor.bytes,actualAtLeast:total});
          if (prefixLength<prefix.byteLength) {
            const take=Math.min(prefix.byteLength-prefixLength,chunk.byteLength);
            prefix.set(chunk.subarray(0,take),prefixLength);
            prefixLength+=take;
          }
          if (fullChunks) fullChunks.push(new Uint8Array(chunk));
          hasher.update(chunk);
          await writer.write(chunk);
        }
      } catch (error) {
        try { await reader.cancel?.(); } catch {}
        if (error instanceof ArtifactContractError) throw error;
        throw new ArtifactContractError('ARTIFACT_STREAM_FAILED','Artifact stream failed before integrity verification',{recoverable:true});
      } finally {
        try { reader.releaseLock?.(); } catch {}
      }

      if (total!==descriptor.bytes) throw new ArtifactContractError('ARTIFACT_LENGTH_MISMATCH','Artifact stream length does not match descriptor bytes',{expected:descriptor.bytes,actual:total});
      const actualHash=hasher.digestArtifactHash();
      if (actualHash!==descriptor.hash) throw new ArtifactContractError('ARTIFACT_HASH_MISMATCH','Artifact SHA-256 does not match descriptor',{expected:descriptor.hash,actual:actualHash});
      const fullBytes=fullChunks?concat(fullChunks,total):null;
      validateArtifactContent(descriptor,{
        prefix:prefix.subarray(0,prefixLength),totalBytes:total,fullBytes,
        maxJsonDepth:this.maxJsonDepth,maxJsonNodes:this.maxJsonNodes
      });

      committed=await writer.commit({key:cacheKey,hash:actualHash,mime:descriptor.mime,bytes:total});
      const verifiedAt=nowIso(this.now);
      this.registry.updateLocation(id,{
        id:locationId,kind:'local-cache',scope:'application',state:'available',
        verifiedAt,access:{kind:'cache-key',key:committed.key}
      });
      locationAdded=true;
      const artifact=this.registry.verifyIntegrity(id,{
        hash:actualHash,bytes:total,mime:descriptor.mime,verifiedAt,method:'stream-sha256-v1'
      });
      return {artifact,cache:{key:committed.key,locationId},hash:actualHash,bytes:total,mime:descriptor.mime};
    } catch (error) {
      if (writer?.state==='open') await writer.abort();
      if (leaseHeld) { this.registry.releaseLease(leaseId); leaseHeld=false; }
      if (locationAdded) {
        try {
          const removed=this.registry.removeLocation(id,locationId);
          if (removed.removed && committed) this.byteStore.remove(committed.key);
        } catch {}
      } else if (committed) {
        this.byteStore.remove(committed.key);
      }
      throw error;
    } finally {
      if (leaseHeld) this.registry.releaseLease(leaseId);
    }
  }
}
