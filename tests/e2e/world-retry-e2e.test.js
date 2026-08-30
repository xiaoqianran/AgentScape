import { describe,expect,it,vi } from 'vitest';
import { AssetManager } from '../../asset/AssetManager.js';
import { AssetCatalog } from '../../asset/AssetCatalog.js';
import { createCanonicalWorldPipeline } from '../../world/compiler/createWorldPipeline.js';
import { SkillRegistry } from '../../agent/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../agent/skills/registerCoreSkills.js';
import { PolicyEngine } from '../../core/PolicyEngine.js';
import { TraceRecorder } from '../../core/TraceRecorder.js';

describe('bounded generated-world retry',()=>{
  it('turns only a first-attempt search miss into generation, then reruns the canonical pipeline once',async()=>{
    const assets=new AssetManager();
    const assetCatalog=new AssetCatalog({assetManager:assets});
    const generatedManifest={
      id:'retry_fixture_qx9',type:'fixture',label:'Retry Fixture',
      source:{kind:'glb',url:'https://assets.test/retry-fixture.glb'},
      actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.4,.4,.4],translation:[0,.4,0]}]},
      compiler:{quality:{status:'ready'}}
    };
    const generation={
      canGenerateAsset:vi.fn(()=>true),
      generateAsset:vi.fn(async(prompt,options)=>{
        expect(prompt).toBe('qx9 generated retry fixture');
        expect(options).toMatchObject({instanceId:'fixture_01'});
        assets.registerManifest(generatedManifest);
        return {...assetCatalog.summary(generatedManifest),status:'asset-ready'};
      })
    };
    const spawned=[];
    const snapshot={name:'before'};
    const runtime={
      events:null,trace:new TraceRecorder(),policy:new PolicyEngine(),assets,assetCatalog,generation,
      environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},
      physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},
      spawn:vi.fn(async(assetId,{position,id})=>{spawned.push({assetId,position,id});return id;}),
      interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},
      validator:{run:vi.fn(()=>({ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],coverage:{objects:spawned.length,relations:0}}))},
      repair:{repair:vi.fn()},serialize:vi.fn(({name})=>({schema:'agentscape.scene',name,objects:spawned.map((x)=>x.id)})),
      store:{get:vi.fn()},snapshot:vi.fn(()=>structuredClone(snapshot)),restore:vi.fn(async()=>{}),mutate:vi.fn(async(_label,fn)=>fn()),
      clearObjects:vi.fn(async()=>{spawned.length=0;}),loadRuleGraph:vi.fn()
    };
    runtime.worldPipeline=createCanonicalWorldPipeline(runtime);
    const registry=registerCoreSkills(new SkillRegistry({policy:runtime.policy,trace:runtime.trace,runtime}),runtime);

    const result=await registry.invoke('runWorldPipeline',{
      plan:{
        schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'retry-rev-1'},provenance:{source:'test'},intent:{name:'Retry Lab'},
        entities:[{id:'fixture_01',asset:{query:'qx9 generated retry fixture',generate:false}}],
        spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[]
      }
    },{profile:'builder',actor:'test'});

    expect(result).toMatchObject({success:true,result:{
      status:'world-ready',
      attempts:[
        {attempt:1,admission:{status:'rejected'},retry:{status:'retry-proposed',actions:[{kind:'enable-generation',instanceId:'fixture_01'}]}},
        {attempt:2,admission:{status:'ready'}}
      ]
    }});
    expect(generation.generateAsset).toHaveBeenCalledOnce();
    expect(runtime.worldPipeline).toBeDefined();
    expect(assets.has('retry_fixture_qx9')).toBe(true);
    expect(runtime.spawn).toHaveBeenCalledOnce();
    expect(runtime.spawn).toHaveBeenCalledWith('retry_fixture_qx9',expect.objectContaining({id:'fixture_01'}));
    expect(runtime.restore).toHaveBeenCalledOnce();
    expect(runtime.clearObjects).toHaveBeenCalledTimes(2);
    expect(runtime.loadRuleGraph).toHaveBeenCalledWith([]);
    expect(registry.executionPolicy('runWorldPipeline',result.result).outcome).toMatchObject({state:'verified',verified:true,status:'world-ready'});
  });
});
