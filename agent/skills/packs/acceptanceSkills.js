import { buildAcceptanceEvidenceBundle, compileWorldAcceptance, evaluateWorldAcceptance, replayAcceptanceEvidence } from '../../../world/verification/WorldAcceptance.js';
import { meta } from '../skillPrimitives.js';

export function registerAcceptanceSkills(add,runtime) {
  add('evaluateWorldAcceptance', { ...meta('对当前世界执行显式 world-level acceptance criteria。只读；返回逐项证据和最终 world-accepted/world-incomplete。', ['world.read','physics.read'], ['criteria'], { criteria:{type:'array'} }), batchable:true, mutates:false }, async (a) => {
    const graph=compileWorldAcceptance(a.criteria || []);
    const task=runtime.lastTaskObservation || {};
    const result=evaluateWorldAcceptance(runtime,graph,{unresolvedMutations:Array.isArray(task.unresolvedMutations)?task.unresolvedMutations:undefined});
    const revision=runtime.currentWorldRevision;
    const bundle=buildAcceptanceEvidenceBundle(graph,result,{source:'agent-tool',worldRevisionId:revision?.revision?.id || null,provenance:revision?.provenance || null});
    runtime.lastAcceptanceBundle=structuredClone(bundle);
    runtime.trace?.emit?.('world.acceptance',{bundle:structuredClone(bundle)},{actor:'agent'});
    return {...result,acceptanceBundle:bundle};
  });
  add('replayWorldAcceptance', { ...meta('重新验证已保存的 acceptance evidence。restore 后的 evidence 仅是 historical；只有 revision 绑定一致且当前 Runtime 重跑 criteria 后仍为 world-accepted，才会生成新的 current acceptance bundle。', ['world.read','physics.read'], [], { evidence:{type:'object'} }), batchable:true, mutates:false }, async (a) => {
    const source=a.evidence || runtime.restoredAcceptanceEvidence || runtime.lastAcceptanceBundle;
    const task=runtime.lastTaskObservation || {};
    let replay;
    if(source){
      replay=replayAcceptanceEvidence(runtime,source,{unresolvedMutations:Array.isArray(task.unresolvedMutations)?task.unresolvedMutations:undefined});
    } else {
      const graph=compileWorldAcceptance([]);
      const result={schema:'agentscape.world-acceptance',schemaVersion:1,status:'world-incomplete',checks:[{id:'acceptance-evidence',kind:'evidence',verified:false,reason:'ACCEPTANCE_EVIDENCE_MISSING'}],verifiedCount:0,failedCount:1};
      const revision=runtime.currentWorldRevision;
      const bundle=buildAcceptanceEvidenceBundle(graph,result,{source:'acceptance-replay',worldRevisionId:revision?.revision?.id || null,provenance:revision?.provenance || null});
      replay={...result,replay:{status:'unavailable',reason:'ACCEPTANCE_EVIDENCE_MISSING',evidenceRevisionId:null,currentRevisionId:revision?.revision?.id || null,previousStatus:null,changedCriteria:['acceptance-evidence']},acceptanceBundle:bundle};
    }
    runtime.lastAcceptanceBundle=structuredClone(replay.acceptanceBundle);
    runtime.trace?.emit?.('world.acceptance-replayed',{replay:structuredClone(replay.replay),bundle:structuredClone(replay.acceptanceBundle)},{actor:'agent'});
    return replay;
  });
}
