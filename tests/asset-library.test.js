import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../src/runtime/AssetManager.js';
import { AssetLibrary } from '../src/assets/library/AssetLibrary.js';

function library(generator = null) {
  return new AssetLibrary({ assetManager: new AssetManager(), generator });
}

describe('AssetLibrary', () => {
  it('searches ids, aliases and multilingual tags', () => {
    const assets = library();
    expect(assets.search('chair')[0].id).toBe('chair');
    expect(assets.search('椅子')[0].id).toBe('chair');
    expect(assets.search('mug')[0].id).toBe('cup');
  });

  it('resolves reusable assets before generation', async () => {
    const generator = { isConfigured: () => true, generate: vi.fn() };
    const result = await library(generator).resolve('chair', { generate: true });
    expect(result.status).toBe('found');
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('delegates generated assets to the unified GenerationOrchestrator when a Connector route is available', async () => {
    const assetManager=new AssetManager();
    const generation={
      canGenerateTextAsset:vi.fn(()=>true),
      generateTextAsset:vi.fn(async({assetId,label})=>{
        const manifest={id:assetId,type:'object',label,source:{kind:'glb',url:'https://assets.test/generated.glb'},actions:['move'],physics:{body:'fixed',colliders:[]},compiler:{quality:{status:'ready'}},provenance:{assetProduction:{sourceArtifact:{producer:{provider:'modal-3d'}}}}};
        assetManager.registerManifest(manifest);
        return {status:'asset-ready',assetId,manifest,admission:{status:'ready',reasons:[]},route:{kind:'text-image-3d'},jobs:{image:'job_image',asset:'job_asset'}};
      })
    };
    const assets=new AssetLibrary({assetManager,generationOrchestrator:generation});
    const result=await assets.resolve('a red apple',{generate:true,instanceId:'apple_01'});
    expect(result).toMatchObject({status:'generated',assets:[{id:'generated_apple_01',admission:{status:'ready'},generation:{route:{kind:'text-image-3d'}}}]});
    expect(generation.generateTextAsset).toHaveBeenCalledWith(expect.objectContaining({prompt:'a red apple',assetId:'generated_apple_01'}));
  });

  it('reports a missing generator explicitly', async () => {
    const result = await library().resolve('spaceship toaster', { generate: true });
    expect(result.status).toBe('generator_not_configured');
    expect(result.assets).toEqual([]);
  });

  it('registers a generated GLB manifest for immediate reuse', async () => {
    const generator = {
      isConfigured: () => true,
      generate: vi.fn(async () => ({ manifest: { id: 'plant_generated', type: 'plant', label: 'Plant', tags: ['plant'], source: { kind: 'glb', url: 'https://assets.test/plant.glb' }, actions: ['move'], physics: { body: 'fixed', colliders: [] } } }))
    };
    const assets = library(generator);
    const result = await assets.resolve('rare plant', { generate: true });
    expect(result).toMatchObject({status:'generated',assets:[{id:'plant_generated',admission:{status:'provisional',reasons:['COMPILER_UNVERIFIED']}}]});
    expect(assets.search('plant')[0].id).toBe('plant_generated');
  });

  it('adapts a raw EmbodiedGen provider payload into a validated provisional runtime manifest', async () => {
    const generator = {
      isConfigured: () => true,
      generate: vi.fn(async () => ({
        provider:'embodiedgen',
        asset:{ id:'eg-bench', name:'Generated Bench', category:'workbench', dimensions:[2,1,.8], movable:false, glb_url:'https://assets.test/bench.glb', affordances:['support'] }
      }))
    };
    const assets = library(generator);
    const result = await assets.resolve('generated workbench', { generate:true, provider:'embodiedgen' });
    expect(result).toMatchObject({status:'generated',assets:[{
      id:'eg-bench',type:'workbench',source:'glb',
      admission:{status:'provisional',reasons:['FALLBACK_BOX_COLLIDER','UNVERIFIED_PROVIDER_SEMANTICS','COMPILER_UNVERIFIED']}
    }]});
    const manifest=assets.assetManager.getManifest('eg-bench');
    expect(manifest).toMatchObject({
      source:{kind:'glb',url:'https://assets.test/bench.glb'},
      provenance:{provider:'embodiedgen',adapter:'EmbodiedGenAdapter',semantics:{source:'provider-affordances',verified:false},admission:{status:'provisional'}}
    });
    expect(manifest.actions).toEqual(['move']);
  });

  it('refuses an unrecognized raw generator payload instead of fabricating a manifest', async () => {
    const generator={isConfigured:()=>true,generate:vi.fn(async()=>({provider:'unknown',asset:{id:'x'}}))};
    await expect(library(generator).generate('x',{provider:'unknown'})).rejects.toThrow(/manifest or a recognized provider payload/);
  });


  it('does not register a compiler-rejected generated manifest', async () => {
    const generator={isConfigured:()=>true,generate:vi.fn(async()=>({manifest:{
      id:'bad_generated',type:'object',source:{kind:'glb',url:'https://assets.test/bad.glb'},actions:['move'],physics:{body:'fixed',colliders:[]},
      compiler:{quality:{status:'rejected'}}
    }}))};
    const assets=library(generator);
    const result=await assets.resolve('bad generated',{generate:true});
    expect(result).toMatchObject({status:'rejected',assets:[],assetId:'bad_generated',admission:{status:'rejected',reasons:['COMPILER_REJECTED']}});
    expect(assets.assetManager.has('bad_generated')).toBe(false);
  });

  it('allows a compiler-ready generated manifest to retain ready admission', async () => {
    const generator={isConfigured:()=>true,generate:vi.fn(async()=>({manifest:{
      id:'ready_generated',type:'object',source:{kind:'glb',url:'https://assets.test/ready.glb'},actions:['move'],physics:{body:'fixed',colliders:[]},
      compiler:{quality:{status:'ready'}}
    }}))};
    const assets=library(generator);
    const result=await assets.resolve('ready generated',{generate:true});
    expect(result).toMatchObject({status:'generated',assets:[{id:'ready_generated',admission:{status:'ready',reasons:[]}}]});
    expect(assets.assetManager.has('ready_generated')).toBe(true);
  });

});
