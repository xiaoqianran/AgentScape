import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactImporter } from '../src/artifacts/ArtifactImporter.js';
import { ArtifactRegistry } from '../src/artifacts/ArtifactRegistry.js';
import { MemoryArtifactByteStore } from '../src/artifacts/MemoryArtifactByteStore.js';

const NOW=Date.parse('2026-08-24T09:00:00.000Z');
const sha=(bytes)=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const glb=({version=2,headerLength=24,magic=true,firstChunkType=0x4e4f534a,firstChunkLength=4,totalLength=24}={})=>{
  const bytes=new Uint8Array(totalLength);
  bytes.set(magic?[0x67,0x6c,0x54,0x46]:[0,0,0,0]);
  const view=new DataView(bytes.buffer);
  view.setUint32(4,version,true);
  view.setUint32(8,headerLength,true);
  if (totalLength>=20) {
    view.setUint32(12,firstChunkLength,true);
    view.setUint32(16,firstChunkType,true);
  }
  if (totalLength>=24) bytes.set(new TextEncoder().encode('{}  '),20);
  return bytes;
};

const descriptor=(bytes,overrides={})=>({
  id:'artifact_01',role:'primary-glb',type:'asset-bundle',
  schema:{id:'agentscape.artifact',version:'1'},displayName:'Generated Artifact',
  mime:'model/gltf-binary',format:'glb',bytes:bytes.byteLength,hash:sha(bytes),
  producer:{jobId:'job_01',provider:'modal-3d',operation:'modal-3d.asset.image_to_3d.v1',stage:'reconstructing',attempt:1},
  lineage:{parents:[{artifactId:'artifact_input',hash:`sha256:${'b'.repeat(64)}`,relation:'input'}]},
  createdAt:'2026-08-24T08:00:00.000Z',retention:{class:'project'},
  locations:[{
    id:'loc_connector',kind:'connector',scope:'job',state:'available',
    access:{kind:'connector-artifact',artifactId:'artifact_01',connector:{id:'unified-connector',instance:'instance_01'}}
  }],
  ...overrides
});

const streamBody=(chunks)=>new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  }
});
const response=(chunks,{headers={},status=200,redirected=false}={})=>({
  ok:status>=200&&status<300,status,redirected,
  headers:new Headers(headers),
  body:streamBody(chunks)
});
const split=(bytes,...sizes)=>{
  const chunks=[]; let offset=0;
  for (const size of sizes) {
    if (offset>=bytes.length) break;
    const end=Math.min(bytes.length,offset+size);
    chunks.push(bytes.subarray(offset,end)); offset=end;
  }
  if (offset<bytes.length) chunks.push(bytes.subarray(offset));
  return chunks;
};

function setup(bytes,{descriptorPatch={},open,maxBytes=1024,idFactory}={}) {
  const registry=new ArtifactRegistry({now:()=>NOW});
  registry.register(descriptor(bytes,descriptorPatch));
  const byteStore=new MemoryArtifactByteStore();
  const connectorArtifactClient={open:open || vi.fn(async()=>response(split(bytes,3,4),{
    headers:{'content-length':String(bytes.byteLength),'content-type':descriptorPatch.mime||'model/gltf-binary'}
  }))};
  const ids={lease:'lease_import',cache:'cache_import',loc:'loc_import'};
  const importer=new ArtifactImporter({
    registry,connectorArtifactClient,byteStore,maxBytes,now:()=>NOW,
    idFactory:idFactory || ((kind)=>ids[kind])
  });
  return {registry,byteStore,connectorArtifactClient,importer};
}

function expectCleanFailure(state) {
  expect(state.registry.get('artifact_01').integrity.state).toBe('declared');
  expect(state.registry.get('artifact_01').lineage.parents).toHaveLength(1);
  expect(state.registry.get('artifact_01').locations.map((item)=>item.id)).toEqual(['loc_connector']);
  expect(state.registry.leasesFor('artifact_01')).toEqual([]);
  expect(state.byteStore.get('cache_import')).toBeNull();
}

describe('ArtifactImporter success path',()=>{
  it('streams a valid GLB, verifies hash/length/MIME, commits cache, and releases transfer lease',async()=>{
    const bytes=glb();
    const state=setup(bytes);
    const result=await state.importer.import('artifact_01');
    expect(result).toMatchObject({
      hash:sha(bytes),bytes:24,mime:'model/gltf-binary',
      cache:{key:'cache_import',locationId:'loc_import'},
      artifact:{integrity:{state:'verified',method:'stream-sha256-v1'}}
    });
    expect([...state.byteStore.get('cache_import').data]).toEqual([...bytes]);
    expect(state.registry.get('artifact_01').locations.map((item)=>item.id).sort())
      .toEqual(['loc_connector','loc_import']);
    expect(state.registry.leasesFor('artifact_01')).toEqual([]);
    expect(result.artifact).not.toHaveProperty('assetReady');
  });

  it('accepts a bounded JSON stream without Content-Length when bytes/hash/structure match',async()=>{
    const bytes=new TextEncoder().encode('{"parts":[]}');
    const state=setup(bytes,{
      descriptorPatch:{role:'manifest-json',type:'metadata',mime:'application/json',format:'json'},
      open:vi.fn(async()=>response(split(bytes,1,2,3),{headers:{'content-type':'application/json; charset=utf-8'}}))
    });
    const result=await state.importer.import('artifact_01');
    expect(result.artifact.integrity.state).toBe('verified');
    expect(result.bytes).toBe(bytes.length);
  });
  it('rejects full-byte structured artifacts above maxStructuredBytes before Connector fetch',async()=>{
    const bytes=new TextEncoder().encode('{"parts":[]}');
    const open=vi.fn();
    const state=setup(bytes,{
      descriptorPatch:{role:'manifest-json',type:'metadata',mime:'application/json',format:'json'},open
    });
    const importer=new ArtifactImporter({
      registry:state.registry,connectorArtifactClient:state.connectorArtifactClient,byteStore:state.byteStore,
      maxBytes:1024,maxStructuredBytes:4,now:()=>NOW,
      idFactory:(kind)=>({lease:'lease_import',cache:'cache_import',loc:'loc_import'})[kind]
    });
    await expect(importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_STRUCTURE_LIMIT'});
    expect(open).not.toHaveBeenCalled();
    expectCleanFailure(state);
  });
});

describe('ArtifactImporter length/budget gates',()=>{
  it('aborts an excessive micro-chunk stream even when byte total remains small',async()=>{
    const bytes=glb();
    const chunks=[...bytes].map((value)=>new Uint8Array([value]));
    const state=setup(bytes,{
      open:vi.fn(async()=>response(chunks,{headers:{'content-type':'model/gltf-binary'}}))
    });
    const importer=new ArtifactImporter({
      registry:state.registry,connectorArtifactClient:state.connectorArtifactClient,byteStore:state.byteStore,
      maxBytes:1024,maxChunks:8,now:()=>NOW,
      idFactory:(kind)=>({lease:'lease_import',cache:'cache_import',loc:'loc_import'})[kind]
    });
    await expect(importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_STREAM_LIMIT'});
    expectCleanFailure(state);
  });

  it('rejects a declared artifact over maxBytes before any Connector request',async()=>{
    const bytes=glb({totalLength:32,headerLength:32});
    const open=vi.fn();
    const state=setup(bytes,{maxBytes:24,open});
    await expect(state.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_BYTES_LIMIT'});
    expect(open).not.toHaveBeenCalled();
    expectCleanFailure(state);
  });

  it('rejects oversized/mismatched Content-Length before reading the body',async()=>{
    const bytes=glb();
    const state=setup(bytes,{
      maxBytes:24,
      open:vi.fn(async()=>response([bytes],{headers:{'content-length':'25','content-type':'model/gltf-binary'}}))
    });
    await expect(state.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_BYTES_LIMIT'});
    expectCleanFailure(state);

    const mismatch=setup(bytes,{
      open:vi.fn(async()=>response([bytes],{headers:{'content-length':'23','content-type':'model/gltf-binary'}}))
    });
    await expect(mismatch.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_LENGTH_MISMATCH'});
    expectCleanFailure(mismatch);
  });

  it('aborts when streamed bytes exceed descriptor/max budget',async()=>{
    const expected=glb();
    const actual=new Uint8Array(25); actual.set(expected);
    const state=setup(expected,{
      maxBytes:24,
      open:vi.fn(async()=>response([actual],{headers:{'content-type':'model/gltf-binary'}}))
    });
    await expect(state.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_BYTES_LIMIT'});
    expectCleanFailure(state);
  });

  it('rejects a truncated stream and leaves descriptor/lineage declared',async()=>{
    const bytes=glb();
    const state=setup(bytes,{
      open:vi.fn(async()=>response([bytes.subarray(0,8)],{headers:{'content-type':'model/gltf-binary'}}))
    });
    await expect(state.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_LENGTH_MISMATCH'});
    expectCleanFailure(state);
  });
});

describe('ArtifactImporter integrity/structure gates',()=>{
  it('rejects SHA-256 mismatch without publishing cache bytes',async()=>{
    const bytes=glb();
    const state=setup(bytes,{descriptorPatch:{hash:`sha256:${'c'.repeat(64)}`}});
    await expect(state.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_HASH_MISMATCH'});
    expectCleanFailure(state);
  });

  it('rejects Content-Type and transparent Content-Encoding mismatch',async()=>{
    const bytes=glb();
    const typeMismatch=setup(bytes,{
      open:vi.fn(async()=>response([bytes],{headers:{'content-length':'24','content-type':'application/json'}}))
    });
    await expect(typeMismatch.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_CONTENT_TYPE_MISMATCH'});
    expectCleanFailure(typeMismatch);

    const encoded=setup(bytes,{
      open:vi.fn(async()=>response([bytes],{headers:{'content-type':'model/gltf-binary','content-encoding':'gzip'}}))
    });
    await expect(encoded.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_CONTENT_ENCODING_UNSUPPORTED'});
    expectCleanFailure(encoded);
  });

  it('rejects corrupt GLB magic/version/header-length and malformed JSON',async()=>{
    for (const bad of [
      glb({magic:false}),
      glb({version:1}),
      glb({headerLength:28})
    ]) {
      const expectedDescriptor=glb();
      const state=setup(bad,{
        descriptorPatch:{bytes:bad.length,hash:sha(bad)},
        open:vi.fn(async()=>response([bad],{headers:{'content-type':'model/gltf-binary'}}))
      });
      await expect(state.importer.import('artifact_01')).rejects.toMatchObject({code:expect.stringMatching(/^ARTIFACT_(MIME|STRUCTURE)_/)});
      expectCleanFailure(state);
      expect(expectedDescriptor.length).toBe(24);
    }

    const badJson=new TextEncoder().encode('{broken');
    const json=setup(badJson,{
      descriptorPatch:{role:'manifest-json',type:'metadata',mime:'application/json',format:'json'},
      open:vi.fn(async()=>response([badJson],{headers:{'content-type':'application/json'}}))
    });
    await expect(json.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_STRUCTURE_INVALID'});
    expectCleanFailure(json);
  });

  it('fails closed on archive artifacts instead of partially extracting them',async()=>{
    const bytes=new Uint8Array([0x50,0x4b,0x03,0x04]);
    const state=setup(bytes,{
      descriptorPatch:{role:'bundle-zip',type:'archive',mime:'application/zip',format:'zip'},
      open:vi.fn(async()=>response([bytes],{headers:{'content-type':'application/zip'}}))
    });
    await expect(state.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_ARCHIVE_UNSUPPORTED'});
    expectCleanFailure(state);
  });
});

describe('ArtifactImporter transactional cleanup',()=>{
  it('maps reader failure to a recoverable stream error and always releases lease/temp bytes',async()=>{
    const bytes=glb();
    const body={getReader:()=>({
      calls:0,
      async read() {
        this.calls++;
        if (this.calls===1) return {done:false,value:bytes.subarray(0,4)};
        throw new Error('socket contained internal endpoint');
      },
      async cancel(){},releaseLock(){}
    })};
    const state=setup(bytes,{open:vi.fn(async()=>({ok:true,status:200,redirected:false,headers:new Headers({'content-type':'model/gltf-binary'}),body}))});
    await expect(state.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_STREAM_FAILED',details:{recoverable:true}});
    expectCleanFailure(state);
  });

  it('removes committed cache/location if registry finalization fails after commit',async()=>{
    const bytes=glb();
    const state=setup(bytes);
    state.registry.verifyIntegrity=()=>{ throw new Error('synthetic finalize failure'); };
    await expect(state.importer.import('artifact_01')).rejects.toThrow('synthetic finalize failure');
    expectCleanFailure(state);
  });

  it('refuses import without an available Connector source location',async()=>{
    const bytes=glb();
    const state=setup(bytes);
    state.registry.updateLocation('artifact_01',{
      id:'loc_connector',kind:'connector',scope:'job',state:'expired',access:null
    });
    await expect(state.importer.import('artifact_01')).rejects.toMatchObject({code:'ARTIFACT_SOURCE_UNAVAILABLE'});
    expect(state.connectorArtifactClient.open).not.toHaveBeenCalled();
  });
});
