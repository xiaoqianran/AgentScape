import {describe,it,expect} from 'vitest';
import {buildTaskEvidence,collectSceneChecks,nativeObservation,pendingSceneRecords,withVisualTaskEvidence} from '../../application/agent/TaskEvidence.js';
import {compileWorldAcceptance,evaluateWorldAcceptance} from '../../modules/world/verification/WorldAcceptance.js';
import {recordInteractionEvidence} from '../../modules/world/verification/InteractionEvidence.js';
import {iterateVisualProject} from '../../apps/agent-host/VisualReview.js';

const world={worldSessionId:'session-1',projectId:'world-1',projectRevision:3,runtimeId:'runtime-1',sceneRevision:8};
const criterion={id:'door-action',kind:'interaction-verified',targetId:'door',capability:'OPEN',source:'project'};
const tree={id:'tree',kind:'object-exists',targetId:'tree'};
const valid={id:'valid',kind:'world-valid'};
const state={id:'state',kind:'state-equals',targetId:'door',stateKey:'open',value:true,source:'project'};
const relation={id:'relation',kind:'relation-exists',subject:'cup',predicate:'ON',object:'table',surfaceId:'top'};
const envelope=(checks,accepted=true)=>({schema:'agentscape.scene-result',operation:'verify',status:'succeeded',revision:8,
  verification:{status:accepted?'verified':'unverified',evidence:{status:accepted?'world-accepted':'world-incomplete',checks}}});
const passedCheck=check=>({...check,verified:true});
const receipt={schema:'agentscape.interaction-evidence',schemaVersion:1,worldRevisionId:'session:proof',verified:true,
  targetId:'door',capability:'OPEN',source:'project-defined',commandId:'action-1'};
const actionCheck={...criterion,expected:'OPEN',verified:true,evidence:receipt};
const stateCheck={...state,expected:true,actual:true,verified:true};
const visualVerdict=(binding=world,overrides={})=>({status:'passed',score:9,issues:[],advice:'',...binding,
  revision:binding.projectRevision,imageDigest:'b'.repeat(64),frame:12,tick:12,...overrides});
function acceptedWorld(binding=world){
  const records=collectSceneChecks(envelope([passedCheck(valid)]),[valid]).records;
  const evidence=buildTaskEvidence({world:binding,scope:'world-state',records,bound:true,worldReady:true,visualRequired:true,
    persistenceRequired:true,savedCheckpoint:{...binding,digest:'a'.repeat(64)}});
  return {world:binding,evidence,verification:{status:'verified',reason:'VISUAL_REVIEW_PENDING'},verified:false,
    taskStatus:'awaiting-visual',unresolvedMutations:[{reason:'VISUAL_REVIEW_PENDING'}]};
}

describe('task evidence dimensions and independently bound admission',()=>{
  it('rejects omitted, substituted and duplicate criteria despite a verified envelope',()=>{
    for(const checks of [
      [passedCheck(valid)],
      [passedCheck(valid),passedCheck({...tree,targetId:'not-tree'})],
      [passedCheck(valid),passedCheck(tree),passedCheck(tree)],
      [passedCheck(valid),passedCheck(tree),passedCheck({id:'unexpected',kind:'world-valid'})]
    ])expect(collectSceneChecks(envelope(checks),[valid,tree]).accepted).toBe(false);
    expect(collectSceneChecks(envelope([passedCheck(valid),passedCheck(tree)]),[valid,tree]).accepted).toBe(true);
  });
  it('requires actual state values, spatial operands and action receipt provenance',()=>{
    expect(collectSceneChecks(envelope([stateCheck]),[state]).accepted).toBe(true);
    expect(collectSceneChecks(envelope([{...stateCheck,actual:false}]),[state]).accepted).toBe(false);
    expect(collectSceneChecks(envelope([passedCheck(relation)]),[relation]).accepted).toBe(true);
    expect(collectSceneChecks(envelope([passedCheck({...relation,surfaceId:'wrong'})]),[relation]).accepted).toBe(false);
    expect(collectSceneChecks(envelope([{...actionCheck,evidence:undefined}]),[criterion]).accepted).toBe(false);
    expect(collectSceneChecks(envelope([{...actionCheck,evidence:{...receipt,source:'physical-articulation'}}]),[criterion]).accepted).toBe(false);
    const {accepted,records}=collectSceneChecks(envelope([actionCheck,stateCheck]),[criterion,state]);
    expect(accepted).toBe(true);
    expect(records).toMatchObject([{dimension:'behavior',type:'action-receipt',receipt:{source:'project-defined'}},{dimension:'behavior',type:'state-snapshot',actual:true}]);
  });
  it('accepts real WorldAcceptance interaction receipts, not a state-only claim',()=>{
    const runtime={validator:{run:()=>({ok:true})},projectCapabilities:{has:()=>true,hasAction:()=>true,readState:()=>({open:true})}};
    const graph=compileWorldAcceptance([valid,state,criterion]);
    const wrap=()=>{const result=evaluateWorldAcceptance(runtime,graph);return envelope(result.checks,result.status==='world-accepted');};
    const before=collectSceneChecks(wrap(),graph.checks);
    expect(before.accepted).toBe(false);
    expect(before.records.find(x=>x.id===criterion.id)).toMatchObject({status:'unverified',reason:'INTERACTION_NOT_VERIFIED'});
    recordInteractionEvidence(runtime,{targetId:'door',capability:'open',verified:true,source:'project-defined',commandId:'door-open'});
    const after=collectSceneChecks(wrap(),graph.checks);
    expect(after.accepted).toBe(true);
    expect(after.records.find(x=>x.id===criterion.id).receipt).toMatchObject({source:'project-defined',commandId:'door-open'});
  });
  it('includes scoped supplemental entity checks without letting them replace requested checks',()=>{
    const extra=passedCheck({id:'task-entity-2',kind:'object-exists',targetId:'extra'});
    expect(collectSceneChecks(envelope([passedCheck(tree),extra]),[tree],{allowScopedExtras:true}).records).toHaveLength(2);
    expect(collectSceneChecks(envelope([extra]),[tree],{allowScopedExtras:true}).accepted).toBe(false);
    expect(collectSceneChecks(envelope([passedCheck(tree),extra]),[tree]).accepted).toBe(false);
    const fail=collectSceneChecks(envelope([passedCheck(tree),{...extra,verified:false}],false),[tree],{allowScopedExtras:true});
    expect(fail.records.at(-1).status).toBe('failed');
  });
  it('does not claim behavior evidence for a static world, nor missing required checks as passed',()=>{
    const records=collectSceneChecks(envelope([passedCheck(tree)]),[tree]).records;
    const evidence=buildTaskEvidence({world,scope:'world-state',records,bound:true,worldReady:true});
    expect(evidence).toMatchObject({coverage:'agent-selected-postconditions',worldStatus:'verified',
      dimensions:{structure:{status:'verified',required:true},behavior:{status:'not-required',required:false},visual:{status:'not-required'}}});
    const missing=buildTaskEvidence({world,scope:'task-criteria',taskSpecStatus:'ready',records:pendingSceneRecords([tree,criterion])});
    expect(missing.dimensions.behavior).toMatchObject({required:true,status:'unverified',checks:[{reason:'CHECK_NOT_OBSERVED'}]});
    const stale=buildTaskEvidence({world,scope:'world-state',records,bound:false});
    expect(stale.dimensions.structure.checks[0]).toMatchObject({status:'unverified',reason:'WORLD_BINDING_UNCONFIRMED'});
  });
  it('native counts remain observations and reject a different runtime even with identical revisions',()=>{
    const measured={status:'inspected',...world,revision:3,node:{nodePath:''},counts:{nodes:4,meshes:2},
      boundsComplete:false,limitations:['shader-deformation-unknown'],playback:{frames:5,simulation:{tick:5}}};
    expect(nativeObservation(measured,world)).toMatchObject({status:'observed',counts:{nodes:4,meshes:2},boundsComplete:false,frame:5,tick:5});
    expect(nativeObservation({...measured,runtimeId:'runtime-other'},world)).toMatchObject({status:'unavailable'});
  });
  it('only admits the last matching visual review with a real-image digest',()=>{
    const old=visualVerdict({...world,runtimeId:'runtime-old'},{score:8});
    const now=visualVerdict();
    const pending=acceptedWorld();
    expect(pending.verified).toBe(false);
    const outcome=withVisualTaskEvidence(pending,{status:'passed',reviews:[old,now]});
    expect(outcome).toMatchObject({taskStatus:'completed',verified:true,
      evidence:{dimensions:{visual:{required:true,status:'assessed-pass',reviews:[{current:false},{current:true,frame:12,imageDigest:'b'.repeat(64)}]}}},
      verification:{status:'verified',reason:null},unresolvedMutations:[]});
    for(const invalid of [old,{...now,imageDigest:undefined},{...now,score:3}]){
      const result=withVisualTaskEvidence(pending,{status:'passed',reviews:[invalid]});
      expect(result).toMatchObject({taskStatus:'incomplete',verified:false,visual:{status:'unavailable'},evidence:{dimensions:{visual:{status:'unavailable'}}}});
    }
  });
  it('never admits visual success on an incomplete world binding or stale persistence',()=>{
    const partial=acceptedWorld({...world,runtimeId:null});
    expect(withVisualTaskEvidence(partial,{status:'passed',reviews:[visualVerdict()]}).verified).toBe(false);
    const unsaved=acceptedWorld();
    unsaved.evidence.persistence.status='unverified';
    expect(withVisualTaskEvidence(unsaved,{status:'passed',reviews:[visualVerdict()]}).verified).toBe(false);
  });
  it('invalidates world and persistence evidence when visual review detects a changed runtime',async()=>{
    for(const code of ['VISUAL_WORLD_SESSION_CHANGED','VISUAL_PROJECT_REVISION_CHANGED','VISUAL_VERIFIED_WORLD_CHANGED','VISUAL_IMAGE_STALE']){
      const result=await iterateVisualProject({prompt:'tree',initial:acceptedWorld(),
        review:async()=>{throw Object.assign(Error(code),{code});}});
      expect(result).toMatchObject({taskStatus:'incomplete',verified:false,
        verification:{status:'unverified',reason:'WORLD_MAY_HAVE_CHANGED'},
        evidence:{worldStatus:'unconfirmed',persistence:{status:'unverified'},
          dimensions:{structure:{status:'unverified'},visual:{status:'unavailable',reason:code}}}});
    }
  });
  it('invalidates previous current evidence when revision fails after possibly mutating the world',async()=>{
    const result=await iterateVisualProject({prompt:'tree',initial:acceptedWorld(),
      review:async()=>visualVerdict(world,{status:'needs-revision',score:4,issues:['Missing leaves'],advice:'Add leaves'}),
      revise:async()=>{throw Object.assign(Error('broken edit'),{code:'PROJECT_MODULE_SYNTAX'});}});
    expect(result).toMatchObject({taskStatus:'incomplete',verified:false,verification:{status:'unverified',reason:'WORLD_MAY_HAVE_CHANGED'},
      evidence:{worldStatus:'unconfirmed',persistence:{status:'unverified'},dimensions:{structure:{status:'unverified'},visual:{status:'blocked',reviews:[{current:false}]}}}});
  });
});
