import { describe, expect, it } from 'vitest';
import { buildAcceptanceEvidenceBundle, compileWorldAcceptance, evaluateWorldAcceptance, replayAcceptanceEvidence } from '../../world/verification/WorldAcceptance.js';
import { recordInteractionEvidence } from '../../world/verification/InteractionEvidence.js';

describe('WorldAcceptance',()=>{
  const runtime={
    currentWorldRevision:{revision:{id:'rev-test'}},
    store:{get:id=>({id,state:{enabled:id==='light'}})},
    validator:{run:()=>({ok:true,counts:{hard:0}})}
  };

  it('compiles explicit world-level criteria',()=>expect(compileWorldAcceptance([
    {id:'valid',kind:'world-valid'},
    {id:'light-on',kind:'state-equals',targetId:'light',stateKey:'enabled',value:true},
    {id:'door-open',kind:'interaction-verified',targetId:'door',capability:'open'},
    {id:'clean',kind:'no-unresolved'}
  ]).checks).toHaveLength(4));

  it('returns world-accepted only when every criterion is verified',()=>{
    recordInteractionEvidence(runtime,{targetId:'door',capability:'OPEN',verified:true,source:'test'});
    const result=evaluateWorldAcceptance(runtime,compileWorldAcceptance([
      {id:'valid',kind:'world-valid'},
      {id:'light-on',kind:'state-equals',targetId:'light',stateKey:'enabled',value:true},
      {id:'door-open',kind:'interaction-verified',targetId:'door',capability:'open'},
      {id:'clean',kind:'no-unresolved'}
    ]),{unresolvedMutations:[]});
    expect(result.status).toBe('world-accepted');
  });

  it('reports incomplete evidence instead of collapsing failure into task success',()=>{
    const result=evaluateWorldAcceptance(runtime,compileWorldAcceptance([
      {id:'light-off',kind:'state-equals',targetId:'light',stateKey:'enabled',value:false},
      {id:'clean',kind:'no-unresolved'}
    ]),{unresolvedMutations:[{tool:'approachAndInteract'}]});
    expect(result.status).toBe('world-incomplete');
    expect(result.failedCount).toBe(2);
  });

  it('uses supplied final validation evidence for world-valid without rerunning Validator',()=>{
    let calls=0;
    const world={validator:{run:()=>{calls++;return {ok:false,counts:{hard:1}};}}};
    const validation={ok:true,counts:{hard:0,advisory:0},findings:[]};
    const result=evaluateWorldAcceptance(world,compileWorldAcceptance([{id:'valid',kind:'world-valid'}]),{validationEvidence:validation});
    expect(result).toMatchObject({status:'world-accepted',checks:[{id:'valid',verified:true,evidence:{validation:{ok:true}}}]});
    expect(calls).toBe(0);
  });

  it('builds a serializable acceptance evidence bundle with revision and provenance',()=>{
    const graph=compileWorldAcceptance([{id:'valid',kind:'world-valid'}]);
    const result=evaluateWorldAcceptance(runtime,graph);
    const bundle=buildAcceptanceEvidenceBundle(graph,result,{worldRevisionId:'rev-7',source:'world-pipeline',provenance:{source:'planner'}});
    expect(bundle).toMatchObject({schema:'agentscape.acceptance-evidence',schemaVersion:1,required:true,worldRevisionId:'rev-7',source:'world-pipeline',result:{status:'world-accepted'},findings:[]});
    expect(()=>JSON.stringify(bundle)).not.toThrow();
  });

  it('replays historical acceptance against the current revision and detects state drift',()=>{
    const graph=compileWorldAcceptance([{id:'light-on',kind:'state-equals',targetId:'light',stateKey:'enabled',value:true}]);
    const accepted=evaluateWorldAcceptance(runtime,graph,{unresolvedMutations:[]});
    const evidence=buildAcceptanceEvidenceBundle(graph,accepted,{worldRevisionId:'rev-7',source:'world-pipeline',provenance:{source:'planner'}});
    const same={...runtime,currentWorldRevision:{revision:{id:'rev-7'},provenance:{source:'planner'}}};
    expect(replayAcceptanceEvidence(same,evidence,{unresolvedMutations:[]})).toMatchObject({status:'world-accepted',replay:{status:'replayed',changedCriteria:[]},acceptanceBundle:{source:'acceptance-replay'}});
    const drift={...same,store:{get:id=>({id,state:{enabled:false}})}};
    const replay=replayAcceptanceEvidence(drift,evidence,{unresolvedMutations:[]});
    expect(replay).toMatchObject({status:'world-incomplete',replay:{status:'replayed',changedCriteria:['light-on']}});
    expect(replay.acceptanceBundle.findings[0]).toMatchObject({source:'world-acceptance',code:'A_STATE_MISMATCH'});
  });

  it('fails closed when historical acceptance belongs to another world revision',()=>{
    const graph=compileWorldAcceptance([{id:'valid',kind:'world-valid'}]);
    const evidence=buildAcceptanceEvidenceBundle(graph,evaluateWorldAcceptance(runtime,graph),{worldRevisionId:'rev-old',source:'world-pipeline'});
    const replay=replayAcceptanceEvidence({...runtime,currentWorldRevision:{revision:{id:'rev-new'},provenance:{source:'planner'}}},evidence);
    expect(replay).toMatchObject({status:'world-incomplete',replay:{status:'stale',reason:'WORLD_REVISION_CHANGED',evidenceRevisionId:'rev-old',currentRevisionId:'rev-new'}});
    expect(replay.acceptanceBundle.findings[0].code).toBe('A_WORLD_REVISION_CHANGED');
  });
});


it('verifies Runtime-derived spatial relations, including an optional support surface',()=>{
  const edges=[{subject:'cup',predicate:'ON',object:'table',meta:{surfaceId:'top',gap:0.002}}];
  const world={
    sceneGraph:{update:()=>{},list:({subject,predicate,object})=>edges.filter((edge)=>edge.subject===subject&&edge.predicate===predicate&&edge.object===object)}
  };
  const graph=compileWorldAcceptance([{id:'cup-on-table',kind:'relation-exists',subject:'cup',predicate:'on',object:'table',surfaceId:'top'}]);
  expect(evaluateWorldAcceptance(world,graph)).toMatchObject({
    status:'world-accepted',checks:[{id:'cup-on-table',verified:true,subject:'cup',predicate:'ON',object:'table',surfaceId:'top'}]
  });
  const wrongSurface=compileWorldAcceptance([{id:'cup-on-shelf',kind:'relation-exists',subject:'cup',predicate:'ON',object:'table',surfaceId:'shelf'}]);
  expect(evaluateWorldAcceptance(world,wrongSurface)).toMatchObject({status:'world-incomplete',checks:[{reason:'RELATION_NOT_FOUND'}]});
});

it('requires an explicit acceptance kind instead of silently defaulting semantic fields',()=>{
  expect(()=>compileWorldAcceptance([{id:'ambiguous',targetId:'door',capability:'OPEN'}])).toThrow(/requires kind/);
});
