import { describe, expect, it, vi } from 'vitest';
import { createAssetModule } from '../../modules/asset/AssetModule.js';

const manifest = {
  id:'fixture_asset', type:'object', source:{kind:'builtin'}, actions:['move'],
  physics:{body:'fixed',colliders:[]}
};
const compiledManifest = {
  id:'persisted_asset', type:'object', label:'Persisted Asset',
  source:{kind:'compiled',key:'persisted_asset'}, actions:['move'],
  physics:{body:'fixed',colliders:[]}
};

describe('createAssetModule', () => {
  it('exposes explicit registry and loader boundaries', () => {
    const module=createAssetModule({manifests:{fixture_asset:manifest},manifestStore:null});
    expect(module.loader.compiledStore).toBe(module.compiledStore);
    expect(module.loader.registry).toBe(module.registry);
    expect(module.catalog.registry).toBe(module.registry);
    expect(module.library.assetRegistry).toBe(module.registry);
    expect(module.manager).toBeUndefined();
    expect(module.artifacts).toBeUndefined();
    expect(module.artifactRegistry).toBeUndefined();
    expect(module.byteStore).toBeUndefined();
    expect(typeof module.produceAsset).toBe('function');
    expect(typeof module.configureProduction).toBe('function');
    expect(typeof module.hydrate).toBe('function');
    expect(typeof module.registerManifest).toBe('function');
    expect(module.catalog.resolveExisting('fixture')).toMatchObject({status:'found',assets:[{id:'fixture_asset'}]});
  });

  it('accepts an externally supplied compiled store without changing Asset ownership semantics', () => {
    const compiledStore={get:async()=>null};
    const module=createAssetModule({manifests:{},compiledStore,manifestStore:null});
    expect(module.compiledStore).toBe(compiledStore);
    expect(module.loader.compiledStore).toBe(compiledStore);
    expect(module.manager).toBeUndefined();
  });

  it('hydrates persisted compiled manifests into a fresh AssetRegistry once', async () => {
    const manifestStore={list:vi.fn(async()=>[compiledManifest]),put:vi.fn()};
    const module=createAssetModule({manifests:{},manifestStore});
    await expect(module.hydrate()).resolves.toEqual({manifests:1,restored:1});
    expect(module.registry.getManifest('persisted_asset')).toMatchObject({source:{kind:'compiled',key:'persisted_asset'}});
    await module.hydrate();
    expect(manifestStore.list).toHaveBeenCalledOnce();
  });

  it('persists compiled manifests registered through the AssetModule boundary', async () => {
    const manifestStore={list:vi.fn(async()=>[]),put:vi.fn(async()=> 'persisted_asset')};
    const module=createAssetModule({manifests:{},manifestStore});
    await expect(module.registerManifest(compiledManifest)).resolves.toBe(true);
    expect(manifestStore.put).toHaveBeenCalledWith(expect.objectContaining({id:'persisted_asset'}));
  });

  it('does not persist builtin manifests', async () => {
    const manifestStore={list:vi.fn(async()=>[]),put:vi.fn()};
    const module=createAssetModule({manifests:{},manifestStore});
    await module.registerManifest(manifest);
    expect(manifestStore.put).not.toHaveBeenCalled();
  });
});
