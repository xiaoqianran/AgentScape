import { describe, expect, it } from 'vitest';
import { createAssetModule } from '../generation/orchestration/createAssetModule.js';

const manifest = {
  id:'fixture_asset', type:'object', source:{kind:'builtin'}, actions:['move'],
  physics:{body:'fixed',colliders:[]}
};

describe('createAssetModule', () => {
  it('owns Store, Manager, and Catalog as one coherent Asset boundary', () => {
    const module=createAssetModule({manifests:{fixture_asset:manifest}});
    expect(module.manager.compiledStore).toBe(module.compiledStore);
    expect(module.catalog.assetManager).toBe(module.manager);
    expect(module.artifactRegistry).toBeTruthy();
    expect(module.byteStore).toBeTruthy();
    expect(typeof module.publishAsset).toBe('function');
    expect(typeof module.configurePublication).toBe('function');
    expect(module.catalog.resolveExisting('fixture')).toMatchObject({status:'found',assets:[{id:'fixture_asset'}]});
  });

  it('accepts an externally supplied compiled store without changing ownership semantics', () => {
    const compiledStore={get:async()=>null};
    const module=createAssetModule({manifests:{},compiledStore});
    expect(module.compiledStore).toBe(compiledStore);
    expect(module.manager.compiledStore).toBe(compiledStore);
  });
});
