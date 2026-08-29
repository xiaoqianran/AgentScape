import { describe, expect, it } from 'vitest';
import { attachLegacyAuthoring } from '../generation/orchestration/LegacyAuthoringShell.js';
import { createAssetModule } from '../generation/orchestration/createAssetModule.js';
import { WorldRuntime } from '../world/runtime/WorldRuntime.js';

const createRuntime = () => new WorldRuntime({ appendChild() {} }, { environmentFactory: () => null, assetModule:createAssetModule() });

describe('WorldRuntime authoring boundary', () => {
  it('constructs a provider-neutral World core', () => {
    const runtime = createRuntime();

    expect(runtime.assets).toBeTruthy();
    expect(runtime.assetCatalog).toBeTruthy();
    expect(runtime.compiledAssetStore).toBeTruthy();
    for (const key of [
      'authoring',
      'assetGenerator',
      'compilerProvider',
      'generation',
      'generationState',
      'generationConnectorError',
      'getAssetCompiler'
    ]) {
      expect(Object.prototype.hasOwnProperty.call(runtime, key)).toBe(false);
    }
  });

  it('restores the legacy authoring surface only when explicitly attached', async () => {
    const runtime = createRuntime();
    const authoring = attachLegacyAuthoring(runtime, { storage: null, connectorClient: null });

    expect(runtime.authoring).toBe(authoring);
    expect(authoring.assetCatalog).toBe(runtime.assetCatalog);
    expect(runtime.assetGenerator).toBe(authoring.assetGenerator);
    expect(runtime.compilerProvider).toBe(authoring.compilerProvider);
    expect(runtime.generation).toBe(authoring.generation);
    expect(runtime.getAssetCompiler).toBe(authoring.getAssetCompiler);
    expect(runtime.generation.artifactRegistry).toBe(runtime.assetModule.artifactRegistry);
    expect(runtime.generation.byteStore).toBe(runtime.assetModule.byteStore);
    expect(runtime.generation.publishAsset).toBe(runtime.assetModule.publishAsset);
    expect(runtime.generationConnectorError).toBeNull();

    const state = await authoring.initialize();
    expect(state).toEqual({ status: 'connection-required', reason: 'CONNECTOR_NOT_CONFIGURED' });
    expect(runtime.generationState).toEqual(state);
  });

  it('reports generation-ready when a direct asset adapter is executable without a local connector', async () => {
    const runtime = createRuntime();
    const generator = {
      isConfigured: () => true,
      generate: async () => ({ manifest: {
        id:'generated_direct', type:'prop', version:'1', source:{kind:'procedural'},
        render:{kind:'primitive',primitive:'box',size:[1,1,1]},
        physics:{mode:'static',collider:{type:'box',size:[1,1,1]}}
      } })
    };
    const authoring = attachLegacyAuthoring(runtime, { connectorClient:null, assetGenerator:generator });
    const state = await authoring.initialize({ pair:false });
    expect(state).toEqual({ status:'generation-ready', transport:'direct', localAdapter:{status:'optional'} });
    expect(authoring.canGenerateAsset()).toBe(true);
  });

  it('is idempotent for one runtime', () => {
    const runtime = createRuntime();
    const first = attachLegacyAuthoring(runtime, { storage: null, connectorClient: null });
    const second = attachLegacyAuthoring(runtime, { storage: null, connectorClient: null });
    expect(second).toBe(first);
  });

  it('accepts a physics factory without binding World core to Rapier', () => {
    const physics={ identity:'custom-physics-runtime' };
    const physicsFactory=()=>physics;
    const runtime=new WorldRuntime(
      { appendChild() {} },
      { environmentFactory:()=>null, assetModule:createAssetModule(), physicsFactory }
    );
    expect(runtime.physics).toBe(physics);
    expect(runtime.physicsFactory).toBe(physicsFactory);
    expect(runtime.articulationVerifier.physicsFactory).toBe(physicsFactory);
  });


  it('accepts a navigation backend factory without binding World core to Recast', () => {
    const backend={identity:'custom-navigation-backend'};
    const navigationBackendFactory=()=>backend;
    const runtime=new WorldRuntime(
      { appendChild() {} },
      { environmentFactory:()=>null, assetModule:createAssetModule(), navigationBackendFactory }
    );
    expect(runtime.navigationBackendFactory).toBe(navigationBackendFactory);
    expect(runtime.navigationBackendFactory()).toBe(backend);
  });

});
