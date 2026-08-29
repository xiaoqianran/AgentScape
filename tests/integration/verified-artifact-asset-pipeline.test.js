import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactRegistry } from '../../generation/artifacts/ArtifactRegistry.js';
import { MemoryArtifactByteStore } from '../../generation/artifacts/MemoryArtifactByteStore.js';
import { AssetCompiler } from '../../asset/compiler/AssetCompiler.js';
import { AssetManager } from '../../asset/AssetManager.js';
import { VerifiedArtifactAssetPipeline } from '../../generation/orchestration/publishAsset.js';

const NOW=Date.parse('2026-08-24T10:00:00.000Z');
const sha=(bytes)=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const parentHash=`sha256:${'b'.repeat(64)}`;

class CompilerStore {
  constructor(){ this.map=new Map(); }
  async put(key,bytes,metadata){ this.map.set(key,{bytes:new Uint8Array(bytes),metadata}); return key; }
  async get(key){ return this.map.get(key)||null; }
}

async function fixture({verified=true,withCache=true,byteStoreOverride=null}={}) {
  const bytes=new Uint8Array(await readFile('public/assets/cabinet.glb'));
  const registry=new ArtifactRegistry({now:()=>NOW});
  registry.register({
    id:'artifact_modal3d_01',role:'primary-glb',type:'asset-bundle',
    schema:{id:'agentscape.artifact',version:'1'},displayName:'Modal 3D Cabinet',
    mime:'model/gltf-binary',format:'glb',bytes:bytes.byteLength,hash:sha(bytes),
    producer:{
      jobId:'job_modal3d_01',provider:'modal-3d',operation:'modal-3d.asset.image_to_3d.v1',
      stage:'generation',attempt:1,revision:'provider-r1',
      model:{id:'model-3d',version:'1',revision:'model-r1'},
      workflow:{id:'image-to-3d',version:'1',revision:'workflow-r1'}
    },
    lineage:{parents:[{artifactId:'artifact_image_01',hash:parentHash,relation:'input'}]},
    createdAt:'2026-08-24T09:00:00.000Z',retention:{class:'project'},
    locations:[]
  });
  const byteStore=byteStoreOverride || new MemoryArtifactByteStore();
  if (withCache) {
    const writer=byteStore.begin({artifactId:'artifact_modal3d_01',maxBytes:bytes.byteLength});
    await writer.write(bytes);
    await writer.commit({key:'cache_modal3d_01',hash:sha(bytes),mime:'model/gltf-binary',bytes:bytes.byteLength});
    registry.updateLocation('artifact_modal3d_01',{
      id:'loc_cache_modal3d_01',kind:'local-cache',scope:'application',state:'available',
      verifiedAt:'2026-08-24T09:30:00.000Z',access:{kind:'cache-key',key:'cache_modal3d_01'}
    });
  }
  if (verified) {
    registry.verifyIntegrity('artifact_modal3d_01',{
      hash:sha(bytes),bytes:bytes.byteLength,mime:'model/gltf-binary',
      verifiedAt:'2026-08-24T09:30:00.000Z',method:'stream-sha256-v1'
    });
  }
  return {bytes,registry,byteStore};
}

const readyManifest=(id='asset_ready')=>({
  id,type:'object',label:'Ready Asset',source:{kind:'compiled',key:id},actions:['move'],
  physics:{body:'fixed',mass:1,friction:0.5,colliders:[{shape:'box',halfExtents:[0.5,0.5,0.5]}]},
  compiler:{quality:{status:'ready'}},
  provenance:{compiler:'AgentScape'}
});

describe('VerifiedArtifactAssetPipeline vertical path',()=>{
  it('compiles a real verified modal-3D GLB through existing Compiler/Admission and registers provisional truth',async()=>{
    const state=await fixture();
    const compilerStore=new CompilerStore();
    const compiler=new AssetCompiler({store:compilerStore,version:'as05-test'});
    const assets=new AssetManager({manifests:{},compiledStore:compilerStore});
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,assetCompiler:compiler,assetManager:assets,
      now:()=>NOW,idFactory:()=> 'lease_compile_01'
    });
    const result=await pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_modal3d_cabinet'});

    expect(result).toMatchObject({
      status:'asset-provisional',stage:'registered',registered:true,
      artifactId:'artifact_modal3d_01',assetId:'asset_modal3d_cabinet',
      admission:{status:'provisional'}
    });
    expect(result.admission.reasons).toContain('COLLIDER_COARSE');
    expect(result.admission.layers.compiler.status).toBe('provisional');
    expect(result.manifest).toMatchObject({
      id:'asset_modal3d_cabinet',source:{kind:'compiled',key:'asset_modal3d_cabinet'},actions:['move'],
      compiler:{quality:{status:'provisional'}},
      provenance:{
        assetProduction:{
          sourceArtifact:{
            id:'artifact_modal3d_01',hash:sha(state.bytes),
            producer:{jobId:'job_modal3d_01',provider:'modal-3d',operation:'modal-3d.asset.image_to_3d.v1'}
          },
          assetId:'asset_modal3d_cabinet'
        }
      }
    });
    expect(assets.has('asset_modal3d_cabinet')).toBe(true);
    expect(await compilerStore.get('asset_modal3d_cabinet')).not.toBeNull();
    expect(state.registry.get('artifact_modal3d_01').integrity.state).toBe('verified');
    expect(state.registry.leasesFor('artifact_modal3d_01')).toEqual([]);
  });

  it('holds an Artifact lease during compile and releases it afterward',async()=>{
    const state=await fixture();
    const assets=new AssetManager({manifests:{}});
    const compile=vi.fn(async({assetId})=>{
      expect(state.registry.isLeased('artifact_modal3d_01')).toBe(true);
      return {manifest:readyManifest(assetId),quality:{status:'ready',hard:[],advisory:[]}};
    });
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,assetCompiler:{compile},assetManager:assets,
      now:()=>NOW,idFactory:()=> 'lease_compile_01'
    });
    const result=await pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_ready'});
    expect(result.status).toBe('asset-ready');
    expect(state.registry.isLeased('artifact_modal3d_01')).toBe(false);
  });

  it('reuses an already-registered asset only when source Artifact identity/hash match',async()=>{
    const state=await fixture();
    const assets=new AssetManager({manifests:{}});
    const manifest=readyManifest('asset_reuse');
    manifest.provenance={
      compiler:'AgentScape',
      admission:{status:'ready',reasons:[]},
      assetProduction:{
        sourceArtifact:{id:'artifact_modal3d_01',hash:sha(state.bytes)},
        assetId:'asset_reuse'
      }
    };
    assets.registerManifest(manifest);
    const compile=vi.fn();
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,assetCompiler:{compile},assetManager:assets
    });
    const result=await pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_reuse'});
    expect(result).toMatchObject({status:'asset-ready',stage:'registered',registered:false,reused:true});
    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects an existing assetId whose registered provenance belongs to another Artifact',async()=>{
    const state=await fixture();
    const assets=new AssetManager({manifests:{}});
    const manifest=readyManifest('asset_taken');
    manifest.provenance={
      compiler:'AgentScape',
      admission:{status:'ready',reasons:[]},
      assetProduction:{sourceArtifact:{id:'artifact_other',hash:`sha256:${'c'.repeat(64)}`},assetId:'asset_taken'}
    };
    assets.registerManifest(manifest);
    const compile=vi.fn();
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,assetCompiler:{compile},assetManager:assets
    });
    await expect(pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_taken'}))
      .rejects.toMatchObject({code:'ASSET_ID_CONFLICT'});
    expect(compile).not.toHaveBeenCalled();
  });

  it('does not need or invoke Connector transport once verified local bytes exist',async()=>{
    const state=await fixture();
    const compile=vi.fn(async({assetId,bytes,sourceName})=>{
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect([...bytes]).toEqual([...state.bytes]);
      expect(sourceName).toBe('artifact_modal3d_01.glb');
      return {manifest:readyManifest(assetId),quality:{status:'ready',hard:[],advisory:[]}};
    });
    const assets=new AssetManager({manifests:{}});
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,assetCompiler:{compile},assetManager:assets,
      now:()=>NOW,idFactory:()=> 'lease_compile_01'
    });
    await pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_no_refetch'});
    expect(compile).toHaveBeenCalledTimes(1);
  });
});

describe('VerifiedArtifactAssetPipeline pre-compiler gates',()=>{
  it('rejects unverified Artifact before compiler',async()=>{
    const state=await fixture({verified:false});
    const compile=vi.fn();
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,assetCompiler:{compile},assetManager:new AssetManager({manifests:{}})
    });
    await expect(pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_target'}))
      .rejects.toMatchObject({code:'ARTIFACT_NOT_VERIFIED'});
    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects verified Artifact with no available local-cache location',async()=>{
    const state=await fixture({withCache:false});
    // verifyIntegrity does not require a location; this is intentional so pipeline proves bytes availability separately.
    const compile=vi.fn();
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,assetCompiler:{compile},assetManager:new AssetManager({manifests:{}})
    });
    await expect(pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_target'}))
      .rejects.toMatchObject({code:'ARTIFACT_LOCAL_BYTES_UNAVAILABLE'});
    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects local cache hash/bytes/MIME/artifact identity mismatch before compiler',async()=>{
    const state=await fixture();
    const canonical=state.byteStore.get('cache_modal3d_01');
    for (const patch of [
      {artifactId:'artifact_other'},
      {hash:`sha256:${'c'.repeat(64)}`},
      {bytes:canonical.bytes+1},
      {mime:'application/octet-stream'},
      {data:canonical.data.subarray(0,canonical.data.length-1)}
    ]) {
      const byteStore={get:()=>({...canonical,...patch})};
      const compile=vi.fn();
      const pipeline=new VerifiedArtifactAssetPipeline({
        artifactRegistry:state.registry,byteStore,assetCompiler:{compile},assetManager:new AssetManager({manifests:{}})
      });
      await expect(pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_target'}))
        .rejects.toMatchObject({code:'ARTIFACT_CACHE_IDENTITY_MISMATCH'});
      expect(compile).not.toHaveBeenCalled();
    }
  });

  it('keeps Artifact ID and AgentScape Asset ID as distinct identities',async()=>{
    const state=await fixture();
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,assetCompiler:{compile:vi.fn()},assetManager:new AssetManager({manifests:{}})
    });
    await expect(pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'artifact_modal3d_01'}))
      .rejects.toMatchObject({code:'ASSET_IDENTITY_COLLISION'});
  });
});

describe('VerifiedArtifactAssetPipeline compiler/admission/registration boundaries',()=>{
  it('returns structured compiler rejection without registering or mutating Artifact integrity',async()=>{
    const state=await fixture();
    const assets=new AssetManager({manifests:{}});
    const error=Object.assign(new Error('quality reject'),{code:'ASSET_COMPILE_REJECTED',details:{status:'rejected',hard:[{code:'BUDGET'}],advisory:[]}});
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,
      assetCompiler:{compile:vi.fn(async()=>{throw error;})},assetManager:assets,
      now:()=>NOW,idFactory:()=> 'lease_compile_01'
    });
    const result=await pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_rejected'});
    expect(result).toMatchObject({status:'asset-rejected',stage:'compiler',registered:false,admission:{status:'rejected'}});
    expect(assets.has('asset_rejected')).toBe(false);
    expect(state.registry.get('artifact_modal3d_01').integrity.state).toBe('verified');
    expect(state.byteStore.get('cache_modal3d_01')).not.toBeNull();
    expect(state.registry.leasesFor('artifact_modal3d_01')).toEqual([]);
  });

  it('wraps compiler operational exceptions and retains verified Artifact/cache',async()=>{
    const state=await fixture();
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,
      assetCompiler:{compile:vi.fn(async()=>{throw Object.assign(new Error('parse crash'),{code:'GLTF_PARSE_FAILED'});})},
      assetManager:new AssetManager({manifests:{}}),now:()=>NOW,idFactory:()=> 'lease_compile_01'
    });
    await expect(pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_failed'}))
      .rejects.toMatchObject({code:'COMPILER_FAILED',details:{cause:'GLTF_PARSE_FAILED'}});
    expect(state.registry.get('artifact_modal3d_01').integrity.state).toBe('verified');
    expect(state.byteStore.get('cache_modal3d_01')).not.toBeNull();
    expect(state.registry.leasesFor('artifact_modal3d_01')).toEqual([]);
  });

  it('does not register an admission-rejected compiler manifest',async()=>{
    const state=await fixture();
    const manifest=readyManifest('asset_admission_reject');
    manifest.provenance={compiler:'AgentScape',admission:{status:'rejected',reasons:['POLICY_REJECT']}};
    const assets=new AssetManager({manifests:{}});
    const register=vi.spyOn(assets,'registerManifest');
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,
      assetCompiler:{compile:vi.fn(async()=>({manifest,quality:{status:'ready',hard:[],advisory:[]}}))},assetManager:assets,
      now:()=>NOW,idFactory:()=> 'lease_compile_01'
    });
    const result=await pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_admission_reject'});
    expect(result).toMatchObject({status:'asset-rejected',stage:'admission',registered:false,admission:{status:'rejected',reasons:['POLICY_REJECT']}});
    expect(register).not.toHaveBeenCalled();
  });

  it('registers a ready manifest exactly once and preserves source Artifact provenance',async()=>{
    const state=await fixture();
    const assets=new AssetManager({manifests:{}});
    const register=vi.spyOn(assets,'registerManifest');
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,
      assetCompiler:{compile:vi.fn(async({assetId})=>({manifest:readyManifest(assetId),quality:{status:'ready',hard:[],advisory:[]}}))},
      assetManager:assets,now:()=>NOW,idFactory:()=> 'lease_compile_01'
    });
    const result=await pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_ready'});
    expect(result).toMatchObject({status:'asset-ready',stage:'registered',registered:true,artifactId:'artifact_modal3d_01',assetId:'asset_ready'});
    expect(register).toHaveBeenCalledTimes(1);
    expect(result.manifest.provenance.assetProduction.sourceArtifact).toMatchObject({
      id:'artifact_modal3d_01',producer:{provider:'modal-3d',operation:'modal-3d.asset.image_to_3d.v1'}
    });
    expect(result.manifest.actions).toEqual(['move']);
  });

  it('rejects compiler manifest identity mismatch before registration',async()=>{
    const state=await fixture();
    const assets=new AssetManager({manifests:{}});
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,
      assetCompiler:{compile:vi.fn(async()=>({manifest:readyManifest('asset_other'),quality:{status:'ready'}}))},
      assetManager:assets,now:()=>NOW,idFactory:()=> 'lease_compile_01'
    });
    await expect(pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_expected'}))
      .rejects.toMatchObject({code:'COMPILER_IDENTITY_MISMATCH'});
    expect(assets.has('asset_other')).toBe(false);
  });

  it('wraps manifest registration failure and always releases compile lease',async()=>{
    const state=await fixture();
    const stored=new Map();
    const assets={
      has:vi.fn(()=>false),
      registerManifest:vi.fn(()=>{ throw Object.assign(new Error('registry unavailable'),{code:'REGISTRY_WRITE_FAILED'}); }),
      getManifest:vi.fn((id)=>stored.get(id)||null)
    };
    const manifest=readyManifest('asset_register_fail');
    const pipeline=new VerifiedArtifactAssetPipeline({
      artifactRegistry:state.registry,byteStore:state.byteStore,
      assetCompiler:{compile:vi.fn(async()=>({manifest,quality:{status:'ready'}}))},
      assetManager:assets,now:()=>NOW,idFactory:()=> 'lease_compile_01'
    });
    await expect(pipeline.produce({artifactId:'artifact_modal3d_01',assetId:'asset_register_fail'}))
      .rejects.toMatchObject({code:'MANIFEST_REGISTRATION_FAILED',details:{cause:'REGISTRY_WRITE_FAILED'}});
    expect(assets.registerManifest).toHaveBeenCalledTimes(1);
    expect(state.registry.leasesFor('artifact_modal3d_01')).toEqual([]);
  });
});
