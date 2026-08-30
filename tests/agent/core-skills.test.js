import { describe, expect, it, vi } from 'vitest';
import { SkillRegistry } from '../../agent/skills/SkillRegistry.js';
import { PolicyEngine } from '../../core/PolicyEngine.js';
import { TraceRecorder } from '../../core/TraceRecorder.js';
import { registerCoreSkills } from '../../agent/skills/registerCoreSkills.js';

function runtime() {
  let value = 0;
  const r = {
    events: { emit: vi.fn() },
    policy: new PolicyEngine(),
    trace: new TraceRecorder(),
    snapshot: vi.fn(() => ({ value })),
    restore: vi.fn(async (scene) => { value = scene.value; }),
    mutate: vi.fn(async (_label, fn) => fn()),
    clearObjects:vi.fn(async()=>{}),loadRuleGraph:vi.fn(),
    assetCatalog: { list:()=>[], search:()=>[], summary:(x)=>x },
    generation: { canGenerateAsset:()=>false, generateAsset:async(prompt)=>({status:'generator_not_configured',prompt}) },
    assets: {
      registerManifest:vi.fn(),has:()=>true,
      getManifest:vi.fn((id)=>({id,type:'object',source:{kind:'builtin'},actions:['move'],physics:{body:'fixed',colliders:[]}}))
    },
    listObjects: () => [],
    spawn: vi.fn(async () => { value += 1; return 'x'; }),
    interactions: {
      move: vi.fn(), pickup: vi.fn(), drop: vi.fn(), place: vi.fn(), setArticulationAction: vi.fn(),
      findInteractionPose:vi.fn(async()=>({status:'approach-pose',position:[1,0,1]})),
      approachAndInteract:vi.fn(async()=>({status:'action-completed',actorId:'agent_01',targetId:'cabinet_01',action:'open',targetReached:true,settled:true})),
      articulationStatus:vi.fn(()=>({id:'cabinet_01',parts:[{partName:'door',status:'action-completed',verifiedAction:'open',requestedAction:null}]})),
      approachAndPickup:vi.fn(async()=>({status:'held',actorId:'agent_01',targetId:'cup_01',graspVerified:false})),
      approachAndPlace:vi.fn(async()=>({status:'placed',actorId:'agent_01',targetId:'table_01',heldId:'cup_01',supportVerified:true})),
      dropHeld:vi.fn(()=>({status:'dropped',actorId:'agent_01',targetId:'cup_01'})),
      carryStatus:vi.fn(()=>({status:'held',actorId:'agent_01',targetId:'cup_01',graspVerified:false}))
    },
    duplicate: vi.fn(), remove: vi.fn(),
    spatial: { getBounds:vi.fn(), findNearby:vi.fn(), raycast:vi.fn(), isColliding:vi.fn(), getSupportSurface:vi.fn(), findFreeSpace:vi.fn() },
    navigation: { canReach:vi.fn(async()=>({reachable:true,cost:3})), findPath:vi.fn(async()=>({reachable:true,path:[[0,0,0],[3,0,0]],cost:3})), suggestActions:vi.fn(async()=>({status:'action-candidate'})), status:vi.fn(()=>({state:'ready'})) },
    sceneGraph: { list:vi.fn(()=>[]), describe:vi.fn(), update:vi.fn() },
    validator: { run:vi.fn(()=>({ ok:true, counts:{hard:0,advisory:0}, hard:[], advisory:[], coverage:{objects:0,relations:0} })) },
    repair: { repair:vi.fn() },
    worldPipeline: { run:vi.fn() }
  };
  r.getValue = () => value;
  return r;
}

describe('core skills', () => {
  it('atomically rolls back a batch when a nested skill fails', async () => {
    const r = runtime();
    const registry = registerCoreSkills(new SkillRegistry({ policy:r.policy, trace:r.trace, runtime:r }), r);
    r.skills = registry;
    const result = await registry.invoke('executeBatch', { calls: [
      { name:'spawnAsset', args:{ assetId:'chair', position:[0,0,0] } },
      { name:'moveObject', args:{ id:'missing-position' } }
    ] }, { profile:'builder', actor:'test' });
    expect(result.success).toBe(true);
    expect(result.result.committed).toBe(false);
    expect(result.result.rolledBack).toBe(true);
    expect(r.restore).toHaveBeenCalled();
    expect(r.getValue()).toBe(0);
  });

  it('surfaces provisional/rejected asset admission on low-level spawn without pretending verification', async () => {
    const r=runtime();
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);

    r.assets.getManifest=vi.fn(()=>({id:'eg',type:'object',source:{kind:'glb',url:'https://assets.test/eg.glb'},actions:['move'],physics:{body:'dynamic',colliders:[]},provenance:{admission:{status:'provisional',reasons:['UNVERIFIED_PROVIDER_SEMANTICS']}}}));
    const provisional=await registry.invoke('spawnAsset',{assetId:'eg',position:[0,0,0],instanceId:'eg_01'},{profile:'builder',actor:'test'});
    expect(provisional).toMatchObject({success:true,result:{status:'asset-provisional',id:'x',assetId:'eg',admission:{status:'provisional'}}});
    expect(registry.executionPolicy('spawnAsset',provisional.result).outcome).toMatchObject({state:'unverified',verified:false,reason:'ASSET_PROVISIONAL'});

    r.spawn.mockClear();
    r.assets.getManifest=vi.fn(()=>({id:'bad',type:'object',source:{kind:'glb',url:'https://assets.test/bad.glb'},actions:['move'],physics:{body:'fixed',colliders:[]},compiler:{quality:{status:'rejected'}}}));
    const rejected=await registry.invoke('spawnAsset',{assetId:'bad',position:[0,0,0]},{profile:'builder',actor:'test'});
    expect(rejected).toMatchObject({success:true,result:{status:'asset-rejected',assetId:'bad',admission:{status:'rejected'}}});
    expect(r.spawn).not.toHaveBeenCalled();
    expect(registry.executionPolicy('spawnAsset',rejected.result).outcome).toMatchObject({state:'failed',verified:false,reason:'ASSET_REJECTED'});
  });


  it('world pipeline cannot bypass asset permissions', async () => {
    const r = runtime();
    r.policy = new PolicyEngine({ profiles: { worldOnly: ['world.write'] } });
    const registry = registerCoreSkills(new SkillRegistry({ policy:r.policy, trace:r.trace, runtime:r }), r);
    const result = await registry.invoke('runWorldPipeline', { plan:{} }, { profile:'worldOnly' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('forbidden');
    expect(r.worldPipeline.run).not.toHaveBeenCalled();
  });
  it('requires generation authority and never allows runWorldPipeline inside executeBatch', async () => {
    const r=runtime();
    r.policy=new PolicyEngine({profiles:{
      worldNoGeneration:['world.write','asset.read','asset.write','physics.read'],
      builder:['generation.read','generation.submit','artifact.import','world.write','asset.read','asset.write','physics.read']
    }});
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const denied=await registry.invoke('runWorldPipeline',{plan:{}},{profile:'worldNoGeneration',actor:'test'});
    expect(denied).toMatchObject({success:false,error:{code:'forbidden'}});
    expect(denied.error.message).toContain('generation.read');
    expect(denied.error.message).toContain('generation.submit');
    expect(denied.error.message).toContain('artifact.import');
    expect(registry.authorization('runWorldPipeline',{profile:'builder'}).required).toEqual([
      'generation.read','generation.submit','artifact.import','world.write','asset.read','asset.write','physics.read'
    ]);
    expect(registry.executionPolicy('runWorldPipeline')).toMatchObject({mutates:true,barrier:true,batchable:false});

    const batch=await registry.invoke('executeBatch',{calls:[{name:'runWorldPipeline',args:{plan:{}}}]},{profile:'builder',actor:'test'});
    expect(batch).toMatchObject({success:true,result:{committed:false,rolledBack:false,reason:'UNBATCHABLE_SKILL',skill:'runWorldPipeline'}});
    expect(r.worldPipeline.run).not.toHaveBeenCalled();
  });

  it('does not expose pipeline stage selection to the agent tool', async () => {
    const r=runtime();
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const def=registry.definitions().find((item)=>item.name==='runWorldPipeline');
    expect(def.parameters.properties.plan).toMatchObject({
      type:'object',additionalProperties:false,
      required:['schema','schemaVersion','revision','provenance','intent','entities','spatial','interactions','rules','acceptance'],
      properties:{
        schema:{enum:['agentscape.world-ir']},schemaVersion:{enum:[1]},revision:{type:'object'},provenance:{type:'object'},
        entities:{type:'array'},spatial:{type:'object'},interactions:{type:'array'},rules:{type:'array'},acceptance:{type:'array'}
      }
    });
    expect(def.parameters.properties.plan.properties.spatial.properties).not.toHaveProperty('constraints');
    r.worldPipeline.run=vi.fn(async()=>({state:{reports:{worldAdmission:{status:'ready',reasons:[]}}},timeline:[]}));
    await registry.invoke('runWorldPipeline',{plan:{},stages:['instantiate']},{profile:'builder',actor:'test'});
    expect(r.worldPipeline.run).toHaveBeenCalledWith({});
  });


  it('classifies world pipeline admission and restores a rejected generated world', async () => {
    const r=runtime();
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);

    r.worldPipeline.run=vi.fn(async()=>({state:{reports:{worldAdmission:{status:'ready',reasons:[]}}},timeline:[]}));
    const ready=await registry.invoke('runWorldPipeline',{plan:{}},{profile:'builder',actor:'test'});
    expect(ready).toMatchObject({success:true,result:{status:'world-ready',admission:{status:'ready'}}});
    expect(registry.executionPolicy('runWorldPipeline',ready.result).outcome).toMatchObject({state:'verified',verified:true,status:'world-ready'});

    r.worldPipeline.run=vi.fn(async()=>({state:{reports:{worldAdmission:{status:'provisional',reasons:['ASSET_PROVISIONAL']}}},timeline:[]}));
    const provisional=await registry.invoke('runWorldPipeline',{plan:{}},{profile:'builder',actor:'test'});
    expect(provisional).toMatchObject({success:true,result:{status:'world-provisional',admission:{status:'provisional'}}});
    expect(registry.executionPolicy('runWorldPipeline',provisional.result).outcome).toMatchObject({state:'unverified',verified:false,status:'world-provisional',reason:'WORLD_PROVISIONAL'});

    r.restore.mockClear();
    r.worldPipeline.run=vi.fn(async()=>({state:{reports:{worldAdmission:{status:'rejected',reasons:['ASSET_UNRESOLVED']}}},timeline:[]}));
    const rejected=await registry.invoke('runWorldPipeline',{plan:{}},{profile:'builder',actor:'test'});
    expect(rejected).toMatchObject({success:true,result:{status:'world-rejected',reason:'ASSET_UNRESOLVED',rolledBack:true,admission:{status:'rejected'}}});
    expect(r.restore).toHaveBeenCalledOnce();
    expect(registry.executionPolicy('runWorldPipeline',rejected.result).outcome).toMatchObject({state:'failed',verified:false,reason:'ASSET_UNRESOLVED'});
  });


  it('retries one canonical world pipeline attempt by enabling generation only for search-missing assets', async () => {
    const r=runtime();
    r.generation.canGenerateAsset=()=>true;
    r.generation.generateAsset=vi.fn(async()=>({id:'generated_machine_01',status:'asset-ready'}));
    const plan={
      schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-1'},provenance:{source:'planner'},intent:{name:'Lab'},
      entities:[{id:'machine_01',asset:{query:'rare machine',generate:false}}],spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[]
    };
    const first={state:{
      artifacts:{worldIR:structuredClone(plan)},
      reports:{
        assetAdmission:{status:'rejected',unresolved:[{id:'machine_01',query:'rare machine',status:'missing'}],provisional:[]},
        layoutAdmission:{status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED',placements:[],issues:[]},
        behaviorAdmission:{status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED',issues:[]},
        physicsAdmission:{status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED',issues:[]},
        relationAdmission:{status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED',applied:[],issues:[]},
        validation:{status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED',counts:{hard:0,advisory:0},hard:[],advisory:[]},
        worldAdmission:{status:'rejected',reasons:['ASSET_UNRESOLVED']}
      }
    },timeline:[]};
    const second={state:{reports:{worldAdmission:{status:'ready',reasons:[]}}},timeline:[]};
    r.worldPipeline.run=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const result=await registry.invoke('runWorldPipeline',{plan},{profile:'builder',actor:'test'});
    expect(result).toMatchObject({success:true,result:{
      status:'world-ready',attempts:[{attempt:1,retry:{status:'retry-proposed',actions:[{kind:'enable-generation',instanceId:'machine_01'}]}},{attempt:2,admission:{status:'ready'}}],
      retry:{status:'retry-proposed',retriable:true}
    }});
    expect(r.worldPipeline.run).toHaveBeenCalledTimes(2);
    expect(r.worldPipeline.run.mock.calls[1][0]).toMatchObject({
      schema:'agentscape.world-ir',revision:{id:'rev-1:retry-2',parentId:'rev-1'},
      entities:[{id:'machine_01',asset:{assetId:'generated_machine_01',query:'rare machine',generate:true}}]
    });
    expect(r.restore).toHaveBeenCalledOnce();
    expect(registry.executionPolicy('runWorldPipeline',result.result).outcome).toMatchObject({state:'verified',verified:true,status:'world-ready'});
  });

  it('never exceeds the fixed two-attempt world generation budget', async () => {
    const r=runtime();
    r.generation.canGenerateAsset=()=>true;
    r.generation.generateAsset=vi.fn(async()=>({id:'generated_machine_01',status:'asset-ready'}));
    const basePlan={
      schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-1'},provenance:{source:'planner'},intent:{name:'Lab'},
      entities:[{id:'machine_01',asset:{query:'rare machine',generate:false}}],spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[]
    };
    const rejected=(plan)=>({state:{
      artifacts:{worldIR:structuredClone(plan)},
      reports:{
        assetAdmission:{status:'rejected',unresolved:[{id:'machine_01',query:'rare machine',status:'missing'}],provisional:[]},
        layoutAdmission:{status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED',placements:[],issues:[]},
        behaviorAdmission:{status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED',issues:[]},
        physicsAdmission:{status:'not-evaluated',reason:'UPSTREAM_ASSET_ADMISSION_REJECTED',issues:[]},
        relationAdmission:{status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED',applied:[],issues:[]},
        validation:{status:'not-evaluated',reason:'UPSTREAM_ADMISSION_REJECTED',counts:{hard:0,advisory:0},hard:[],advisory:[]},
        worldAdmission:{status:'rejected',reasons:['ASSET_UNRESOLVED']}
      }
    },timeline:[]});
    const retryPlan=structuredClone(basePlan);
    retryPlan.revision={id:'rev-1:retry-2',parentId:'rev-1',reason:'bounded missing-asset regeneration'};
    retryPlan.entities[0].asset.generate=true;
    r.worldPipeline.run=vi.fn().mockResolvedValueOnce(rejected(basePlan)).mockResolvedValueOnce(rejected(retryPlan));
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const result=await registry.invoke('runWorldPipeline',{plan:basePlan},{profile:'builder',actor:'test'});
    expect(result).toMatchObject({success:true,result:{
      status:'world-rejected',rolledBack:true,retry:{status:'exhausted',attempt:2,budget:2,retriable:false},attempts:[{attempt:1},{attempt:2}]
    }});
    expect(r.worldPipeline.run).toHaveBeenCalledTimes(2);
    expect(r.restore).toHaveBeenCalledTimes(2);
    expect(registry.executionPolicy('runWorldPipeline',result.result).outcome).toMatchObject({state:'failed',verified:false});
  });


  it('viewer can validate but cannot repair', async () => {
    const r = runtime();
    const registry = registerCoreSkills(new SkillRegistry({ policy:r.policy, trace:r.trace, runtime:r }), r);
    expect((await registry.invoke('validateWorld', {}, { profile:'viewer' })).success).toBe(true);
    expect((await registry.invoke('repairWorld', {}, { profile:'viewer' })).error.code).toBe('forbidden');
  });

  it('exposes navigation truth through the same spatial-read SkillRegistry contract', async () => {
    const r = runtime();
    const registry = registerCoreSkills(new SkillRegistry({ policy:r.policy, trace:r.trace, runtime:r }), r);
    const reach = await registry.invoke('canReach', { start:[0,0,0], end:[3,0,0] }, { profile:'viewer' });
    const path = await registry.invoke('findPath', { start:[0,0,0], end:[3,0,0] }, { profile:'viewer' });
    const status = await registry.invoke('getNavigationStatus', {}, { profile:'viewer' });
    const suggestion = await registry.invoke('suggestNavigationActions', { start:[0,0,0], end:[3,0,0] }, { profile:'viewer' });
    expect(reach).toMatchObject({success:true,result:{reachable:true,cost:3}});
    expect(path.result.path).toEqual([[0,0,0],[3,0,0]]);
    expect(status.result).toEqual({state:'ready'});
    expect(suggestion).toMatchObject({success:true,result:{status:'action-candidate'}});
    expect(r.navigation.suggestActions).toHaveBeenCalledWith([0,0,0],[3,0,0],{maxSnapDistance:undefined,maxCandidates:undefined});
    expect(r.navigation.canReach).toHaveBeenCalledWith([0,0,0],[3,0,0],{maxSnapDistance:undefined});
    expect(registry.definitions().find((item)=>item.name==='findPath').parameters.required).toEqual(['start','end']);
  });

  it('exposes embodied interaction pose discovery and wraps approach+open in one mutation', async () => {
    const r = runtime();
    const registry = registerCoreSkills(new SkillRegistry({ policy:r.policy, trace:r.trace, runtime:r }), r);
    const pose = await registry.invoke('findInteractionPose', { actorId:'agent_01', targetId:'cabinet_01' }, { profile:'viewer' });
    expect(pose).toMatchObject({success:true,result:{status:'approach-pose',position:[1,0,1]}});
    const task = await registry.invoke('approachAndInteract', { actorId:'agent_01', targetId:'cabinet_01', action:'open', partName:'door' }, { profile:'builder', actor:'agent_01' });
    expect(task).toMatchObject({success:true,result:{status:'action-completed',actorId:'agent_01',targetId:'cabinet_01',action:'open',targetReached:true,settled:true}});
    const articulation=await registry.invoke('getArticulationStatus',{id:'cabinet_01',partName:'door'},{profile:'viewer'});
    expect(articulation).toMatchObject({success:true,result:{parts:[{status:'action-completed',verifiedAction:'open'}]}});
    expect(r.interactions.approachAndInteract).toHaveBeenCalledWith('agent_01','cabinet_01','open',{partName:'door',speed:undefined});
    expect(r.mutate).toHaveBeenCalledWith('skill:approachAndInteract',expect.any(Function),expect.objectContaining({source:'agent_01',skill:'approachAndInteract'}));
    const definition=registry.definitions().find((item)=>item.name==='approachAndInteract');
    expect(definition.parameters.required).toEqual(['actorId','targetId','action']);
    expect(definition.parameters.properties.action.enum).toEqual(['open','close']);
    expect(definition.parameters.properties.maxDistance).toBeUndefined();
    expect(registry.definitions().find((item)=>item.name==='findInteractionPose').parameters.properties.maxDistance).toBeUndefined();
  });

  it('exposes Agent carry ownership without presenting kinematic attachment as grasp verification', async () => {
    const r=runtime();
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const pickup=await registry.invoke('approachAndPickup',{actorId:'agent_01',targetId:'cup_01'},{profile:'builder',actor:'agent_01'});
    expect(pickup).toMatchObject({success:true,result:{status:'held',targetId:'cup_01',graspVerified:false}});
    expect(r.interactions.approachAndPickup).toHaveBeenCalledWith('agent_01','cup_01',{speed:undefined});
    expect(r.mutate).toHaveBeenCalledWith('skill:approachAndPickup',expect.any(Function),expect.objectContaining({source:'agent_01',skill:'approachAndPickup'}));
    const status=await registry.invoke('getCarryStatus',{actorId:'agent_01'},{profile:'viewer'});
    expect(status).toMatchObject({success:true,result:{status:'held',graspVerified:false}});
    const drop=await registry.invoke('dropHeld',{actorId:'agent_01'},{profile:'builder',actor:'agent_01'});
    expect(drop).toMatchObject({success:true,result:{status:'dropped',targetId:'cup_01'}});
    expect(registry.definitions().find((item)=>item.name==='approachAndPickup').parameters.required).toEqual(['actorId','targetId']);
  });

  it('keeps embodied place inside one async mutation until settle verification resolves', async () => {
    const r=runtime();
    let finish;
    const deferred=new Promise((resolve)=>{finish=resolve;});
    r.interactions.approachAndPlace=vi.fn(()=>deferred);
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const pending=registry.invoke('approachAndPlace',{actorId:'agent_01',supportId:'table_01',surfaceId:'top'},{profile:'builder',actor:'agent_01'});
    await Promise.resolve(); await Promise.resolve();
    expect(r.mutate).toHaveBeenCalledWith('skill:approachAndPlace',expect.any(Function),expect.objectContaining({source:'agent_01',skill:'approachAndPlace'}));
    expect(r.interactions.approachAndPlace).toHaveBeenCalledWith('agent_01','table_01',{surfaceId:'top',speed:undefined});
    let settled=false; pending.then(()=>{settled=true;}); await Promise.resolve();
    expect(settled).toBe(false);
    finish({status:'placed',actorId:'agent_01',targetId:'table_01',heldId:'cup_01',supportVerified:true});
    await expect(pending).resolves.toMatchObject({success:true,result:{status:'placed',supportVerified:true}});
    expect(registry.definitions().find((item)=>item.name==='approachAndPlace').parameters.required).toEqual(['actorId','supportId']);
    expect(registry.definitions().find((item)=>item.name==='approachAndPlace').parameters.properties.surfaceId.description).toMatch(/top/);
  });


  it('refuses unbatchable embodied actions before mutating the world', async () => {
    const r=runtime();
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const result=await registry.invoke('executeBatch',{calls:[
      {name:'spawnAsset',args:{assetId:'chair',position:[0,0,0]}},
      {name:'approachAndInteract',args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'}}
    ]},{profile:'builder',actor:'test'});
    expect(result).toMatchObject({success:true,result:{committed:false,rolledBack:false,reason:'UNBATCHABLE_SKILL',skill:'approachAndInteract',results:[]}});
    expect(r.spawn).not.toHaveBeenCalled();
    expect(r.restore).not.toHaveBeenCalled();
  });

  it('rolls back a batch when a nested skill returns a structured semantic failure without throwing', async () => {
    const r=runtime();
    r.interactions.place=vi.fn(()=>({status:'place-failed',reason:'SUPPORT_NOT_REACHED',supportVerified:false,settled:true}));
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const result=await registry.invoke('executeBatch',{calls:[
      {name:'spawnAsset',args:{assetId:'chair',position:[0,0,0]}},
      {name:'place',args:{id:'cup_01',targetId:'table_01'}}
    ]},{profile:'builder',actor:'test'});
    expect(result).toMatchObject({success:true,result:{committed:false,rolledBack:true,reason:'SEMANTIC_STEP_NOT_VERIFIED'}});
    expect(result.result.results.at(-1)).toMatchObject({name:'place',success:true,outcome:{state:'failed',verified:false,reason:'SUPPORT_NOT_REACHED'}});
    expect(r.restore).toHaveBeenCalledOnce();
    expect(r.getValue()).toBe(0);
  });


  it('registers blocker recovery as auxiliary and suggestion as read-only',()=>{
    const r=runtime(); const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    expect(registry.executionPolicy('suggestRecoveryActions')).toMatchObject({mutates:false,barrier:false,auxiliary:false});
    expect(registry.executionPolicy('recoverPickupBlocker')).toMatchObject({mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false});
    expect(registry.executionPolicy('recoverArticulatedBlocker')).toMatchObject({mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false});
    expect(registry.executionPolicy('suggestRecoveryCleanup')).toMatchObject({mutates:false,barrier:false,auxiliary:false});
    expect(registry.executionPolicy('cleanupRecoveryBlocker')).toMatchObject({mutates:true,barrier:true,auxiliary:true,tracksUnresolved:false,batchable:false});
  });


  it('revalidates articulated blocker recovery before execution and returns recovery-stale when evidence is no longer executable',async()=>{
    const r=runtime();
    r.store={has:vi.fn((id)=>['cabinet_A','cabinet_B'].includes(id)),get:vi.fn((id)=>({
      id,manifest:id==='cabinet_B'?{
        actions:['open','close'],parts:{door:{node:'Door',actions:['open','close'],targets:{open:-1,close:0},physics:{body:'dynamic',colliders:[{}]},joint:{type:'revolute'}}}
      }:{actions:['open','close'],parts:{door:{node:'Door',actions:['open','close'],targets:{open:-1,close:0},physics:{body:'dynamic',colliders:[{}]},joint:{type:'revolute'}}}},state:{parts:{door:id==='cabinet_B'?'open':'close'}}
    }))};
    r.physics={articulationContacts:vi.fn(()=>[])};
    r.interactions.articulationStatus=vi.fn((id)=>id==='cabinet_A'?{
      id,parts:[{partName:'door',status:'action-failed',verifiedAction:'close',requestedAction:null,last:{status:'action-failed',reason:'STALL',action:'open',attribution:{status:'contact-evidence',blockerCandidates:[{kind:'object',objectId:'cabinet_B',partName:'door',colliderIndex:0}]}}}]
    }:{id,parts:[{partName:'door',status:'verified-state',verifiedAction:'open',requestedAction:null}]});
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const result=await registry.invoke('recoverArticulatedBlocker',{
      actorId:'agent_01',targetId:'cabinet_A',partName:'door',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'
    },{profile:'builder',actor:'agent_01'});
    expect(result).toMatchObject({success:true,result:{
      status:'recovery-stale',reason:'CONTACT_EVIDENCE_STALE',actorId:'agent_01',targetId:'cabinet_A',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close',retryOriginal:true
    }});
    expect(r.interactions.approachAndInteract).not.toHaveBeenCalled();
  });


  it('stales an articulated recovery when execution-time world counterfactual detects a new third-object collision',async()=>{
    const r=runtime();
    const candidate={kind:'object',objectId:'cabinet_B',partName:'door',colliderIndex:0};
    const manifests={
      cabinet_A:{actions:['open','close'],parts:{door:{node:'Door',actions:['open','close'],targets:{open:-1,close:0},physics:{body:'dynamic',colliders:[{}]},joint:{type:'revolute'}}}},
      cabinet_B:{actions:['open','close'],parts:{door:{node:'Door',actions:['open','close'],targets:{open:-1,close:0},physics:{body:'dynamic',colliders:[{}]},joint:{type:'revolute'}}}}
    };
    r.store={has:vi.fn((id)=>id in manifests),get:vi.fn((id)=>({id,manifest:manifests[id],state:{parts:{door:id==='cabinet_B'?'open':'close'}}}))};
    r.physics={
      articulationContacts:vi.fn(()=>[{external:true,target:candidate,contactCount:1,activeContactCount:1,minDistance:-.001,totalImpulse:1}]),
      articulationWorldCounterfactual:vi.fn(()=>({
        checked:true,geometry:'rapier-world-shape-query',causal:false,
        targetIntroducesNoCollision:false,actionIntroducesNoCollision:false,
        targetPose:{introducedBlockers:[{key:'object:third_01:$root:0',kind:'object',objectId:'third_01',partName:'$root',colliderIndex:0}]},
        actionEnvelope:{introducedBlockers:[{key:'object:third_01:$root:0',kind:'object',objectId:'third_01',partName:'$root',colliderIndex:0}]}
      }))
    };
    r.interactions.articulationStatus=vi.fn((id)=>id==='cabinet_A'?{
      id,parts:[{partName:'door',status:'action-failed',verifiedAction:'close',requestedAction:null,last:{status:'action-failed',reason:'STALL',action:'open',attribution:{status:'contact-evidence',blockerCandidates:[candidate]}}}]
    }:{id,parts:[{partName:'door',status:'verified-state',verifiedAction:'open',requestedAction:null,live:{coordinate:-1,target:-1,error:0,tolerance:.08}}]});
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const result=await registry.invoke('recoverArticulatedBlocker',{
      actorId:'agent_01',targetId:'cabinet_A',partName:'door',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'
    },{profile:'builder',actor:'agent_01'});
    expect(result).toMatchObject({success:true,result:{
      status:'recovery-stale',reason:'THIRD_OBJECT_COUNTERFACTUAL_BLOCKED',
      actorId:'agent_01',targetId:'cabinet_A',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close',retryOriginal:true
    }});
    expect(r.physics.articulationWorldCounterfactual).toHaveBeenCalledWith('cabinet_B','door',0,{
      excludeObjectIds:['agent_01'],excludeParts:[{objectId:'cabinet_A',partName:'door'}]
    });
    expect(r.interactions.approachAndInteract).not.toHaveBeenCalled();
  });


  it('stales an articulated recovery when execution-time counterfactual ranking selects a different action',async()=>{
    const r=runtime();
    const candidate={kind:'object',objectId:'cabinet_B',partName:'door',colliderIndex:0};
    const manifests={
      cabinet_A:{actions:['open','close'],parts:{door:{node:'Door',actions:['open','close'],targets:{open:-1,close:0},physics:{body:'dynamic',colliders:[{}]},joint:{type:'revolute'}}}},
      cabinet_B:{actions:['open','close'],parts:{door:{node:'Door',actions:['open','close','ajar'],targets:{open:-1.35,close:0,ajar:-.8},physics:{body:'dynamic',colliders:[{}]},joint:{type:'revolute'}}}}
    };
    r.store={has:vi.fn((id)=>id in manifests),get:vi.fn((id)=>({id,manifest:manifests[id],state:{parts:{door:id==='cabinet_B'?'ajar':'close'}}}))};
    r.physics={articulationContacts:vi.fn(()=>[{external:true,target:candidate,contactCount:1,activeContactCount:1,minDistance:-.001,totalImpulse:1}])};
    r.interactions.articulationStatus=vi.fn((id)=>id==='cabinet_A'?{
      id,parts:[{partName:'door',status:'action-failed',verifiedAction:'close',requestedAction:null,last:{status:'action-failed',reason:'STALL',action:'open',attribution:{status:'contact-evidence',blockerCandidates:[candidate]}}}]
    }:{id,parts:[{partName:'door',status:'verified-state',verifiedAction:'ajar',requestedAction:null,live:{coordinate:-.8,target:-.8,error:0,tolerance:.08}}]});
    r.interactions.findInteractionPose=vi.fn(async(_actor,_id,{action,partName})=>({status:'approach-pose',position:[1,0,1],routeCost:action==='open'?1:2,actionSweep:{checked:true,clear:true,partName}}));
    const geometry={
      'cabinet_A:open:sweep':{min:[0,0,0],max:[2,2,2]},
      'cabinet_B:ajar:target':{min:[.5,.2,.5],max:[1.5,1.8,1.5]},
      'cabinet_B:open:target':{min:[3,.2,.5],max:[4,1.8,1.5]},
      'cabinet_B:close:target':{min:[.6,.2,.6],max:[1.4,1.8,1.4]},
      'cabinet_B:open:sweep':{min:[.4,.1,.3],max:[4,1.9,1.7]},
      'cabinet_B:close:sweep':{min:[.4,.1,.3],max:[1.6,1.9,1.7]}
    };
    r.interactions.actionSweepBounds=vi.fn((id,action,partName,samples=9)=>({checked:true,partName,action,bounds:geometry[`${id}:${action}:${samples===1?'target':'sweep'}`] || geometry[`${id}:${action}:sweep`]}));
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const result=await registry.invoke('recoverArticulatedBlocker',{
      actorId:'agent_01',targetId:'cabinet_A',partName:'door',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'
    },{profile:'builder',actor:'agent_01'});
    expect(result).toMatchObject({success:true,result:{
      status:'recovery-stale',reason:'COUNTERFACTUAL_SELECTION_CHANGED',currentRecommendedAction:'open',
      actorId:'agent_01',targetId:'cabinet_A',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close',retryOriginal:true
    }});
    expect(r.interactions.approachAndInteract).not.toHaveBeenCalled();
  });


  it('reports contradicted counterfactual calibration when a verified blocker action leaves the live original contact in place',async()=>{
    const r=runtime();
    const candidate={kind:'object',objectId:'cabinet_B',partName:'door',colliderIndex:0};
    const manifests={
      cabinet_A:{actions:['open','close'],parts:{door:{node:'Door',actions:['open','close'],targets:{open:-1,close:0},physics:{body:'dynamic',colliders:[{}]},joint:{type:'revolute'}}}},
      cabinet_B:{actions:['open','close'],parts:{door:{node:'Door',actions:['open','close','ajar'],targets:{open:-1.35,close:0,ajar:-.8},physics:{body:'dynamic',colliders:[{}]},joint:{type:'revolute'}}}}
    };
    r.store={has:vi.fn((id)=>id in manifests),get:vi.fn((id)=>({id,manifest:manifests[id],state:{parts:{door:id==='cabinet_B'?'ajar':'close'}}}))};
    r.physics={
      articulationContacts:vi.fn(()=>[{external:true,target:candidate,contactCount:1,activeContactCount:1,minDistance:-.001,totalImpulse:1}]),
      articulationPairCounterfactual:vi.fn((_a,_ap,_at,_b,_bp,target)=>{
        const close=target===0;
        return {checked:true,geometry:'rapier-shape-pairs',causal:false,samples:{original:9,blocker:9,mode:'adaptive'},
          current:{conflictSamples:8,pairIntersections:8},target:close?{conflictSamples:0,pairIntersections:0}:{conflictSamples:6,pairIntersections:6},
          action:close?{conflictSamplePairs:10,pairIntersections:10}:{conflictSamplePairs:30,pairIntersections:30},
          targetSweepClear:close,conflictReduction:close?8:2};
      })
    };
    r.interactions.articulationStatus=vi.fn((id)=>id==='cabinet_A'?{
      id,parts:[{partName:'door',status:'action-failed',verifiedAction:'close',requestedAction:null,last:{status:'action-failed',reason:'STALL',action:'open',attribution:{status:'contact-evidence',blockerCandidates:[candidate]}}}]
    }:{id,parts:[{partName:'door',status:'verified-state',verifiedAction:'ajar',requestedAction:null,live:{coordinate:-.8,target:-.8,error:0,tolerance:.08}}]});
    r.interactions.findInteractionPose=vi.fn(async(_actor,_id,{action,partName})=>({status:'approach-pose',position:[1,0,1],routeCost:action==='close'?1:2,actionSweep:{checked:true,clear:true,partName}}));
    const geometry={
      'cabinet_A:open:sweep':{min:[0,0,0],max:[2,2,2]},
      'cabinet_B:ajar:target':{min:[.5,.2,.5],max:[1.5,1.8,1.5]},
      'cabinet_B:open:target':{min:[.4,.2,.4],max:[1.4,1.8,1.4]},
      'cabinet_B:close:target':{min:[3,.2,.5],max:[4,1.8,1.5]},
      'cabinet_B:open:sweep':{min:[.3,.1,.3],max:[1.6,1.9,1.6]},
      'cabinet_B:close:sweep':{min:[.3,.1,.3],max:[4,1.9,1.6]}
    };
    r.interactions.actionSweepBounds=vi.fn((id,action,partName,samples=9)=>({checked:true,partName,action,bounds:geometry[`${id}:${action}:${samples===1?'target':'sweep'}`] || geometry[`${id}:${action}:sweep`]}));
    r.interactions.approachAndInteract=vi.fn(async()=>({status:'action-completed',targetReached:true,settled:true,targetId:'cabinet_B',partName:'door',action:'close'}));
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const result=await registry.invoke('recoverArticulatedBlocker',{
      actorId:'agent_01',targetId:'cabinet_A',partName:'door',blockerId:'cabinet_B',blockerPartName:'door',blockerAction:'close'
    },{profile:'builder',actor:'agent_01'});
    expect(result).toMatchObject({success:true,result:{
      status:'action-completed',retryOriginal:true,
      counterfactualCalibration:{
        status:'observed',scope:'post-recovery-current-contact',causal:false,
        prediction:{strategy:'articulated-rapier-shape-counterfactual-v2',basis:'rapier-shape-pairs',targetSweepClear:true,targetConflictSamples:0},
        observed:{blockerActionVerified:true,currentContactStillPresent:true},
        consistency:'contradicted',originalRetryRequired:true
      }
    }});
    expect(r.interactions.approachAndInteract).toHaveBeenCalledOnce();
  });


  it('replays restored acceptance evidence instead of trusting it directly', async () => {
    const r=runtime();
    r.currentWorldRevision={revision:{id:'rev-1'},provenance:{source:'planner'}};
    r.restoredAcceptanceEvidence={schema:'agentscape.acceptance-evidence',schemaVersion:1,required:true,source:'world-pipeline',worldRevisionId:'rev-1',criteria:[{id:'valid',kind:'world-valid'}],result:{schema:'agentscape.world-acceptance',schemaVersion:1,status:'world-accepted',checks:[{id:'valid',kind:'world-valid',verified:true}],verifiedCount:1,failedCount:0},findings:[]};
    const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
    const result=await registry.invoke('replayWorldAcceptance',{}, {profile:'viewer',actor:'agent_01'});
    expect(result).toMatchObject({success:true,result:{status:'world-accepted',replay:{status:'replayed',evidenceRevisionId:'rev-1',currentRevisionId:'rev-1'},acceptanceBundle:{source:'acceptance-replay'}}});
    expect(r.lastAcceptanceBundle).toMatchObject({source:'acceptance-replay',result:{status:'world-accepted'}});
    expect(registry.executionPolicy('replayWorldAcceptance',result.result).outcome).toMatchObject({state:'verified',verified:true,status:'world-accepted'});
  });

});


it('exposes a semantic-only World Planner proposal contract and seals identity inside Runtime',async()=>{
  const r=runtime();
  const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
  const definition=registry.definitions().find((item)=>item.name==='proposeWorldIR');
  expect(definition.parameters).toMatchObject({
    type:'object',additionalProperties:false,required:['proposal'],
    properties:{proposal:{type:'object',additionalProperties:false}}
  });
  expect(definition.parameters.properties.proposal.properties).not.toHaveProperty('revision');
  expect(definition.parameters.properties.proposal.properties).not.toHaveProperty('provenance');
  expect(definition.parameters.properties.proposal.properties).not.toHaveProperty('schema');

  const result=await registry.invoke('proposeWorldIR',{proposal:{
    intent:{name:'Planner Lab'},entities:[],spatial:{relations:[]},interactions:[],rules:[],acceptance:[]
  }},{profile:'viewer',actor:'planner-test'});
  expect(result).toMatchObject({success:true,result:{
    status:'world-proposal-ready',worldIR:{schema:'agentscape.world-ir',schemaVersion:1,provenance:{source:'agent-world-planner'},intent:{name:'Planner Lab'}},
    summary:{entities:0,interactions:0,rules:0,physicsRequirements:0,acceptanceChecks:0}
  }});
  expect(result.result.worldIR.revision.id).toMatch(/^world-/);
  expect(registry.executionPolicy('proposeWorldIR',result.result)).toMatchObject({mutates:false,barrier:false,outcome:{state:'accepted'}});
  expect(r.mutate).not.toHaveBeenCalledWith('skill:proposeWorldIR',expect.any(Function),expect.anything());
});


it('keeps bounded WorldRevision scope Runtime-owned and removes baseWorldIR from the Agent contract',async()=>{
  const r=runtime();
  const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
  const proposalDef=registry.definitions().find((item)=>item.name==='proposeWorldRevision');
  const recompileDef=registry.definitions().find((item)=>item.name==='recompileWorldRevision');
  expect(proposalDef.parameters).toMatchObject({required:['request'],properties:{request:{type:'object',required:['edits']}}});
  expect(proposalDef.parameters.properties.request.properties).not.toHaveProperty('baseRevisionId');
  expect(proposalDef.parameters.properties.request.properties).not.toHaveProperty('affectedEntityIds');
  expect(recompileDef.parameters.required).toEqual(['proposal','acceptChangedPlan']);
  expect(recompileDef.parameters.properties).not.toHaveProperty('baseWorldIR');

  const baseWorldIR={
    schema:'agentscape.world-ir',schemaVersion:1,revision:{id:'rev-1'},provenance:{source:'planner'},intent:{name:'Lab'},
    entities:[{id:'box',asset:{assetId:'crate'},transform:{position:[0,0,0]}}],
    spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[]
  };
  const revisionContext={
    schema:'agentscape.world-revision-context',schemaVersion:1,baseRevisionId:'rev-1',findingIds:['finding-1'],findings:[],
    affected:{seedEntityIds:['box'],contextEntityIds:['box'],editableEntityIds:['box'],missingEntityIds:[]},
    subgraph:{entities:[{id:'box',asset:{assetId:'crate',query:'crate',generate:false},transform:{position:[0,0,0]},capabilityIntent:[],initialState:{}}],spatial:{relations:[],constraints:[]},interactions:[],acceptance:[]},
    rulesReviewRequired:false
  };
  const proposed=await registry.invoke('proposeWorldRevision',{request:{reason:'lift box',edits:[{kind:'set-position',entityId:'box',position:[0,.2,0]}]}},{
    profile:'builder',actor:'planner-test',worldRevisionRepair:{baseWorldIR,revisionContext}
  });
  expect(proposed).toMatchObject({success:true,result:{status:'world-revision-proposal-ready',proposal:{baseRevisionId:'rev-1',affectedEntityIds:['box'],findingIds:['finding-1'],edits:[{kind:'set-position',entityId:'box',position:[0,.2,0]}]}}});
  expect(proposed.result.proposal.nextRevisionId).toMatch(/^world-/);

  const missingBase=await registry.invoke('recompileWorldRevision',{proposal:proposed.result.proposal,acceptChangedPlan:true},{profile:'builder',actor:'planner-test'});
  expect(missingBase).toMatchObject({success:false,error:{code:'WORLD_REVISION_BASE_REQUIRED'}});
});


it('replaces the current world before candidate execution and restores committed authority after rejection',async()=>{
  const r=runtime();
  const order=[];
  const oldAuthority={
    currentWorldRevision:{revision:{id:'rev-old'},provenance:{source:'existing'}},
    currentBehaviorBundle:{ruleGraph:[{id:'old-rule'}]},
    currentPhysicsRequirements:{worldRevisionId:'rev-old',requirements:[{entityId:'door'}]},
    lastAcceptanceBundle:{worldRevisionId:'rev-old',result:{status:'world-accepted'}},
    restoredAcceptanceEvidence:null,
    interactionEvidence:[['old-key',{worldRevisionId:'rev-old',targetId:'door',capability:'OPEN',verified:true}]]
  };
  r.currentWorldRevision=structuredClone(oldAuthority.currentWorldRevision);
  r.currentBehaviorBundle=structuredClone(oldAuthority.currentBehaviorBundle);
  r.currentPhysicsRequirements=structuredClone(oldAuthority.currentPhysicsRequirements);
  r.lastAcceptanceBundle=structuredClone(oldAuthority.lastAcceptanceBundle);
  r.interactionEvidence=new Map(oldAuthority.interactionEvidence);
  r.captureWorldAuthority=vi.fn(()=>structuredClone(oldAuthority));
  r.restoreWorldAuthority=vi.fn((authority)=>{
    order.push('restore-authority');
    r.currentWorldRevision=structuredClone(authority.currentWorldRevision);
    r.currentBehaviorBundle=structuredClone(authority.currentBehaviorBundle);
    r.currentPhysicsRequirements=structuredClone(authority.currentPhysicsRequirements);
    r.lastAcceptanceBundle=structuredClone(authority.lastAcceptanceBundle);
    r.interactionEvidence=new Map(authority.interactionEvidence);
  });
  r.loadRuleGraph=vi.fn((graph)=>order.push(graph.length?'load-rules':'pause-rules'));
  r.clearObjects=vi.fn(async()=>{order.push('clear-world');r.interactionEvidence.clear();});
  r.restore=vi.fn(async()=>{order.push('restore-scene');});
  r.worldPipeline.run=vi.fn(async()=>{
    order.push('candidate-pipeline');
    expect(r.interactionEvidence.size).toBe(0);
    return {state:{artifacts:{},reports:{worldAdmission:{status:'rejected',reasons:['VALIDATION_HARD']}}},timeline:[]};
  });
  const registry=registerCoreSkills(new SkillRegistry({policy:r.policy,trace:r.trace,runtime:r}),r);
  const result=await registry.invoke('runWorldPipeline',{plan:{}},{profile:'builder',actor:'test'});
  expect(result).toMatchObject({success:true,result:{status:'world-rejected',rolledBack:true,reason:'VALIDATION_HARD'}});
  expect(r.clearObjects).toHaveBeenCalledWith({silent:true});
  expect(order).toEqual(['pause-rules','clear-world','candidate-pipeline','restore-scene','restore-authority']);
  expect(r.currentWorldRevision).toEqual(oldAuthority.currentWorldRevision);
  expect(r.currentBehaviorBundle).toEqual(oldAuthority.currentBehaviorBundle);
  expect(r.currentPhysicsRequirements).toEqual(oldAuthority.currentPhysicsRequirements);
  expect(r.lastAcceptanceBundle).toEqual(oldAuthority.lastAcceptanceBundle);
  expect([...r.interactionEvidence.entries()]).toEqual(oldAuthority.interactionEvidence);
});
