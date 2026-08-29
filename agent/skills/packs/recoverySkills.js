import { buildRecoveryProposals } from '../../buildRecoveryProposals.js';
import { meta, string } from '../skillPrimitives.js';

export function registerRecoverySkills(add,runtime) {
  add('recoverPickupBlocker', { ...meta('执行一个窄范围的 articulated STALL recovery：仅当 blocker 仍是当前 external contact candidate、Policy 允许且具身 pickup preflight 仍通过时，才真实 approachAndPickup。它是辅助 mutation；成功只表示 blocker 被 held，不表示原始 open/close 已恢复，之后必须 retry 原始 action。', ['world.write','spatial.read','physics.read'], ['actorId','targetId','blockerId'], { actorId:string,targetId:string,partName:string,blockerId:string }), batchable:false,auxiliary:true,mutates:true }, async (a,{registry,context}) => {
    const recovery=await buildRecoveryProposals(runtime,registry,{actorId:a.actorId,targetId:a.targetId,partName:a.partName,profile:context.profile || 'builder'});
    const proposal=recovery.proposals.find((item)=>item.eligible && item.blocker?.kind==='object' && item.blocker.objectId===a.blockerId);
    if (!proposal) return {status:'recovery-stale',reason:recovery.proposals.find((item)=>item.blocker?.objectId===a.blockerId)?.reason || recovery.reason || 'RECOVERY_NOT_ELIGIBLE',actorId:a.actorId,targetId:a.targetId,blockerId:a.blockerId,retryOriginal:true};
    const pickup=await runtime.interactions.approachAndPickup(a.actorId,a.blockerId);
    if (pickup.status==='held') runtime.interactions.markRecoveryHeld(a.actorId,{
      blockerId:a.blockerId,targetId:a.targetId,partName:proposal.verification?.args?.partName || a.partName,
      action:proposal.verification?.args?.action || recovery.originalAction
    });
    return {...pickup,recovery:{kind:'pickup-blocker',blockerId:a.blockerId,evidence:proposal.evidence},retryOriginal:true,verification:proposal.verification};
  });
  add('recoverArticulatedBlocker', { ...meta('执行一个窄范围 articulated-Part blocker recovery：仅当该 blocker Part 仍是当前 contact candidate、当前 verified state 明确，且 Runtime 已通过唯一 alternate 或 counterfactual ranking 选出 blockerAction、Policy 与 interaction preflight 仍通过时，才真实 approachAndInteract 改变 blocker Part。它是 auxiliary mutation；成功只验证 blocker Part 改态，原始失败动作仍必须 fresh-replan 后 retry。', ['world.write','spatial.read','physics.read'], ['actorId','targetId','blockerId','blockerPartName','blockerAction'], {actorId:string,targetId:string,partName:string,blockerId:string,blockerPartName:string,blockerAction:{type:'string',enum:['open','close']},speed:{type:'number',exclusiveMinimum:0,maximum:8}}), batchable:false,auxiliary:true,mutates:true }, async(a,{registry,context})=>{
    const recovery=await buildRecoveryProposals(runtime,registry,{actorId:a.actorId,targetId:a.targetId,partName:a.partName,profile:context.profile || 'builder'});
    const proposal=recovery.proposals.find((item)=>
      item.eligible && item.recovery==='articulated-blocker'
      && item.blocker?.objectId===a.blockerId && item.blocker?.partName===a.blockerPartName
      && item.blockerAction===a.blockerAction
    );
    if (!proposal) {
      const current=recovery.proposals.find((item)=>item.blocker?.objectId===a.blockerId && item.blocker?.partName===a.blockerPartName);
      const selectionChanged=Boolean(current?.eligible && current.recovery==='articulated-blocker' && current.blockerAction && current.blockerAction!==a.blockerAction);
      return {
        status:'recovery-stale',
        reason:selectionChanged?'COUNTERFACTUAL_SELECTION_CHANGED':(current?.reason || recovery.reason || 'RECOVERY_NOT_ELIGIBLE'),
        actorId:a.actorId,targetId:a.targetId,blockerId:a.blockerId,blockerPartName:a.blockerPartName,blockerAction:a.blockerAction,
        ...(selectionChanged?{currentRecommendedAction:current.blockerAction}:{}),retryOriginal:true
      };
    }
    const interaction=await runtime.interactions.approachAndInteract(a.actorId,a.blockerId,a.blockerAction,{partName:a.blockerPartName,speed:a.speed});
    let counterfactualCalibration=null;
    const selectedEvidence=proposal.actionRanking?.actions?.find((item)=>item.action===a.blockerAction)?.physicsCounterfactual || null;
    const blockerActionVerified=interaction.status==='action-completed' && interaction.targetReached===true && interaction.settled===true;
    if (selectedEvidence?.checked && blockerActionVerified && typeof runtime.physics?.articulationContacts==='function') {
      const originalPartName=proposal.verification?.args?.partName || a.partName;
      const contacts=runtime.physics.articulationContacts(a.targetId,originalPartName) || [];
      const currentContactStillPresent=contacts.some((contact)=>{
        const target=contact?.target || {};
        return contact?.external===true && target.kind==='object' && target.objectId===a.blockerId
          && (target.partName || '$root')===a.blockerPartName;
      });
      const predictedClear=selectedEvidence.targetSweepClear===true;
      counterfactualCalibration={
        status:'observed',scope:'post-recovery-current-contact',causal:false,
        prediction:{
          strategy:proposal.actionRanking.strategy,basis:proposal.actionRanking.basis,
          targetSweepClear:predictedClear,
          targetConflictSamples:selectedEvidence.target?.conflictSamples ?? null,
          conflictReduction:selectedEvidence.conflictReduction ?? null,
          samples:structuredClone(selectedEvidence.samples || null)
        },
        observed:{blockerActionVerified:true,currentContactStillPresent},
        consistency:predictedClear ? (currentContactStillPresent?'contradicted':'consistent') : 'not-comparable',
        originalRetryRequired:true
      };
    }
    return {
      ...interaction,
      recovery:{kind:'articulated-blocker',blockerId:a.blockerId,blockerPartName:a.blockerPartName,blockerAction:a.blockerAction,evidence:proposal.evidence},
      ...(counterfactualCalibration?{counterfactualCalibration}:{}),
      retryOriginal:true,verification:proposal.verification
    };
  });
  add('suggestRecoveryCleanup', meta('只读为当前通过 recoverPickupBlocker 持有的 blocker 规划安全 cleanup。候选必须由当前 physics backend 的 scene-query 找到 Environment 支撑、位于原 articulation action sweep 外、Agent 可达且 carried-body endpoint clear。Proposal 不修改世界。', ['world.read','spatial.read','physics.read'], ['actorId','targetId'], {actorId:string,targetId:string,partName:string,blockerId:string,action:{type:'string',enum:['open','close']}}), (a)=>runtime.interactions.findRecoveryCleanupPlan(a.actorId,a.targetId,{partName:a.partName,blockerId:a.blockerId,action:a.action}));
  add('cleanupRecoveryBlocker', { ...meta('对当前 recovery-held blocker 执行 verified cleanup：真实导航到 cleanup pose，经当前 physics backend 的 body-motion transfer 释放为 Dynamic，等待 settle，并验证 blocker 已释放、离开原 action sweep 且不再接触失败 Part。recovery-cleaned 只表示 cleanup 成功，不表示原始任务成功。', ['world.write','spatial.read','physics.read'], ['actorId','targetId','blockerId'], {actorId:string,targetId:string,partName:string,blockerId:string,action:{type:'string',enum:['open','close']},speed:{type:'number',exclusiveMinimum:0,maximum:8}}), batchable:false,auxiliary:true,mutates:true }, async(a)=>{
    const result=await runtime.interactions.cleanupRecoveryBlocker(a.actorId,a.targetId,{partName:a.partName,blockerId:a.blockerId,action:a.action,speed:a.speed});
    if (result.status==='cleanup-unavailable') return {status:'recovery-cleanup-blocked',reason:result.reason || 'CLEANUP_UNAVAILABLE',actorId:a.actorId,targetId:a.targetId,blockerId:a.blockerId,plan:result};
    return result;
  });
  add('suggestRecoveryActions', meta('针对最近一次 articulated STALL 只读生成恢复候选。对当前仍接触的 blocker 做 typed recovery eligibility：Dynamic root Object 可走 pickup recovery，具有 verified current state 且唯一 alternate open/close 的 articulated Part 可走 articulated recovery；Environment、stale/ambiguous/Policy denied 均明确拒绝。Recovery proposal 不是成功，执行后必须 retry 原始 action 并重新验证 post-condition。', ['world.read','physics.read'], ['actorId','targetId'], { actorId:string,targetId:string,partName:string }), (a,{registry,context}) => buildRecoveryProposals(runtime,registry,{actorId:a.actorId,targetId:a.targetId,partName:a.partName,profile:context.profile || 'builder'}));
}
