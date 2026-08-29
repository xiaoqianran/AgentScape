import { describe, expect, it } from 'vitest';
import { attachGenerationRuntime } from '../../generation/orchestration/GenerationRuntime.js';
import { createAssetModule } from '../../generation/orchestration/createAssetModule.js';
import { WorldRuntime } from '../../world/runtime/WorldRuntime.js';

const createRuntime=()=>new WorldRuntime({appendChild(){}},{environmentFactory:()=>null,assetModule:createAssetModule()});

describe('WorldRuntime generation boundary',()=>{
  it('constructs a provider-neutral World core without Generation composition',()=>{
    const runtime=createRuntime();
    expect(runtime.assets).toBeTruthy();
    expect(runtime.assetCatalog).toBeTruthy();
    expect(runtime.compiledAssetStore).toBeTruthy();
    for(const key of ['authoring','assetGenerator','compilerProvider','generation','generationState','generationConnectorError','getAssetCompiler']) {
      expect(Object.prototype.hasOwnProperty.call(runtime,key)).toBe(false);
    }
  });

  it('attaches one GenerationRuntime without restoring legacy authoring surfaces',async()=>{
    const runtime=createRuntime();
    const generation=attachGenerationRuntime(runtime,{connectorClient:null,compilerEndpoint:''});
    expect(runtime.generation).toBe(generation);
    expect(generation.assetCatalog).toBe(runtime.assetCatalog);
    expect(generation.artifactRegistry).toBe(runtime.assetModule.artifactRegistry);
    expect(generation.byteStore).toBe(runtime.assetModule.byteStore);
    expect(generation.publishAsset).toBe(runtime.assetModule.publishAsset);
    expect(generation.providerRegistry.listProviders()).toEqual([]);
    expect(runtime.authoring).toBeUndefined();
    expect(runtime.assetGenerator).toBeUndefined();
    expect(runtime.compilerProvider).toBeUndefined();
    expect(runtime.getAssetCompiler).toBeUndefined();
    await expect(generation.initialize()).resolves.toEqual({status:'connection-required',reason:'CONNECTOR_NOT_CONFIGURED'});
    expect(generation.canGenerateAsset()).toBe(false);
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
