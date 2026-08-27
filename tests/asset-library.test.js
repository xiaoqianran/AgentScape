import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../src/assets/AssetManager.js';
import { AssetLibrary } from '../src/assets/library/AssetLibrary.js';

const manifest = (overrides = {}) => ({
  id:'generated_fixture', type:'object', label:'Generated Fixture',
  source:{kind:'glb',url:'https://assets.test/generated.glb'},
  actions:['move'], physics:{body:'fixed',colliders:[]},
  ...overrides
});

function library(port = null, assetManager = new AssetManager()) {
  return new AssetLibrary({ assetManager, generationPort: port });
}

const port = (result, { available = true } = {}) => ({
  canGenerate: vi.fn(() => available),
  generate: vi.fn(async () => typeof result === 'function' ? result() : result)
});

describe('AssetLibrary', () => {
  it('searches ids, aliases and multilingual tags', () => {
    const assets = library();
    expect(assets.search('chair')[0].id).toBe('chair');
    expect(assets.search('椅子')[0].id).toBe('chair');
    expect(assets.search('mug')[0].id).toBe('cup');
  });

  it('resolves reusable assets before generation', async () => {
    const generation = port({ manifest: manifest() });
    const result = await library(generation).resolve('chair', { generate: true });
    expect(result.status).toBe('found');
    expect(generation.generate).not.toHaveBeenCalled();
  });

  it('delegates missing assets through one generation port', async () => {
    const assetManager = new AssetManager();
    const generation = port(({ assetId, label }) => ({
      manifest: manifest({ id: assetId, label, compiler:{quality:{status:'ready'}} }),
      admission:{status:'ready',reasons:[]},
      generation:{route:{kind:'text-image-3d'},jobs:{image:'job_image',asset:'job_asset'}}
    }));
    generation.generate.mockImplementation(async (prompt, options) => ({
      manifest: manifest({ id: options.assetId, label: options.label, compiler:{quality:{status:'ready'}} }),
      admission:{status:'ready',reasons:[]},
      generation:{route:{kind:'text-image-3d'},jobs:{image:'job_image',asset:'job_asset'}}
    }));
    const assets=library(generation, assetManager);
    const result=await assets.resolve('a red apple',{generate:true,instanceId:'apple_01'});
    expect(result).toMatchObject({status:'generated',assets:[{id:'generated_apple_01',admission:{status:'ready'},generation:{route:{kind:'text-image-3d'}}}]});
    expect(generation.generate).toHaveBeenCalledWith('a red apple', expect.objectContaining({assetId:'generated_apple_01',label:'a red apple'}));
  });

  it('reports a missing generation port explicitly', async () => {
    const result = await library().resolve('spaceship toaster', { generate: true });
    expect(result.status).toBe('generator_not_configured');
    expect(result.assets).toEqual([]);
  });

  it('registers a generated manifest for immediate reuse', async () => {
    const assets = library(port({ manifest: manifest({ id:'plant_generated', type:'plant', label:'Plant', tags:['plant'] }) }));
    const result = await assets.resolve('rare plant', { generate: true });
    expect(result).toMatchObject({status:'generated',assets:[{id:'plant_generated',admission:{status:'provisional',reasons:['COMPILER_UNVERIFIED']}}]});
    expect(assets.search('plant')[0].id).toBe('plant_generated');
  });

  it('fails closed when the generation port returns no manifest', async () => {
    await expect(library(port({ raw:true })).generate('x')).rejects.toThrow(/without a manifest/);
  });

  it('does not register a compiler-rejected generated manifest', async () => {
    const assets=library(port({manifest:manifest({id:'bad_generated',compiler:{quality:{status:'rejected'}}})}));
    const result=await assets.resolve('bad generated',{generate:true});
    expect(result).toMatchObject({status:'rejected',assets:[],assetId:'bad_generated',admission:{status:'rejected',reasons:['COMPILER_REJECTED']}});
    expect(assets.assetManager.has('bad_generated')).toBe(false);
  });

  it('allows a compiler-ready generated manifest to retain ready admission', async () => {
    const assets=library(port({manifest:manifest({id:'ready_generated',compiler:{quality:{status:'ready'}}})}));
    const result=await assets.resolve('ready generated',{generate:true});
    expect(result).toMatchObject({status:'generated',assets:[{id:'ready_generated',admission:{status:'ready',reasons:[]}}]});
    expect(assets.assetManager.has('ready_generated')).toBe(true);
  });
});
