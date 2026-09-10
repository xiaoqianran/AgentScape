import { describe, expect, it, vi } from 'vitest';
import { attachGenerationRuntime } from '../../application/generation/GenerationRuntime.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createArtifactModule } from '../../modules/artifact/ArtifactModule.js';
import { sha256ArtifactHash } from '../../modules/artifact/IncrementalSha256.js';
import { WorldRuntime } from '../../modules/world/runtime/WorldRuntime.js';

const createRuntime=()=>new WorldRuntime({appendChild(){}},{environmentFactory:()=>null,assetModule:createAssetModule()});

describe('WorldRuntime generation boundary',()=>{
  it('constructs a provider-neutral World core without Generation composition',()=>{
    const runtime=createRuntime();
    expect(runtime.assets).toBeTruthy();
    expect(runtime.assetCatalog).toBeTruthy();
    for(const key of ['authoring','assetGenerator','compilerProvider','generation','generationState','generationConnectorError','getAssetCompiler']) {
      expect(Object.prototype.hasOwnProperty.call(runtime,key)).toBe(false);
    }
  });

  it('attaches one GenerationRuntime without restoring legacy authoring surfaces',async()=>{
    const runtime=createRuntime();
    const artifacts=createArtifactModule();
    const generation=attachGenerationRuntime(runtime,{artifactModule:artifacts,connectorClient:null,compilerEndpoint:''});
    expect(runtime.generation).toBe(generation);
    expect(runtime.assetModule.artifacts).toBeUndefined();
    expect(generation.assetCatalog).toBe(runtime.assetCatalog);
    expect(generation.artifacts).toBe(artifacts);
    expect(generation.assetModule).toBe(runtime.assetModule);
    expect(generation.compilerProvider).toBeUndefined();
    expect(generation.getAssetCompiler).toBeUndefined();
    expect(generation.artifactRegistry).toBe(artifacts.registry);
    expect(generation.byteStore).toBe(artifacts.byteStore);
    expect(generation.publishAsset).toBe(runtime.assetModule.publishAsset);
    expect(generation.providerRegistry.listProviders()).toEqual([]);
    expect(runtime.authoring).toBeUndefined();
    expect(runtime.assetGenerator).toBeUndefined();
    expect(runtime.compilerProvider).toBeUndefined();
    expect(runtime.getAssetCompiler).toBeUndefined();
    await expect(generation.initialize()).resolves.toEqual({status:'connection-required',reason:'CONNECTOR_NOT_CONFIGURED'});
    expect(generation.canGenerateAsset()).toBe(false);
    expect(generation.canGenerateTextWorld()).toBe(false);
    expect(typeof generation.generateTextWorldArtifacts).toBe('function');
  });

  it('enforces approved-image at the legacy text-asset boundary without disabling the Generation runtime',async()=>{
    const runtime=createRuntime();
    const generation=attachGenerationRuntime(runtime,{connectorClient:null,assetInputPolicy:'approved-image'});
    expect(generation.assetInputPolicy).toBe('approved-image');
    expect(generation.canGenerateAsset()).toBe(false);
    await expect(generation.generateAsset('wooden chair')).resolves.toMatchObject({status:'image_input_required',prompt:'wooden chair'});
    await expect(generation.resolveAssetRequest({query:'missing_policy_asset_9f4c2',generate:true})).resolves.toMatchObject({status:'image_input_required',query:'missing_policy_asset_9f4c2',assets:[]});
    expect(typeof generation.generateTextWorldArtifacts).toBe('function');
  });

  it('keeps a Human-approved local image in both local Artifact storage and the paired Connector with matching SHA-256',async()=>{
    const runtime=createRuntime();
    const artifacts=createArtifactModule({persistentStore:null});
    const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]);
    const hash=sha256ArtifactHash([bytes]);
    const connectorClient={
      isPaired:vi.fn(()=>true),
      session:vi.fn(()=>({status:'paired',connector:{id:'unified-connector',instance:'instance_01'}})),
      request:vi.fn(async(_path,options)=>({
        ok:true,status:201,redirected:false,
        json:async()=>({artifact:{id:'artifact_local_01',role:'primary-image',mime:'image/png',bytes:options.body.byteLength,hash}})
      }))
    };
    const generation=attachGenerationRuntime(runtime,{artifactModule:artifacts,connectorClient});
    const descriptor=await generation.uploadInputArtifact(bytes);
    expect(descriptor).toMatchObject({id:'artifact_local_01',hash,mime:'image/png',integrity:{state:'verified'}});
    const local=descriptor.locations.find((location)=>location.kind==='local-cache');
    const remote=descriptor.locations.find((location)=>location.kind==='connector');
    expect(local?.state).toBe('available');
    expect(remote?.access).toMatchObject({kind:'connector-artifact',artifactId:'artifact_local_01',connector:{id:'unified-connector',instance:'instance_01'}});
    expect(artifacts.byteStore.get(local.access.key)?.data).toEqual(bytes);
    expect(connectorClient.request).toHaveBeenCalledWith('/connector/v1/artifacts',expect.objectContaining({scope:'artifacts.write',method:'POST',body:bytes}));
  });

  it('delegates compiler endpoint changes to AssetModule without owning compiler internals',()=>{
    const runtime=createRuntime();
    const compilerProvider={setEndpoint:vi.fn()};
    const generation=attachGenerationRuntime(runtime,{connectorClient:null,compilerProvider});
    generation.setCompilerEndpoint('http://127.0.0.1:9999/compile');
    expect(compilerProvider.setEndpoint).toHaveBeenCalledWith('http://127.0.0.1:9999/compile');
    expect(generation.compilerProvider).toBeUndefined();
    expect(generation.getAssetCompiler).toBeUndefined();
  });

  it('is idempotent for one runtime',()=>{
    const runtime=createRuntime();
    const first=attachGenerationRuntime(runtime,{connectorClient:null});
    const second=attachGenerationRuntime(runtime,{connectorClient:null});
    expect(second).toBe(first);
  });

  it('accepts a physics factory without binding World core to Rapier',()=>{
    const physics={identity:'custom-physics-runtime'};
    const physicsFactory=()=>physics;
    const runtime=new WorldRuntime({appendChild(){}},{environmentFactory:()=>null,assetModule:createAssetModule(),physicsFactory});
    expect(runtime.physics).toBe(physics);
    expect(runtime.physicsFactory).toBe(physicsFactory);
    expect(runtime.articulationVerifier.physicsFactory).toBe(physicsFactory);
  });

  it('accepts a navigation backend factory without binding World core to Recast',()=>{
    const backend={identity:'custom-navigation-backend'};
    const navigationBackendFactory=()=>backend;
    const runtime=new WorldRuntime({appendChild(){}},{environmentFactory:()=>null,assetModule:createAssetModule(),navigationBackendFactory});
    expect(runtime.navigationBackendFactory).toBe(navigationBackendFactory);
    expect(runtime.navigationBackendFactory()).toBe(backend);
  });
});
