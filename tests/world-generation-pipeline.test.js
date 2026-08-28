import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../src/assets/AssetManager.js';
import { AssetCatalog } from '../src/assets/AssetCatalog.js';
import { createCanonicalWorldPipeline, createWorldPipeline } from '../src/pipeline/createWorldPipeline.js';
import { PhysicsBackend } from '../src/runtime/physics/PhysicsBackend.js';
import { createDefaultProviderRegistry } from '../src/providers/ProviderRegistry.js';
import { createLegacyAssetAuthoring, createLegacyAssetGenerationPort } from '../src/authoring/LegacyAuthoringShell.js';

const physicsProfile=(backend,{runtimeCapabilities=[]}={})=>({
  identity:backend.identity,
  backendCapabilities:[...backend.capabilities],
  runtimeCapabilities:[...runtimeCapabilities],
  capabilities:[...new Set([...backend.capabilities,...runtimeCapabilities])],
  executionModes:[...backend.executionModes],
  qualities:{...backend.qualities}
});

describe('generated world pipeline',()=>{

  it('keeps Runtime canonical pipeline strict while the legacy entry remains an explicit compatibility boundary',async()=>{
    const runtime={events:null,trace:null};
    await expect(createCanonicalWorldPipeline(runtime).run({name:'legacy'})).rejects.toMatchObject({code:'WORLD_IR_SCHEMA_REQUIRED'});
    const compatible=await createWorldPipeline({
      events:null,trace:null,
      assets:{has:()=>false},assetCatalog:{resolveExisting:(query)=>({status:'missing',query,assets:[]})},
      environment:{layout:{}},physics:{manifestPoseClear:()=>({checked:true,clear:true,blockedBy:[]})},
      spawn:async()=>null,interactions:{place:()=>{},move:()=>{}},sceneGraph:{changed:()=>{},update:()=>{}},
      validator:{run:()=>({counts:{hard:0,advisory:0},findings:[]})},repair:{repair:async()=>{}},serialize:()=>({}),store:{get:()=>null}
    }).run({name:'legacy',assets:[{id:'missing',query:'missing'}]});
    expect(compatible.state.artifacts).toMatchObject({
      worldIR:{schema:'agentscape.world-ir',provenance:{source:'legacy-world-spec'}},
      worldSpec:{schema:1,name:'legacy'}
    });
  });
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
    const providerRegistry=createDefaultProviderRegistry({generator});
    const generationPort=createLegacyAssetGenerationPort({providerRegistry,generation:null,assetManager:assets});
    const assetCatalog=new AssetCatalog({assetManager:assets});
    const authoring=createLegacyAssetAuthoring({assetManager:assets,catalog:assetCatalog,generationPort});
    const spawned=[];
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],coverage:{objects:1,relations:0}};
    const runtime={
      events:null,trace:null,assets,assetCatalog,authoring,
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
      provisional:[{assetId:'eg-workbench',reasons:['FALLBACK_BOX_COLLIDER','UNVERIFIED_PROVIDER_SEMANTICS','COMPILER_UNVERIFIED']}]
    });
    expect(result.state.reports.worldAdmission).toMatchObject({
      status:'provisional',reasons:['ASSET_PROVISIONAL'],validation:{hard:0,advisory:0},assets:{status:'provisional'}
    });
    expect(result.state.artifacts.scene).toEqual({schema:'agentscape.scene',name:'Generated Lab',objects:['bench_01']});
    expect(result.timeline.map((x)=>x.name)).toEqual(['normalize_spec','resolve_assets','asset_admission','compose_layout','behavior_admission','physics_admission','instantiate','apply_relations','validate','repair','finalize']);
  });

  it('marks a world rejected when a required generated asset cannot be resolved',async()=>{
    const assets=new AssetManager();
    const assetCatalog=new AssetCatalog({assetManager:assets});
    const authoring={resolveAssetRequest:vi.fn(async(request)=>({status:'generator_not_configured',query:request.query || request.type || '',assets:[],hint:'configure generator'}))};
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],coverage:{objects:0,relations:0}};
    const runtime={
      events:null,trace:null,assets,assetCatalog,authoring,spawn:vi.fn(),
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
    expect(result.state.reports.layoutAdmission).toMatchObject({status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED'});
    expect(result.state.reports.behaviorAdmission).toMatchObject({status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED'});
    expect(result.state.reports.physicsAdmission).toMatchObject({status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED'});
    expect(result.state.reports.relationAdmission).toMatchObject({status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'});
    expect(result.state.reports.worldAdmission).toMatchObject({status:'rejected',reasons:['ASSET_UNRESOLVED']});
    expect(result.state.artifacts.revisionContext).toMatchObject({
      baseRevisionId:'legacy-root',affected:{seedEntityIds:['missing_01'],editableEntityIds:['missing_01']},
      findings:[{source:'world-asset-admission',code:'ASSET_GENERATOR_NOT_CONFIGURED',affectedObjects:['missing_01']}]
    });
    expect(result.state.artifacts.revisionContext.findings).toHaveLength(1);
  });

  it('auto-composes a missing asset position before spawning and records deterministic layout evidence',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'crate',type:'container',source:{kind:'builtin'},actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.5,.5,.5],translation:[0,.5,0]}]}});
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],coverage:{objects:1,relations:0}};
    const spawned=[];
    const runtime={
      events:null,trace:null,assets,assetCatalog:new AssetCatalog({assetManager:assets}),
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
      events:null,trace:null,assets,
      environment:{layout:{bounds:{min:[-5,-5],max:[5,5]},groundY:0,margin:.5}},
      physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},
      spawn:vi.fn(async(assetId,{position:at,id})=>{records.set(id,{id,assetId,manifest:assets.getManifest(assetId),object:{position:position(at)}});return id;}),
      interactions:{place:vi.fn(),move},sceneGraph:{changed:vi.fn(),update:vi.fn()},
      validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),
      store:{get:(id)=>records.get(id)},
      currentWorldRevision:{revision:{id:'rev-old'},provenance:{source:'existing'}},
      lastAcceptanceBundle:{worldRevisionId:'rev-old',result:{status:'world-accepted'}}
    };
    const result=await createWorldPipeline(runtime).run({
      name:'Near Layout',assets:[{id:'table_01',assetId:'near_table'},{id:'cabinet_01',assetId:'near_cabinet'}],
      relations:[{subject:'cabinet_01',predicate:'NEAR',object:'table_01'}]
    });
    const applied=result.state.reports.relationAdmission.applied[0];
    expect(applied).toMatchObject({subject:'cabinet_01',predicate:'NEAR',object:'table_01',mode:'runtime-derived'});
    expect(applied.distance).toBeGreaterThan(2);
    expect(move).toHaveBeenCalledWith('cabinet_01',applied.position,{silent:true});
    expect(result.state.reports.worldAdmission).toMatchObject({status:'ready',relations:{status:'ready'}});
  });


  it('applies ON as a silent compiler mutation instead of a user interaction event',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'cup-silent',type:'prop',source:{kind:'builtin'},actions:['move','pickup','drop','place'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.1,.1,.1],translation:[0,.1,0]}]}});
    assets.registerManifest({id:'table-silent',type:'table',source:{kind:'builtin'},actions:['move'],surfaces:[{id:'top'}],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[1,.4,.7],translation:[0,.4,0]}]}});
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],coverage:{objects:2,relations:1}};
    const place=vi.fn(()=>({id:'cup_01',targetId:'table_01',position:[0,.8,0]}));
    const runtime={
      events:null,trace:null,assets,
      environment:{layout:{bounds:{min:[-5,-5],max:[5,5]},groundY:0,margin:.5}},
      physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},
      spawn:vi.fn(async(_assetId,{id})=>id),interactions:{place,move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},
      validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),store:{get:vi.fn()}
    };
    const result=await createWorldPipeline(runtime).run({
      name:'On Layout',
      assets:[{id:'cup_01',assetId:'cup-silent',position:[-1,.01,0]},{id:'table_01',assetId:'table-silent',position:[1,.01,0]}],
      relations:[{subject:'cup_01',predicate:'ON',object:'table_01',surfaceId:'top'}]
    });
    expect(place).toHaveBeenCalledWith('cup_01','table_01',{surfaceId:'top',silent:true});
    expect(result.state.reports.relationAdmission).toMatchObject({status:'ready',applied:[{subject:'cup_01',predicate:'ON',object:'table_01'}]});
  });


  it('emits a bounded revision context when world acceptance rejects the current revision',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'crate-revision',type:'container',source:{kind:'builtin'},actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.5,.5,.5],translation:[0,.5,0]}]}});
    const records=new Map();
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:1,relations:0}};
    const runtime={
      events:null,trace:null,assets,
      environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},
      physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},
      spawn:vi.fn(async(assetId,{id})=>{records.set(id,{id,assetId,state:{enabled:false}});return id;}),
      interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},
      validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),
      store:{get:(id)=>records.get(id)},
      currentWorldRevision:{revision:{id:'rev-old'},provenance:{source:'existing'}},
      lastAcceptanceBundle:{worldRevisionId:'rev-old',result:{status:'world-accepted'}}
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
    expect(result.state.artifacts.acceptanceEvidence).toMatchObject({worldRevisionId:'rev-accept',result:{status:'world-incomplete'}});
    expect(runtime.currentWorldRevision).toEqual({revision:{id:'rev-old'},provenance:{source:'existing'}});
    expect(runtime.lastAcceptanceBundle).toEqual({worldRevisionId:'rev-old',result:{status:'world-accepted'}});
  });


  it('compiles World IR behavior and loads rules only after successful admission',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'behavior-light',type:'fixture',source:{kind:'builtin'},actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.2,.2,.2]}]}});
    const records=new Map();
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:1,relations:0}};
    const runtime={
      events:null,trace:null,assets,
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


  it('emits bounded revision scope from a behavior admission rejection before instantiation',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'static-door',type:'fixture',source:{kind:'builtin'},actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.4,.8,.1]}]}});
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:0,relations:0}};
    const runtime={events:null,trace:null,assets,environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},spawn:vi.fn(),interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),store:{get:vi.fn()},currentWorldRevision:{revision:{id:'rev-old'},provenance:{source:'existing'}},restoredAcceptanceEvidence:{worldRevisionId:'rev-old'},lastAcceptanceBundle:{worldRevisionId:'rev-old',result:{status:'world-accepted'}}};
    const result=await createWorldPipeline(runtime).run({
      schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-behavior-reject'},provenance:{source:'planner'},intent:{name:'Behavior Reject'},
      entities:[{id:'door_01',asset:{assetId:'static-door'},capabilityIntent:['open']}],spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[{id:'door-exists',kind:'object-exists',targetId:'door_01'}]
    });
    expect(result.state.reports.behaviorAdmission).toMatchObject({status:'rejected',issues:[{code:'BEHAVIOR_CAPABILITY_INTENT_UNSUPPORTED',targetId:'door_01'}]});
    expect(result.state.reports.relationAdmission).toMatchObject({status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'});
    expect(result.state.reports.validation).toMatchObject({status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED',counts:{hard:0,advisory:0}});
    expect(result.state.reports.validationAfterRepair).toMatchObject({status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'});
    expect(runtime.validator.run).not.toHaveBeenCalled();
    expect(result.state.reports.worldAcceptance).toEqual({status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'});
    expect(result.state.reports.worldAdmission.acceptance).toEqual({status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'});
    expect(result.state.artifacts).not.toHaveProperty('acceptanceEvidence');
    expect(runtime.lastAcceptanceBundle).toEqual({worldRevisionId:'rev-old',result:{status:'world-accepted'}});
    expect(result.state.artifacts.revisionContext).toMatchObject({
      baseRevisionId:'rev-behavior-reject',affected:{seedEntityIds:['door_01'],editableEntityIds:['door_01']},
      findings:[{source:'world-behavior-admission',code:'BEHAVIOR_CAPABILITY_INTENT_UNSUPPORTED',affectedObjects:['door_01']}]
    });
    expect(result.state.artifacts.revisionContext.findings).toHaveLength(1);
    expect(runtime.currentWorldRevision).toEqual({revision:{id:'rev-old'},provenance:{source:'existing'}});
    expect(runtime.restoredAcceptanceEvidence).toEqual({worldRevisionId:'rev-old'});
    expect(runtime.spawn).not.toHaveBeenCalled();
  });

  it('admits backend-neutral PhysicsRequirement before world instantiation',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'physics-crate',type:'container',source:{kind:'builtin'},actions:['move'],physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[.4,.4,.4]}]}});
    const backend=new PhysicsBackend('test',['rigid-body','collision'],{executionModes:['realtime'],qualities:{realtime:true,deterministic:true}});
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:1,relations:0}};
    const runtime={events:null,trace:null,assets,environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},physics:{backend,profile:()=>physicsProfile(backend),manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},spawn:vi.fn(async(_assetId,{id})=>id),interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),store:{get:vi.fn()}};
    const result=await createWorldPipeline(runtime).run({schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-physics'},provenance:{source:'planner'},intent:{name:'Physics World'},entities:[{id:'crate_01',asset:{assetId:'physics-crate'},physicsRequirement:{bodyClass:'rigid',requiredCapabilities:['collision'],executionMode:'realtime',qualityPolicy:{deterministicRequired:true}}}],spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[{id:'valid',kind:'world-valid'}]});
    expect(result.state.artifacts.physicsRequirements).toMatchObject({worldRevisionId:'rev-physics',requirements:[{entityId:'crate_01',bodyClass:'rigid',requiredCapabilities:['rigid-body','collision']}]});
    expect(result.state.reports.physicsAdmission).toMatchObject({status:'ready',backend:{identity:'test'}});
    expect(result.state.reports.worldAdmission).toMatchObject({status:'ready',physics:{status:'ready'}});
    expect(result.state.reports.worldAcceptance.checks[0].evidence.validation).toEqual(result.state.reports.validationAfterRepair);
    expect(runtime.lastAcceptanceBundle).toEqual(result.state.artifacts.acceptanceEvidence);
    expect(runtime.lastAcceptanceBundle).toMatchObject({worldRevisionId:'rev-physics',result:{status:'world-accepted'}});
    expect(runtime.validator.run).toHaveBeenCalledOnce();
    expect(runtime.spawn).toHaveBeenCalledOnce();
    expect(runtime.currentPhysicsRequirements).toEqual(result.state.artifacts.physicsRequirements);
  });

  it('rejects unsupported PhysicsRequirement before spawning any object',async()=>{
    const assets=new AssetManager();
    assets.registerManifest({id:'soft-fixture',type:'object',source:{kind:'builtin'},actions:['move'],physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[.4,.4,.4]}]}});
    const backend=new PhysicsBackend('rigid-only',['rigid-body','collision'],{executionModes:['realtime'],qualities:{realtime:true,deterministic:true}});
    const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:0,relations:0}};
    const runtime={events:null,trace:null,assets,environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},physics:{backend,profile:()=>physicsProfile(backend),manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},spawn:vi.fn(),interactions:{place:vi.fn(),move:vi.fn()},sceneGraph:{changed:vi.fn(),update:vi.fn()},validator:{run:vi.fn(()=>structuredClone(validation))},repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),store:{get:vi.fn()},currentWorldRevision:{revision:{id:'rev-old'},provenance:{source:'existing'}},lastAcceptanceBundle:{worldRevisionId:'rev-old',result:{status:'world-accepted'}}};
    const result=await createWorldPipeline(runtime).run({schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-soft'},provenance:{source:'planner'},intent:{name:'Soft World'},entities:[{id:'soft_01',asset:{assetId:'soft-fixture'},physicsRequirement:{bodyClass:'soft',executionMode:'realtime'}}],spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[{id:'soft-exists',kind:'object-exists',targetId:'soft_01'}]});
    expect(result.state.reports.physicsAdmission).toMatchObject({status:'rejected',issues:[{code:'PHYSICS_BACKEND_CAPABILITY_MISSING',entityId:'soft_01',capability:'soft-body'}]});
    expect(result.state.reports.relationAdmission).toMatchObject({status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'});
    expect(result.state.reports.validation).toMatchObject({status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED',counts:{hard:0,advisory:0}});
    expect(result.state.reports.validationAfterRepair).toMatchObject({status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'});
    expect(runtime.validator.run).not.toHaveBeenCalled();
    expect(result.state.reports.worldAdmission).toMatchObject({status:'rejected',reasons:['PHYSICS_BACKEND_CAPABILITY_MISSING'],acceptance:{status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'}});
    expect(result.state.reports.worldAcceptance).toEqual({status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED'});
    expect(result.state.artifacts).not.toHaveProperty('acceptanceEvidence');
    expect(runtime.lastAcceptanceBundle).toEqual({worldRevisionId:'rev-old',result:{status:'world-accepted'}});
    expect(result.state.artifacts.revisionContext).toMatchObject({
      baseRevisionId:'rev-soft',affected:{seedEntityIds:['soft_01'],editableEntityIds:['soft_01']},
      findings:[{source:'world-physics-admission',code:'PHYSICS_BACKEND_CAPABILITY_MISSING',affectedObjects:['soft_01']}]
    });
    expect(runtime.spawn).not.toHaveBeenCalled();
  });

});


it('runs rich World IR without routing semantic fields through legacy WorldSpec',async()=>{
  const assets=new AssetManager();
  assets.registerManifest({id:'stateful-box',type:'container',source:{kind:'builtin'},actions:['pickup','move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.5,.5,.5]}]}});
  const validation={ok:true,counts:{hard:0,advisory:0},hard:[],advisory:[],findings:[],coverage:{objects:1,relations:0}};
  const runtime={
    events:null,trace:null,assets,
    environment:{layout:{bounds:{min:[-4,-4],max:[4,4]},groundY:0,margin:.5}},
    physics:{manifestPoseClear:vi.fn(()=>({checked:true,clear:true,blockedBy:[]}))},
    spawn:vi.fn(async(_assetId,{id})=>id),interactions:{place:vi.fn(),move:vi.fn()},
    sceneGraph:{changed:vi.fn(),update:vi.fn()},validator:{run:vi.fn(()=>structuredClone(validation))},
    repair:{repair:vi.fn()},serialize:vi.fn(()=>({schema:'agentscape.scene'})),store:{get:vi.fn()}
  };

  runtime.restoredAcceptanceEvidence={worldRevisionId:'stale-revision'};
  const result=await createWorldPipeline(runtime).run({
    schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-state'},provenance:{source:'planner'},intent:{name:'Stateful World'},
    entities:[{id:'box_01',asset:{assetId:'stateful-box'},capabilityIntent:['pickup'],initialState:{enabled:true}}],
    spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[]
  });

  expect(result.state.artifacts.compilation).toMatchObject({schema:'agentscape.world-compilation',worldRevisionId:'rev-state'});
  expect(runtime.spawn).toHaveBeenCalledWith('stateful-box',{position:expect.any(Array),id:'box_01',initialState:{enabled:true}});
  expect(result.state.artifacts).not.toHaveProperty('worldSpec');
  expect(result.state.reports.worldAdmission.status).toBe('ready');
  expect(runtime.currentWorldRevision).toMatchObject({revision:{id:'rev-state'},provenance:{source:'planner'}});
  expect(runtime.restoredAcceptanceEvidence).toBeNull();
});
