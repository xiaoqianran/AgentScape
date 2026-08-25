import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../src/runtime/AssetManager.js';
import { AssetLibrary } from '../src/assets/library/AssetLibrary.js';
import { createWorldPipeline } from '../src/pipeline/createWorldPipeline.js';
import { PhysicsBackend } from '../src/runtime/physics/PhysicsBackend.js';

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
      environment:{layout:{bounds:{min:[-5,-5],max:[5,5]},groundY:0,margin:.5}},physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},
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
    expect(result.state.artifacts.worldIR).toMatchObject({schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'legacy-root'},provenance:{source:'legacy-world-spec'}});
    expect(result.state.reports.assetAdmission).toEqual({
      status:'provisional',unresolved:[],
      provisional:[{assetId:'eg-workbench',reasons:['FALLBACK_BOX_COLLIDER','UNVERIFIED_PROVIDER_SEMANTICS']}]
    });
    expect(result.state.reports.worldAdmission).toMatchObject({
      status:'provisional',reasons:['ASSET_PROVISIONAL'],validation:{hard:0,advisory:0},assets:{status:'provisional'}
    });
    expect(result.state.artifacts.scene).toEqual({schema:'agentscape.scene',name:'Generated Lab',objects:['bench_01']});
    expect(result.timeline.map((x)=>x.name)).toEqual(['normalize_spec','resolve_assets','asset_admission','compose_layout','behavior_admission','physics_admission','instantiate','apply_relations','validate','repair','finalize']);
  });

  it('marks a world rejected when a required generated asset cannot be resolved',async()=>{
    const assets=new AssetManager();
    const assetLibrary={resolve:vi.fn(async()=>({status:'generator_not_configured',assets:[],hint:'configure generator'}))};
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],coverage:{objects:0,relations:0}};
    const runtime={
      events:null,trace:null,assets,assetLibrary,spawn:vi.fn(),
      environment:{layout:{bounds:{min:[-5,-5],max:[5,5]},groundY:0,margin:.5}},physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},
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
    expect(result.state.reports.worldAdmission).toMatchObject({status:'rejected',reasons:['ASSET_UNRESOLVED','ASSET_ADMISSION_REJECTED']});
  });

  it('auto-composes a missing asset position before spawning and records deterministic layout evidence',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'crate',type:'container',source:{kind:'builtin'},actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.5,.5,.5],translation:[0,.5,0]}]}});
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],coverage:{objects:1,relations:0}};
    const spawned=[];
    const runtime={
      events:null,trace:null,assets,assetLibrary:{resolve:vi.fn()},
      environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},
      physics:{manifestPoseClear:vi.fn((_manifest,position)=>Math.abs(position[0])<.1&&Math.abs(position[2])<.1
        ? {checked:true,clear:false,blockedBy:['environment:center-obstacle']}
        : {checked:true,clear:true,blockedBy:[]})},
      spawn:vi.fn(async(assetId,{position,id})=>{spawned.push({assetId,position,id});return id;}),
      interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},
      validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),store:{get:vi.fn()}
    };
    const result=await createWorldPipeline(runtime).run({name:'Auto Layout',assets:[{id:'crate_01',assetId:'crate'}]});
    expect(result.state.reports.layoutAdmission).toMatchObject({status:'ready',placements:[{id:'crate_01',assetId:'crate',mode:'auto',coverage:'full-root'}]});
    expect(result.state.reports.layoutAdmission.placements[0].position).not.toEqual([0,.01,0]);
    expect(runtime.spawn).toHaveBeenCalledWith('crate',{
      position:result.state.reports.layoutAdmission.placements[0].position,id:'crate_01'
    });
    expect(result.state.reports.worldAdmission).toMatchObject({status:'ready',layout:{status:'ready'}});
  });


  it('applies NEAR without an LLM-authored distance using Runtime-derived collider spacing',async()=>{
    const assets=new AssetManager();
    const table={id:'near_table',type:'table',source:{kind:'builtin'},actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[1,.5,.7],translation:[0,.5,0]}]}};
    const cabinet={id:'near_cabinet',type:'cabinet',source:{kind:'builtin'},actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.6,.8,.5],translation:[0,.8,0]}]}};
    assets.registerManifest(table); assets.registerManifest(cabinet);
    const records=new Map();
    const position=(v)=>({x:v[0],y:v[1],z:v[2],toArray(){return [this.x,this.y,this.z];},fromArray(next){[this.x,this.y,this.z]=next;return this;}});
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],coverage:{objects:2,relations:1}};
    const move=vi.fn((id,next)=>records.get(id).object.position.fromArray(next));
    const runtime={
      events:null,trace:null,assets,assetLibrary:{resolve:vi.fn()},
      environment:{layout:{bounds:{min:[-5,-5],max:[5,5]},groundY:0,margin:.5}},
      physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},
      spawn:vi.fn(async(assetId,{position:at,id})=>{records.set(id,{id,assetId,manifest:assets.getManifest(assetId),object:{position:position(at)}});return id;}),
      interactions:{place:vi.fn(),move},sceneGraph:{changed:vi.fn(),update:vi.fn()},
      validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),
      store:{get:(id)=>records.get(id)}
    };
    const result=await createWorldPipeline(runtime).run({
      name:'Near Layout',assets:[{id:'table_01',assetId:'near_table'},{id:'cabinet_01',assetId:'near_cabinet'}],
      relations:[{subject:'cabinet_01',predicate:'NEAR',object:'table_01'}]
    });
    const applied=result.state.reports.relationAdmission.applied[0];
    expect(applied).toMatchObject({subject:'cabinet_01',predicate:'NEAR',object:'table_01',mode:'runtime-derived'});
    expect(applied.distance).toBeGreaterThan(2);
    expect(move).toHaveBeenCalledWith('cabinet_01',applied.position);
    expect(result.state.reports.worldAdmission).toMatchObject({status:'ready',relations:{status:'ready'}});
  });


  it('emits a bounded revision context when world acceptance rejects the current revision',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'crate-revision',type:'container',source:{kind:'builtin'},actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.5,.5,.5],translation:[0,.5,0]}]}});
    const records=new Map();
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:1,relations:0}};
    const runtime={
      events:null,trace:null,assets,assetLibrary:{resolve:vi.fn()},
      environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},
      physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},
      spawn:vi.fn(async(assetId,{id})=>{records.set(id,{id,assetId,state:{enabled:false}});return id;}),
      interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},
      validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),
      store:{get:(id)=>records.get(id)}
    };
    const result=await createWorldPipeline(runtime).run({
      schema:'agentscape.world-ir',schemaVersion:1,
      revision:{id:'rev-accept'},provenance:{source:'planner',evidenceRefs:[]},intent:{name:'Acceptance Repair'},
      policy:{generation:{generate:false}},
      entities:[{id:'box_01',asset:{assetId:'crate-revision'}}],spatial:{relations:[],constraints:[]},interactions:[],rules:[],
      acceptance:[{id:'box-enabled',kind:'state-equals',targetId:'box_01',stateKey:'enabled',value:true}]
    });
    expect(result.state.reports.worldAdmission).toMatchObject({status:'rejected',reasons:['WORLD_ACCEPTANCE_FAILED']});
    expect(result.state.artifacts.revisionContext).toMatchObject({
      schema:'agentscape.world-revision-context',baseRevisionId:'rev-accept',
      affected:{seedEntityIds:['box_01'],editableEntityIds:['box_01']},
      findings:[{source:'world-acceptance',code:'A_STATE_MISMATCH',worldRevisionId:'rev-accept'}]
    });
    expect(result.state.artifacts.revisionContext.subgraph.entities.map((entity)=>entity.id)).toEqual(['box_01']);
  });


  it('compiles World IR behavior and loads rules only after successful admission',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'behavior-light',type:'fixture',source:{kind:'builtin'},actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.2,.2,.2]}]}});
    const records=new Map();
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:1,relations:0}};
    const runtime={
      events:null,trace:null,assets,assetLibrary:{resolve:vi.fn()},
      environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},
      spawn:vi.fn(async(assetId,{id})=>{records.set(id,{id,assetId,state:{enabled:false}});return id;}),
      interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},
      validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),store:{get:id=>records.get(id)},
      loadRuleGraph:vi.fn()
    };
    const result=await createWorldPipeline(runtime).run({
      schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-behavior'},provenance:{source:'planner'},intent:{name:'Behavior World'},
      entities:[{id:'light_01',asset:{assetId:'behavior-light'}}],
      spatial:{relations:[],constraints:[]},
      interactions:[{id:'switch-light',targetId:'light_01',capability:'switch',stateKey:'enabled',value:true}],
      rules:[{id:'light-after-switch',event:'switch.clicked',effect:{kind:'set-state',targetId:'light_01',stateKey:'enabled',value:true}}],
      acceptance:[{id:'valid',kind:'world-valid'}]
    });
    expect(result.state.artifacts.behaviorBundle).toMatchObject({worldRevisionId:'rev-behavior',behaviorGraph:{commands:[{commandId:'interaction:switch-light',capability:'SWITCH'}]},ruleGraph:{rules:[{id:'light-after-switch'}]}});
    expect(result.state.reports.behaviorAdmission).toEqual({status:'ready',issues:[]});
    expect(result.state.reports.worldAdmission).toMatchObject({status:'ready',behavior:{status:'ready'}});
    expect(runtime.loadRuleGraph).toHaveBeenCalledWith(result.state.artifacts.behaviorBundle.ruleGraph);
    expect(runtime.currentBehaviorBundle).toEqual(result.state.artifacts.behaviorBundle);
  });


  it('admits backend-neutral PhysicsRequirement before world instantiation',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'physics-crate',type:'container',source:{kind:'builtin'},actions:['move'],physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[.4,.4,.4]}]}});
    const backend=new PhysicsBackend('test',['rigid-body','collision'],{executionModes:['realtime'],qualities:{realtime:true,deterministic:true}});
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:1,relations:0}};
    const runtime={events:null,trace:null,assets,assetLibrary:{resolve:vi.fn()},environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},physics:{backend,manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},spawn:vi.fn(async(_assetId,{id})=>id),interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),store:{get:vi.fn()}};
    const result=await createWorldPipeline(runtime).run({schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-physics'},provenance:{source:'planner'},intent:{name:'Physics World'},entities:[{id:'crate_01',asset:{assetId:'physics-crate'},physicsRequirement:{bodyClass:'rigid',requiredCapabilities:['collision'],executionMode:'realtime',qualityPolicy:{deterministicRequired:true}}}],spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[{id:'valid',kind:'world-valid'}]});
    expect(result.state.artifacts.physicsRequirements).toMatchObject({worldRevisionId:'rev-physics',requirements:[{entityId:'crate_01',bodyClass:'rigid',requiredCapabilities:['rigid-body','collision']}]});
    expect(result.state.reports.physicsAdmission).toMatchObject({status:'ready',backend:{identity:'test'}});
    expect(result.state.reports.worldAdmission).toMatchObject({status:'ready',physics:{status:'ready'}});
    expect(runtime.spawn).toHaveBeenCalledOnce();
    expect(runtime.currentPhysicsRequirements).toEqual(result.state.artifacts.physicsRequirements);
  });

  it('rejects unsupported PhysicsRequirement before spawning any object',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'soft-fixture',type:'object',source:{kind:'builtin'},actions:['move'],physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[.4,.4,.4]}]}});
    const backend=new PhysicsBackend('rigid-only',['rigid-body','collision'],{executionModes:['realtime'],qualities:{realtime:true,deterministic:true}});
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:0,relations:0}};
    const runtime={events:null,trace:null,assets,assetLibrary:{resolve:vi.fn()},environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},physics:{backend,manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},spawn:vi.fn(),interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),store:{get:vi.fn()}};
    const result=await createWorldPipeline(runtime).run({schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-soft'},provenance:{source:'planner'},intent:{name:'Soft World'},entities:[{id:'soft_01',asset:{assetId:'soft-fixture'},physicsRequirement:{bodyClass:'soft',executionMode:'realtime'}}],spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[]});
    expect(result.state.reports.physicsAdmission).toMatchObject({status:'rejected',issues:[{code:'PHYSICS_BACKEND_CAPABILITY_MISSING',entityId:'soft_01',capability:'soft-body'}]});
    expect(result.state.reports.worldAdmission).toMatchObject({status:'rejected',reasons:['PHYSICS_BACKEND_CAPABILITY_MISSING']});
    expect(runtime.spawn).not.toHaveBeenCalled();
  });

});
