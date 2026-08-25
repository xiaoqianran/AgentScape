import { describe, expect, it } from 'vitest';
import { buildAcceptanceEvidenceBundle, compileWorldAcceptance, evaluateWorldAcceptance, replayAcceptanceEvidence } from '../src/validation/WorldAcceptance.js';

describe('WorldAcceptance',()=>{
  const runtime={store:{get:id=>({id,state:{enabled:id==='light',lastVerifiedAction:id==='door'?'OPEN':null}})},validator:{run:()=>({ok:true,counts:{hard:0}})}};
  it('compiles explicit world-level criteria',()=>expect(compileWorldAcceptance([{id:'valid',kind:'world-valid'},{id:'light-on',kind:'state-equals',targetId:'light',stateKey:'enabled',value:true},{id:'door-open',kind:'interaction-verified',targetId:'door',capability:'open'},{id:'clean',kind:'no-unresolved'}]).checks).toHaveLength(4));
  it('returns world-accepted only when every criterion is verified',()=>expect(evaluateWorldAcceptance(runtime,compileWorldAcceptance([{id:'valid',kind:'world-valid'},{id:'light-on',kind:'state-equals',targetId:'light',stateKey:'enabled',value:true},{id:'door-open',kind:'interaction-verified',targetId:'door',capability:'open'},{id:'clean',kind:'no-unresolved'}]),{unresolvedMutations:[]}).status).toBe('world-accepted'));
  it('reports incomplete evidence instead of collapsing failure into task success',()=>{const result=evaluateWorldAcceptance(runtime,compileWorldAcceptance([{id:'light-off',kind:'state-equals',targetId:'light',stateKey:'enabled',value:false},{id:'clean',kind:'no-unresolved'}]),{unresolvedMutations:[{tool:'approachAndInteract'}]});expect(result.status).toBe('world-incomplete');expect(result.failedCount).toBe(2);});
  it('builds a serializable acceptance evidence bundle with revision and provenance',()=>{const graph=compileWorldAcceptance([{id:'valid',kind:'world-valid'}]);const result=evaluateWorldAcceptance(runtime,graph);const bundle=buildAcceptanceEvidenceBundle(graph,result,{worldRevisionId:'rev-7',source:'world-pipeline',provenance:{source:'planner'}});expect(bundle).toMatchObject({schema:'agentscape.acceptance-evidence',schemaVersion:1,required:true,worldRevisionId:'rev-7',source:'world-pipeline',result:{status:'world-accepted'},findings:[]});expect(()=>JSON.stringify(bundle)).not.toThrow();});
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
