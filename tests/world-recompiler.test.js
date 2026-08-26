import { describe,expect,it,vi } from 'vitest';
import { recompileWorldRevision } from '../src/pipeline/WorldRecompiler.js';
import { buildWorldRevisionContext,createWorldRevisionProposal } from '../src/pipeline/WorldRevision.js';
import { compileValidationFindings } from '../src/validation/Finding.js';

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
