import { describe,expect,it,vi } from 'vitest';
import { recompileWorldRevision } from '../src/pipeline/WorldRecompiler.js';
import { buildWorldRevisionContext,createWorldRevisionProposal } from '../src/pipeline/WorldRevision.js';
import { compileValidationFindings } from '../src/validation/Finding.js';
import { recordInteractionEvidence } from '../src/validation/InteractionEvidence.js';

const baseIR=()=>({
  schema:'agentscape.world-ir',schemaVersion:1,
  revision:{id:'rev-1'},provenance:{source:'planner',evidenceRefs:[]},intent:{name:'Lab'},
  entities:[{id:'box',asset:{assetId:'crate'},transform:{position:[0,0,0]}}],
  spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[{id:'valid',kind:'world-valid'}]
});
const proposal=()=>{
  const findings=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'rev-1'});
  return createWorldRevisionProposal(buildWorldRevisionContext(baseIR(),findings),{nextRevisionId:'rev-2',reason:'lift box',edits:[{kind:'set-position',entityId:'box',position:[0,.2,0]}]});
};
const runtime=(admission={status:'ready',reasons:[]})=>{
  const before={scene:'before'};
  return {
    snapshot:vi.fn(()=>structuredClone(before)),restore:vi.fn(async()=>{}),clearObjects:vi.fn(async()=>{}),
    worldPipeline:{run:vi.fn(async(ir)=>({state:{artifacts:{worldIR:structuredClone(ir),acceptanceEvidence:{result:{status:'world-accepted'}}},reports:{worldAdmission:structuredClone(admission),worldAcceptance:{status:'world-accepted'}}},timeline:[]}))}
  };
};

describe('WorldRecompiler',()=>{
  it('requires changed-plan acceptance before any Runtime mutation',async()=>{
    const rt=runtime();
    await expect(recompileWorldRevision(rt,{baseWorldIR:baseIR(),proposal:proposal(),acceptChangedPlan:false})).rejects.toMatchObject({code:'WORLD_REVISION_CHANGE_NOT_ACCEPTED'});
    expect(rt.snapshot).not.toHaveBeenCalled(); expect(rt.clearObjects).not.toHaveBeenCalled(); expect(rt.worldPipeline.run).not.toHaveBeenCalled();
  });
  it('replaces the current world and sends the accepted child revision through the canonical pipeline',async()=>{
    const rt=runtime({status:'ready',reasons:[]});
    const result=await recompileWorldRevision(rt,{baseWorldIR:baseIR(),proposal:proposal(),acceptChangedPlan:true});
    expect(rt.snapshot).toHaveBeenCalledOnce(); expect(rt.clearObjects).toHaveBeenCalledOnce();
    const compiledIR=rt.worldPipeline.run.mock.calls[0][0];
    expect(compiledIR.revision).toMatchObject({id:'rev-2',parentId:'rev-1',reason:'lift box'});
    expect(compiledIR.provenance).toMatchObject({source:'finding-revision'});
    expect(result).toMatchObject({status:'world-ready',rolledBack:false,baseRevisionId:'rev-1',revisionId:'rev-2',recompile:{canonical:true,freshVerification:true,committed:true},pipeline:{state:{reports:{worldAcceptance:{status:'world-accepted'}}}}});
    expect(rt.restore).not.toHaveBeenCalled();
  });
  it('rolls back the original scene when fresh admission rejects the child revision',async()=>{
    const rt=runtime({status:'rejected',reasons:['WORLD_ACCEPTANCE_FAILED']});
    const result=await recompileWorldRevision(rt,{baseWorldIR:baseIR(),proposal:proposal(),acceptChangedPlan:true});
    expect(result).toMatchObject({status:'world-rejected',reason:'WORLD_ACCEPTANCE_FAILED',rolledBack:true,revisionId:'rev-2',recompile:{committed:false}});
    expect(rt.restore).toHaveBeenCalledOnce();
  });
  it('restores the original scene on canonical pipeline exceptions',async()=>{
    const rt=runtime(); rt.worldPipeline.run=vi.fn(async()=>{throw Object.assign(new Error('compiler failed'),{code:'COMPILER_FAILED'});});
    await expect(recompileWorldRevision(rt,{baseWorldIR:baseIR(),proposal:proposal(),acceptChangedPlan:true})).rejects.toMatchObject({code:'COMPILER_FAILED'});
    expect(rt.restore).toHaveBeenCalledOnce();
  });
});


const stateRevision=()=>({
  schema:'agentscape.world-ir',schemaVersion:1,
  revision:{id:'state-rev-1'},provenance:{source:'planner',evidenceRefs:[]},intent:{name:'State Lab'},
  entities:[{id:'box',asset:{assetId:'crate'},transform:{position:[0,0,0]},initialState:{enabled:true},capabilityIntent:[]}],
  spatial:{relations:[],constraints:[]},interactions:[],rules:[],
  acceptance:[{id:'disabled',kind:'state-equals',targetId:'box',stateKey:'enabled',value:false}]
});
const stateProposal=()=>{
  const findings=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'state-rev-1'});
  return createWorldRevisionProposal(buildWorldRevisionContext(stateRevision(),findings),{
    nextRevisionId:'state-rev-2',reason:'disable box',edits:[{kind:'set-initial-state',entityId:'box',state:{enabled:false}}]
  });
};
const incrementalRuntime=({revisionId='state-rev-1',state={enabled:true},validation={ok:true,counts:{hard:0,advisory:0},findings:[]}}={})=>{
  const record={id:'box',assetId:'crate',state:structuredClone(state),object:{position:{toArray:()=>[0,0,0]}}};
  return {
    currentWorldRevision:{revision:{id:revisionId},provenance:{source:'planner'}},
    currentBehaviorBundle:{ruleGraph:[]},currentPhysicsRequirements:{requirements:[]},lastAcceptanceBundle:{old:true},restoredAcceptanceEvidence:{historical:true},
    snapshot:vi.fn(()=>({scene:'before'})),restore:vi.fn(async()=>{}),clearObjects:vi.fn(async()=>{}),
    worldPipeline:{run:vi.fn(async()=>({state:{reports:{worldAdmission:{status:'ready',reasons:[]}}},timeline:[]}))},
    store:{get:vi.fn(()=>record)},
    restoreObjectState:vi.fn((_id,next)=>{record.state=structuredClone(next);}),
    validator:{run:vi.fn(()=>structuredClone(validation))},
    sceneGraph:{changed:vi.fn(),update:vi.fn(),list:vi.fn(()=>[])},
    loadRuleGraph:vi.fn(),trace:{emit:vi.fn()}
  };
};

it('incrementally recompiles a provably unchanged Runtime when only semantic initial state changes',async()=>{
  const rt=incrementalRuntime();
  const result=await recompileWorldRevision(rt,{baseWorldIR:stateRevision(),proposal:stateProposal(),acceptChangedPlan:true});
  expect(rt.restoreObjectState).toHaveBeenCalledWith('box',{enabled:false});
  expect(rt.clearObjects).not.toHaveBeenCalled();
  expect(rt.worldPipeline.run).not.toHaveBeenCalled();
  expect(rt.currentWorldRevision).toMatchObject({revision:{id:'state-rev-2',parentId:'state-rev-1'}});
  expect(result).toMatchObject({
    status:'world-ready',rolledBack:false,baseRevisionId:'state-rev-1',revisionId:'state-rev-2',
    admission:{status:'ready',acceptance:{status:'world-accepted'}},
    recompile:{canonical:true,mode:'incremental-state',freshVerification:true,committed:true,affectedEntityIds:['box']}
  });
  expect(result.pipeline.state.artifacts.acceptanceEvidence).toMatchObject({worldRevisionId:'state-rev-2',result:{status:'world-accepted'}});
  expect(rt.restoredAcceptanceEvidence).toBeNull();
});

it('falls back to full canonical rebuild when current Runtime state has drifted from the base revision',async()=>{
  const rt=incrementalRuntime({state:{enabled:true,runtimeFlag:'drift'}});
  const result=await recompileWorldRevision(rt,{baseWorldIR:stateRevision(),proposal:stateProposal(),acceptChangedPlan:true});
  expect(rt.restoreObjectState).not.toHaveBeenCalled();
  expect(rt.clearObjects).toHaveBeenCalledOnce();
  expect(rt.worldPipeline.run).toHaveBeenCalledOnce();
  expect(result.recompile).toMatchObject({mode:'full',canonical:true,committed:true});
});

it('rolls back an incremental state revision when fresh validation rejects it',async()=>{
  const rt=incrementalRuntime({validation:{ok:false,counts:{hard:1,advisory:0},findings:[]}});
  const result=await recompileWorldRevision(rt,{baseWorldIR:stateRevision(),proposal:stateProposal(),acceptChangedPlan:true});
  expect(result).toMatchObject({
    status:'world-rejected',rolledBack:true,reason:'VALIDATION_HARD:1',
    recompile:{mode:'incremental-state',committed:false,freshVerification:true}
  });
  expect(rt.restore).toHaveBeenCalledOnce();
  expect(rt.currentWorldRevision).toMatchObject({revision:{id:'state-rev-1'}});
  expect(rt.lastAcceptanceBundle).toEqual({old:true});
  expect(rt.restoredAcceptanceEvidence).toEqual({historical:true});
});


const behaviorRevision=()=>({
  schema:'agentscape.world-ir',schemaVersion:1,
  revision:{id:'behavior-rev-1'},provenance:{source:'planner',evidenceRefs:[]},intent:{name:'Behavior Lab'},
  entities:[{id:'box',asset:{assetId:'crate'},transform:{position:[0,0,0]},initialState:{},capabilityIntent:['PICKUP']}],
  spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[{id:'box-exists',kind:'object-exists',targetId:'box'}]
});
const behaviorProposal=()=>{
  const findings=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'behavior-rev-1'});
  return createWorldRevisionProposal(buildWorldRevisionContext(behaviorRevision(),findings),{
    nextRevisionId:'behavior-rev-2',reason:'expand capability',edits:[{kind:'set-capability-intent',entityId:'box',capabilities:['pickup','place']}]
  });
};
const behaviorRuntime=({revisionId='behavior-rev-1',actions=['pickup','place','move'],assetId='crate'}={})=>{
  const record={id:'box',assetId,state:{},object:{position:{toArray:()=>[0,0,0]}}};
  return {
    currentWorldRevision:{revision:{id:revisionId},provenance:{source:'planner'}},
    currentBehaviorBundle:{ruleGraph:[]},currentPhysicsRequirements:{requirements:[]},lastAcceptanceBundle:{old:true},restoredAcceptanceEvidence:{historical:true},
    snapshot:vi.fn(()=>({scene:'before'})),restore:vi.fn(async()=>{}),clearObjects:vi.fn(async()=>{}),
    worldPipeline:{run:vi.fn(async()=>({state:{reports:{worldAdmission:{status:'ready',reasons:[]}}},timeline:[]}))},
    store:{get:vi.fn(()=>record)},assets:{getManifest:vi.fn(()=>({id:'crate',actions}))},
    validator:{run:vi.fn(()=>({ok:true,counts:{hard:0,advisory:0},findings:[]}))},
    sceneGraph:{changed:vi.fn(),update:vi.fn(),list:vi.fn(()=>[])},
    loadRuleGraph:vi.fn(),trace:{emit:vi.fn()}
  };
};

it('incrementally recompiles capability intent when current assets prove the new behavior contract',async()=>{
  const rt=behaviorRuntime();
  const result=await recompileWorldRevision(rt,{baseWorldIR:behaviorRevision(),proposal:behaviorProposal(),acceptChangedPlan:true});
  expect(rt.clearObjects).not.toHaveBeenCalled();
  expect(rt.worldPipeline.run).not.toHaveBeenCalled();
  expect(rt.currentWorldRevision).toMatchObject({revision:{id:'behavior-rev-2',parentId:'behavior-rev-1'}});
  expect(rt.currentBehaviorBundle.capabilityIntents).toEqual([{entityId:'box',capabilities:['PICKUP','PLACE']}]);
  expect(rt.restoredAcceptanceEvidence).toBeNull();
  expect(result).toMatchObject({
    status:'world-ready',rolledBack:false,
    admission:{status:'ready',behavior:{status:'ready'}},
    recompile:{mode:'incremental-behavior',freshVerification:true,committed:true,affectedEntityIds:['box']}
  });
});

it('rejects unsupported capability intent before changing Runtime authority',async()=>{
  const rt=behaviorRuntime({actions:['pickup','move']});
  const result=await recompileWorldRevision(rt,{baseWorldIR:behaviorRevision(),proposal:behaviorProposal(),acceptChangedPlan:true});
  expect(result).toMatchObject({
    status:'world-rejected',rolledBack:false,reason:'BEHAVIOR_CAPABILITY_INTENT_UNSUPPORTED',
    admission:{status:'rejected',behavior:{status:'rejected',issues:[{code:'BEHAVIOR_CAPABILITY_INTENT_UNSUPPORTED',targetId:'box',capability:'PLACE'}]}},
    recompile:{mode:'incremental-behavior',freshVerification:false,committed:false}
  });
  expect(rt.currentWorldRevision).toMatchObject({revision:{id:'behavior-rev-1'}});
  expect(rt.currentBehaviorBundle).toEqual({ruleGraph:[]});
  expect(rt.restoredAcceptanceEvidence).toEqual({historical:true});
  expect(rt.clearObjects).not.toHaveBeenCalled();
  expect(rt.worldPipeline.run).not.toHaveBeenCalled();
});

it('falls back to full canonical rebuild when incremental behavior authority cannot be proven',async()=>{
  const rt=behaviorRuntime({revisionId:'other-revision'});
  const result=await recompileWorldRevision(rt,{baseWorldIR:behaviorRevision(),proposal:behaviorProposal(),acceptChangedPlan:true});
  expect(rt.clearObjects).toHaveBeenCalledOnce();
  expect(rt.worldPipeline.run).toHaveBeenCalledOnce();
  expect(result.recompile).toMatchObject({mode:'full',canonical:true,committed:true});
});


it('does not carry interaction verification evidence across an incremental behavior revision',async()=>{
  const base=behaviorRevision();
  base.acceptance=[{id:'pickup-verified',kind:'interaction-verified',targetId:'box',capability:'PICKUP'}];
  const findings=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'behavior-rev-1'});
  const patch=createWorldRevisionProposal(buildWorldRevisionContext(base,findings),{
    nextRevisionId:'behavior-rev-2',reason:'expand capability',edits:[{kind:'set-capability-intent',entityId:'box',capabilities:['pickup','place']}]
  });
  const rt=behaviorRuntime();
  recordInteractionEvidence(rt,{targetId:'box',capability:'PICKUP',verified:true,source:'test'});
  const result=await recompileWorldRevision(rt,{baseWorldIR:base,proposal:patch,acceptChangedPlan:true});
  expect(result).toMatchObject({
    status:'world-rejected',rolledBack:true,reason:'WORLD_ACCEPTANCE_FAILED',
    admission:{status:'rejected',acceptance:{status:'world-incomplete'}},
    recompile:{mode:'incremental-behavior',freshVerification:true,committed:false}
  });
  expect(rt.currentWorldRevision).toMatchObject({revision:{id:'behavior-rev-1'}});
});


const physicsRevision=()=>({
  schema:'agentscape.world-ir',schemaVersion:1,
  revision:{id:'physics-rev-1'},provenance:{source:'planner',evidenceRefs:[]},intent:{name:'Physics Lab'},
  entities:[{id:'box',asset:{assetId:'crate'},transform:{position:[0,0,0]},initialState:{},capabilityIntent:[],physicsRequirement:{bodyClass:'rigid'}}],
  spatial:{relations:[],constraints:[]},interactions:[],rules:[],acceptance:[{id:'box-exists',kind:'object-exists',targetId:'box'}]
});
const physicsProposal=()=>{
  const findings=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'physics-rev-1'});
  return createWorldRevisionProposal(buildWorldRevisionContext(physicsRevision(),findings),{
    nextRevisionId:'physics-rev-2',reason:'require collision evidence',edits:[{
      kind:'set-physics-requirement',entityId:'box',requirement:{
        bodyClass:'rigid',requiredCapabilities:['collision'],qualityPolicy:{deterministicRequired:true}
      }
    }]
  });
};
const physicsRuntime=({revisionId='physics-rev-1',capabilities=['rigid-body','collision'],deterministic=true}={})=>{
  const record={id:'box',assetId:'crate',state:{},object:{position:{toArray:()=>[0,0,0]}}};
  const backend={
    identity:'mock-physics',capabilities:[...capabilities],executionModes:['realtime'],qualities:{realtime:true,deterministic},
    hasCapability:vi.fn((capability)=>capabilities.includes(capability)),supportsExecutionMode:vi.fn((mode)=>mode==='realtime')
  };
  return {
    currentWorldRevision:{revision:{id:revisionId},provenance:{source:'planner'}},
    currentBehaviorBundle:{ruleGraph:[]},currentPhysicsRequirements:{worldRevisionId:'physics-rev-1',requirements:[{entityId:'box',bodyClass:'rigid'}]},
    lastAcceptanceBundle:{old:true},restoredAcceptanceEvidence:{historical:true},
    snapshot:vi.fn(()=>({scene:'before'})),restore:vi.fn(async()=>{}),clearObjects:vi.fn(async()=>{}),
    worldPipeline:{run:vi.fn(async()=>({state:{reports:{worldAdmission:{status:'ready',reasons:[]}}},timeline:[]}))},
    store:{get:vi.fn(()=>record)},assets:{getManifest:vi.fn(()=>({id:'crate',actions:['move'],physics:{body:'dynamic'}}))},
    physics:{backend},validator:{run:vi.fn(()=>({ok:true,counts:{hard:0,advisory:0},findings:[]}))},
    sceneGraph:{changed:vi.fn(),update:vi.fn(),list:vi.fn(()=>[])},loadRuleGraph:vi.fn(),trace:{emit:vi.fn()}
  };
};

it('incrementally admits a physics requirement when current backend and asset evidence already satisfy it',async()=>{
  const rt=physicsRuntime();
  const result=await recompileWorldRevision(rt,{baseWorldIR:physicsRevision(),proposal:physicsProposal(),acceptChangedPlan:true});
  expect(rt.clearObjects).not.toHaveBeenCalled();
  expect(rt.worldPipeline.run).not.toHaveBeenCalled();
  expect(rt.currentWorldRevision).toMatchObject({revision:{id:'physics-rev-2',parentId:'physics-rev-1'}});
  expect(rt.currentPhysicsRequirements).toMatchObject({
    worldRevisionId:'physics-rev-2',requirements:[{entityId:'box',bodyClass:'rigid',requiredCapabilities:['rigid-body','collision']}]
  });
  expect(result).toMatchObject({
    status:'world-ready',rolledBack:false,
    admission:{status:'ready',physics:{status:'ready',backend:{identity:'mock-physics'}}},
    recompile:{mode:'incremental-physics',freshVerification:true,committed:true,affectedEntityIds:['box']}
  });
});

it('rejects an unmet physics requirement before changing Runtime authority',async()=>{
  const rt=physicsRuntime({capabilities:['rigid-body']});
  const result=await recompileWorldRevision(rt,{baseWorldIR:physicsRevision(),proposal:physicsProposal(),acceptChangedPlan:true});
  expect(result).toMatchObject({
    status:'world-rejected',rolledBack:false,reason:'PHYSICS_BACKEND_CAPABILITY_MISSING',
    admission:{status:'rejected',physics:{status:'rejected',issues:[{code:'PHYSICS_BACKEND_CAPABILITY_MISSING',entityId:'box',capability:'collision'}]}},
    recompile:{mode:'incremental-physics',freshVerification:false,committed:false}
  });
  expect(rt.currentWorldRevision).toMatchObject({revision:{id:'physics-rev-1'}});
  expect(rt.restoredAcceptanceEvidence).toEqual({historical:true});
  expect(rt.clearObjects).not.toHaveBeenCalled();
  expect(rt.worldPipeline.run).not.toHaveBeenCalled();
});

it('falls back to full canonical rebuild when incremental physics authority cannot be proven',async()=>{
  const rt=physicsRuntime({revisionId:'other-revision'});
  const result=await recompileWorldRevision(rt,{baseWorldIR:physicsRevision(),proposal:physicsProposal(),acceptChangedPlan:true});
  expect(rt.clearObjects).toHaveBeenCalledOnce();
  expect(rt.worldPipeline.run).toHaveBeenCalledOnce();
  expect(result.recompile).toMatchObject({mode:'full',canonical:true,committed:true});
});


const positionManifest=(id)=>({
  id,actions:['move'],physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[.5,.5,.5],translation:[0,.5,0]}]}
});
const positionRevision=({withRelation=false}={})=>({
  schema:'agentscape.world-ir',schemaVersion:1,
  revision:{id:'position-rev-1'},provenance:{source:'planner',evidenceRefs:[]},intent:{name:'Position Lab'},
  entities:[
    {id:'box',asset:{assetId:'crate'},transform:{position:[0,.01,0]},initialState:{},capabilityIntent:[]},
    {id:'table',asset:{assetId:'table'},transform:{position:[3,.01,0]},initialState:{},capabilityIntent:[]}
  ],
  spatial:{relations:withRelation?[{subject:'box',predicate:'NEAR',object:'table'}]:[],constraints:[]},
  interactions:[],rules:[],acceptance:[{id:'box-exists',kind:'object-exists',targetId:'box'}]
});
const positionProposal=(base=positionRevision(),position=[-2,.01,0])=>{
  const findings=compileValidationFindings({hard:[{code:'G_BELOW_GROUND',object:'box'}],advisory:[]},{worldRevisionId:'position-rev-1'});
  return createWorldRevisionProposal(buildWorldRevisionContext(base,findings),{
    nextRevisionId:'position-rev-2',reason:'move box',edits:[{kind:'set-position',entityId:'box',position}]
  });
};
const vector=(initial)=>{
  let value=[...initial];
  return {toArray:()=>[...value],fromArray:(next)=>{value=[...next];}};
};
const positionRuntime=({revisionId='position-rev-1',boxPosition=[0,.01,0],poseClear=()=>({checked:true,clear:true,blockedBy:[]}),validation={ok:true,counts:{hard:0,advisory:0},findings:[]}}={})=>{
  const records={
    box:{id:'box',assetId:'crate',state:{},manifest:positionManifest('crate'),object:{position:vector(boxPosition)}},
    table:{id:'table',assetId:'table',state:{},manifest:positionManifest('table'),object:{position:vector([3,.01,0])}}
  };
  const interactions={move:vi.fn((id,position)=>{records[id].object.position.fromArray(position);})};
  return {
    currentWorldRevision:{revision:{id:revisionId},provenance:{source:'planner'}},
    currentBehaviorBundle:{ruleGraph:[]},currentPhysicsRequirements:{requirements:[]},lastAcceptanceBundle:{old:true},restoredAcceptanceEvidence:{historical:true},
    snapshot:vi.fn(()=>({scene:'before'})),restore:vi.fn(async()=>{}),clearObjects:vi.fn(async()=>{}),
    worldPipeline:{run:vi.fn(async()=>({state:{reports:{worldAdmission:{status:'ready',reasons:[]}}},timeline:[]}))},
    store:{get:vi.fn((id)=>records[id])},assets:{getManifest:vi.fn((id)=>positionManifest(id))},interactions,
    physics:{manifestPoseClear:vi.fn(poseClear)},environment:{layout:{bounds:{min:[-5,-5],max:[5,5]},groundY:0,margin:.5}},
    validator:{run:vi.fn(()=>structuredClone(validation))},sceneGraph:{changed:vi.fn(),update:vi.fn(),list:vi.fn(()=>[])},
    loadRuleGraph:vi.fn(),trace:{emit:vi.fn()}
  };
};

it('incrementally moves one relation-free entity only after shared layout/Physics preflight',async()=>{
  const rt=positionRuntime();
  const base=positionRevision(),patch=positionProposal(base);
  const result=await recompileWorldRevision(rt,{baseWorldIR:base,proposal:patch,acceptChangedPlan:true});
  expect(rt.interactions.move).toHaveBeenCalledWith('box',[-2,.01,0]);
  expect(rt.physics.manifestPoseClear).toHaveBeenCalledWith(expect.objectContaining({id:'crate'}),[-2,.01,0],{excludeIds:['box']});
  expect(rt.clearObjects).not.toHaveBeenCalled();
  expect(rt.worldPipeline.run).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    status:'world-ready',rolledBack:false,admission:{status:'ready',layout:{status:'ready'}},
    recompile:{mode:'incremental-position',freshVerification:true,committed:true,affectedEntityIds:['box']}
  });
});

it('rejects an incrementally moved pose before mutation when layout or Physics preflight blocks it',async()=>{
  const rt=positionRuntime({poseClear:()=>({checked:true,clear:false,blockedBy:['wall']})});
  const base=positionRevision(),patch=positionProposal(base,[-2,.01,0]);
  const result=await recompileWorldRevision(rt,{baseWorldIR:base,proposal:patch,acceptChangedPlan:true});
  expect(result).toMatchObject({
    status:'world-rejected',rolledBack:false,reason:'WORLD_POSE_BLOCKED',
    admission:{status:'rejected',layout:{status:'rejected',issues:[{blockedBy:['wall']}]}},
    recompile:{mode:'incremental-position',freshVerification:false,committed:false}
  });
  expect(rt.interactions.move).not.toHaveBeenCalled();
  expect(rt.currentWorldRevision).toMatchObject({revision:{id:'position-rev-1'}});
});

it('falls back to full rebuild when a position patch participates in spatial relations',async()=>{
  const base=positionRevision({withRelation:true});
  const rt=positionRuntime();
  const result=await recompileWorldRevision(rt,{baseWorldIR:base,proposal:positionProposal(base),acceptChangedPlan:true});
  expect(rt.interactions.move).not.toHaveBeenCalled();
  expect(rt.clearObjects).toHaveBeenCalledOnce();
  expect(rt.worldPipeline.run).toHaveBeenCalledOnce();
  expect(result.recompile).toMatchObject({mode:'full',committed:true});
});

it('falls back to full rebuild when the target has drifted from an explicit base position',async()=>{
  const base=positionRevision(),rt=positionRuntime({boxPosition:[.5,.01,0]});
  const result=await recompileWorldRevision(rt,{baseWorldIR:base,proposal:positionProposal(base),acceptChangedPlan:true});
  expect(rt.interactions.move).not.toHaveBeenCalled();
  expect(rt.clearObjects).toHaveBeenCalledOnce();
  expect(result.recompile).toMatchObject({mode:'full'});
});

it('restores scene and authority when fresh validation rejects an incremental position change',async()=>{
  const base=positionRevision();
  const rt=positionRuntime({validation:{ok:false,counts:{hard:1,advisory:0},findings:[]}});
  const result=await recompileWorldRevision(rt,{baseWorldIR:base,proposal:positionProposal(base),acceptChangedPlan:true});
  expect(result).toMatchObject({status:'world-rejected',rolledBack:true,reason:'VALIDATION_HARD:1',recompile:{mode:'incremental-position',committed:false}});
  expect(rt.restore).toHaveBeenCalledOnce();
  expect(rt.currentWorldRevision).toMatchObject({revision:{id:'position-rev-1'}});
});
