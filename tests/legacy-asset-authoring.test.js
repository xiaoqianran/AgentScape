import { describe, expect, it, vi } from 'vitest';
import { AssetCatalog } from '../asset/AssetCatalog.js';
import { AssetManager } from '../asset/AssetManager.js';
import { createLegacyAssetAuthoring } from '../generation/orchestration/LegacyAuthoringShell.js';

const manifest = (overrides = {}) => ({
  id:'generated_fixture', type:'object', label:'Generated Fixture',
  source:{kind:'glb',url:'https://assets.test/generated.glb'},
  actions:['move'], physics:{body:'fixed',colliders:[]},
  ...overrides
});

const port = (result, { available = true } = {}) => ({
  canGenerate: vi.fn(() => available),
  generate: vi.fn(async () => typeof result === 'function' ? result() : result)
});

function authoring(generationPort, assetManager = new AssetManager()) {
  const catalog = new AssetCatalog({ assetManager });
  return {
    api: createLegacyAssetAuthoring({ assetManager, catalog, generationPort }),
    assetManager,
    catalog
  };
}

describe('Legacy Asset authoring compatibility', () => {
  it('resolves reusable Assets before generation', async () => {
    const generation = port({ manifest: manifest() });
    const { api } = authoring(generation);
    const result = await api.resolveAssetRequest({ query:'chair', generate:true });
    expect(result.status).toBe('found');
    expect(generation.generate).not.toHaveBeenCalled();
  });

  it('delegates missing Assets through one authoring generation port', async () => {
    const generation = port(null);
    generation.generate.mockImplementation(async (_prompt, options) => ({
      manifest: manifest({ id: options.assetId, label: options.label, compiler:{quality:{status:'ready'}} }),
      admission:{status:'ready',reasons:[]},
      generation:{route:{kind:'text-image-3d'},jobs:{image:'job_image',asset:'job_asset'}}
    }));
    const { api } = authoring(generation);
    const result = await api.resolveAssetRequest({query:'a red apple',generate:true,instanceId:'apple_01'});
    expect(result).toMatchObject({status:'generated',assets:[{id:'generated_apple_01',admission:{status:'ready'},generation:{route:{kind:'text-image-3d'}}}]});
    expect(generation.generate).toHaveBeenCalledWith('a red apple', expect.objectContaining({assetId:'generated_apple_01',label:'a red apple'}));
  });

  it('reports unavailable generation explicitly', async () => {
    const { api } = authoring(port(null,{available:false}));
    const result = await api.resolveAssetRequest({query:'spaceship toaster',generate:true});
    expect(result).toMatchObject({status:'generator_not_configured',query:'spaceship toaster',assets:[]});
  });

  it('registers generated manifests after Asset admission', async () => {
    const { api, assetManager, catalog } = authoring(port({
      manifest: manifest({ id:'plant_generated', type:'plant', label:'Plant', tags:['plant'] })
    }));
    const result = await api.resolveAssetRequest({query:'rare plant',generate:true});
    expect(result).toMatchObject({status:'generated',assets:[{id:'plant_generated',admission:{status:'provisional',reasons:['COMPILER_UNVERIFIED']}}]});
    expect(assetManager.has('plant_generated')).toBe(true);
    expect(catalog.search('plant')[0].id).toBe('plant_generated');
  });

  it('fails closed when generation returns no manifest', async () => {
    const { api } = authoring(port({ raw:true }));
    await expect(api.generateAsset('x')).rejects.toThrow(/without a manifest/);
  });

  it('does not register compiler-rejected generated manifests', async () => {
    const { api, assetManager } = authoring(port({manifest:manifest({id:'bad_generated',compiler:{quality:{status:'rejected'}}})}));
    const result = await api.resolveAssetRequest({query:'bad generated',generate:true});
    expect(result).toMatchObject({status:'rejected',assets:[],assetId:'bad_generated',admission:{status:'rejected',reasons:['COMPILER_REJECTED']}});
    expect(assetManager.has('bad_generated')).toBe(false);
  });

  it('retains ready admission for compiler-ready generated manifests', async () => {
    const { api, assetManager } = authoring(port({manifest:manifest({id:'ready_generated',compiler:{quality:{status:'ready'}}})}));
    const result = await api.resolveAssetRequest({query:'ready generated',generate:true});
    expect(result).toMatchObject({status:'generated',assets:[{id:'ready_generated',admission:{status:'ready',reasons:[]}}]});
    expect(assetManager.has('ready_generated')).toBe(true);
  });
});
