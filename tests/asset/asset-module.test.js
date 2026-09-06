import { describe, expect, it, vi } from 'vitest';
import { createAssetModule } from '../../asset/AssetModule.js';

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
  it('owns only the executable Asset boundary', () => {
    const module=createAssetModule({manifests:{fixture_asset:manifest},manifestStore:null});
    expect(module.manager.compiledStore).toBe(module.compiledStore);
    expect(module.catalog.assetManager).toBe(module.manager);
    expect(module.artifacts).toBeUndefined();
    expect(module.artifactRegistry).toBeUndefined();
    expect(module.byteStore).toBeUndefined();
    expect(typeof module.publishAsset).toBe('function');
    expect(typeof module.configurePublication).toBe('function');
    expect(typeof module.hydrate).toBe('function');
    expect(typeof module.registerManifest).toBe('function');
    expect(module.catalog.resolveExisting('fixture')).toMatchObject({status:'found',assets:[{id:'fixture_asset'}]});
  });

  it('accepts an externally supplied compiled store without changing Asset ownership semantics', () => {
    const compiledStore={get:async()=>null};
    const module=createAssetModule({manifests:{},compiledStore,manifestStore:null});
    expect(module.compiledStore).toBe(compiledStore);
    expect(module.manager.compiledStore).toBe(compiledStore);
  });

  it('hydrates persisted compiled manifests into a fresh AssetManager once', async () => {
    const manifestStore={list:vi.fn(async()=>[compiledManifest]),put:vi.fn()};
    const module=createAssetModule({manifests:{},manifestStore});
    await expect(module.hydrate()).resolves.toEqual({manifests:1,restored:1});
    expect(module.manager.getManifest('persisted_asset')).toMatchObject({source:{kind:'compiled',key:'persisted_asset'}});
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
