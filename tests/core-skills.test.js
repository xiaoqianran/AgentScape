import { describe, expect, it, vi } from 'vitest';
import { SkillRegistry } from '../src/skills/SkillRegistry.js';
import { PolicyEngine } from '../src/policy/PolicyEngine.js';
import { TraceRecorder } from '../src/observability/TraceRecorder.js';
import { registerCoreSkills } from '../src/skills/registerCoreSkills.js';

function runtime() {
  let value = 0;
  const r = {
    events: { emit: vi.fn() },
    policy: new PolicyEngine(),
    trace: new TraceRecorder(),
    snapshot: vi.fn(() => ({ value })),
    restore: vi.fn(async (scene) => { value = scene.value; }),
    mutate: vi.fn(async (_label, fn) => fn()),
    assetLibrary: { list:()=>[], search:()=>[], resolve:()=>({}), generate:()=>({}), summary:(x)=>x },
    assets: { registerManifest: vi.fn(), has:()=>true },
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

  it('world pipeline cannot bypass asset permissions', async () => {
    const r = runtime();
    r.policy = new PolicyEngine({ profiles: { worldOnly: ['world.write'] } });
    const registry = registerCoreSkills(new SkillRegistry({ policy:r.policy, trace:r.trace, runtime:r }), r);
    const result = await registry.invoke('runWorldPipeline', { plan:{} }, { profile:'worldOnly' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('forbidden');
    expect(r.worldPipeline.run).not.toHaveBeenCalled();
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

});
