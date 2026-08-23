import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../src/runtime/AssetManager.js';
import { AssetLibrary } from '../src/assets/library/AssetLibrary.js';
import { createWorldPipeline } from '../src/pipeline/createWorldPipeline.js';

describe('generated world pipeline',()=>{
  it('admits a raw EmbodiedGen asset, spawns it, validates the world, and preserves provisional admission',async()=>{
    const assets=new AssetManager();
    const generator={
      isConfigured:()=>true,
      generate:vi.fn(async(request)=>({
        provider:'embodiedgen',
        asset:{id:'eg-workbench',name:'AI Workbench',category:'workbench',dimensions:[2,1,.8],movable:false,glb_url:'https://assets.test/workbench.glb',affordances:['support']},
        requestEcho:request
      }))
    };
    const assetLibrary=new AssetLibrary({assetManager:assets,generator});
    const spawned=[];
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],coverage:{objects:1,relations:0}};
    const runtime={
      events:null,trace:null,assets,assetLibrary,
      spawn:vi.fn(async(assetId,{position,id})=>{spawned.push({assetId,position,id}); return id || `${assetId}_1`; }),
      interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},
      validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},
      serialize:vi.fn(({name})=>({schema:'agentscape.scene',name,objects:spawned.map((x)=>x.id)})),
      store:{get:vi.fn()}
    };
    const result=await createWorldPipeline(runtime).run({
      name:'Generated Lab',generation:{provider:'embodiedgen',generate:true},
      assets:[{id:'bench_01',prompt:'industrial robotics workbench',position:[2,0,-1]}]
    });
    expect(generator.generate).toHaveBeenCalledWith(expect.objectContaining({prompt:'industrial robotics workbench',provider:'embodiedgen'}));
    expect(assets.has('eg-workbench')).toBe(true);
    expect(runtime.spawn).toHaveBeenCalledWith('eg-workbench',{position:[2,0,-1],id:'bench_01'});
    expect(result.state.artifacts.worldSpec).toMatchObject({schema:1,name:'Generated Lab',generation:{provider:'embodiedgen',generate:true}});
    expect(result.state.reports.assetAdmission).toEqual({
      status:'provisional',unresolved:[],
      provisional:[{assetId:'eg-workbench',reasons:['FALLBACK_BOX_COLLIDER','UNVERIFIED_PROVIDER_SEMANTICS']}]
    });
    expect(result.state.reports.worldAdmission).toMatchObject({
      status:'provisional',reasons:['ASSET_PROVISIONAL'],validation:{hard:0,advisory:0},assets:{status:'provisional'}
    });
    expect(result.state.artifacts.scene).toEqual({schema:'agentscape.scene',name:'Generated Lab',objects:['bench_01']});
    expect(result.timeline.map((x)=>x.name)).toEqual(['normalize_spec','resolve_assets','asset_admission','instantiate','apply_relations','validate','repair','finalize']);
  });

  it('marks a world rejected when a required generated asset cannot be resolved',async()=>{
    const assets=new AssetManager();
    const assetLibrary={resolve:vi.fn(async()=>({status:'generator_not_configured',assets:[],hint:'configure generator'}))};
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],coverage:{objects:0,relations:0}};
    const runtime={
      events:null,trace:null,assets,assetLibrary,spawn:vi.fn(),
      interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},
      validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({})),store:{get:vi.fn()}
    };
    const result=await createWorldPipeline(runtime).run({generation:{provider:'embodiedgen',generate:true},assets:[
      {id:'chair_01',assetId:'chair',position:[1,0,0]},
      {id:'missing_01',prompt:'rare lab machine'}
    ]});
    expect(runtime.spawn).not.toHaveBeenCalled();
    expect(result.state.artifacts.spawned).toEqual([]);
    expect(result.state.reports.assetAdmission).toMatchObject({status:'rejected',unresolved:[{id:'missing_01',query:'rare lab machine',status:'generator_not_configured'}]});
    expect(result.state.reports.worldAdmission).toMatchObject({status:'rejected',reasons:['ASSET_UNRESOLVED']});
  });
});
