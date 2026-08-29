import { compileInteractionIntent, executeBehaviorCommand, verifyBehaviorCommand } from '../../../world/runtime/behavior/BehaviorCompiler.js';
import { recordInteractionEvidence } from '../../../world/verification/InteractionEvidence.js';
import { meta, string } from '../skillPrimitives.js';

const recordBehaviorEvidence = (runtime, command, result, source) => {
  const verification=verifyBehaviorCommand(command,result);
  const targetId=command.capability==='PLACE' ? command.supportId : command.targetId;
  recordInteractionEvidence(runtime,{targetId,capability:command.capability,verified:verification.verified===true,source,commandId:command.commandId,result});
  return verification;
};

export function registerInteractionSkills(add,runtime) {
  add('approachAndInteract', { ...meta('具身 open/close 的首选单一工具：内部完成交互位搜索、真实 navigate、距离/物理视线/action-sweep 二次验证，再请求 motor target 并等待 live joint completion。只有 status=action-completed 且 targetReached=true/settled=true 才表示动作最终完成；STALL 返回 action-failed，TIMEOUT 返回 action-unverified。整个任务是一个 mutation。', ['world.write','spatial.read','physics.read'], ['actorId','targetId','action'], { actorId:string, targetId:string, action:{type:'string',enum:['open','close']}, partName:string, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), batchable:false, mutates:true }, async (a) => {
    const command=compileInteractionIntent({id:`direct-${a.action}`,actorId:a.actorId,targetId:a.targetId,capability:a.action},{worldRevisionId:runtime.currentWorldRevision?.revision?.id});
    const result=await runtime.interactions.approachAndInteract(a.actorId,a.targetId,a.action,{partName:a.partName,speed:a.speed});
    recordBehaviorEvidence(runtime,command,result,'approachAndInteract');
    return result;
  });
  add('executeBehaviorCommand', { ...meta('执行由 BehaviorCompiler 编译出的 typed RuntimeCommand。当前纵向切片只允许 OPEN/CLOSE interaction；命令必须包含 actorId/targetId，并且最终结果仍需 action-completed + targetReached + settled 才算验证完成。', ['world.write','spatial.read','physics.read'], ['command'], { command:{type:'object'} }), batchable:false, mutates:true }, async (a) => {
    const command=compileInteractionIntent(a.command?.source ? { id:a.command.source.interactionId, actorId:a.command.actorId, targetId:a.command.targetId, capability:a.command.capability } : a.command?.intent || a.command, { worldRevisionId:a.command?.source?.worldRevisionId });
    const result=await executeBehaviorCommand(runtime,command);
    const verification=recordBehaviorEvidence(runtime,command,result,'executeBehaviorCommand');
    return {...result,behaviorCommand:command,verification};
  });
  add('getArticulationStatus', meta('读取 articulated object 的 live joint 状态：当前 coordinate、requestedAction、verifiedAction，以及 moving/completed/failed/unverified observer 结果。STALL 若当前 physics backend 提供 contact evidence，会附 blockerCandidates；它表示失败时正在接触，不证明唯一因果。不会把 motor request 当成完成。', ['world.read','physics.read'], ['id'], { id:string, partName:string }), (a) => runtime.interactions.articulationStatus(a.id,a.partName));
  add('approachAndPickup', { ...meta('具身 pickup：Agent 先走到固定 1.5m 交互位并复核当前 physics scene-query LOS，再对对象到 hold anchor 做 shape-sweep；成功后记录 heldBy 并以 kinematic anchor 携带。不是 grasp force verification。', ['world.write','spatial.read','physics.read'], ['actorId','targetId'], { actorId:string, targetId:string, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), batchable:false, mutates:true }, async (a) => {
    const command=compileInteractionIntent({id:'direct-pickup',actorId:a.actorId,targetId:a.targetId,capability:'PICKUP'},{worldRevisionId:runtime.currentWorldRevision?.revision?.id});
    const result=await runtime.interactions.approachAndPickup(a.actorId,a.targetId,{speed:a.speed});
    recordBehaviorEvidence(runtime,command,result,'approachAndPickup');
    return result;
  });
  add('approachAndPlace', { ...meta('具身 place 的首选单一工具：被放置物由 actor 当前 held ownership 自动推导，不要传 held object id。supportId 是接收物体的支撑对象 ID（例如 table_01）；surfaceId 只是该支撑对象 Manifest 中可选的 surface 名（例如 top），绝不是对象 ID。内部完成 carry-aware approach、当前 physics backend 的 shape-cast release、Dynamic settle 与 ON/SUPPORTS post-condition。只有 status=placed 且 supportVerified=true 才表示最终放置成功。', ['world.write','spatial.read','physics.read'], ['actorId','supportId'], { actorId:{type:'string',description:'持有物体的 Agent ID，例如 agent_01'}, supportId:{type:'string',description:'接收放置物的支撑对象 ID，例如 table_01；不要填 cup_01'}, surfaceId:{type:'string',description:'可选 surface 名，例如 top；不要填对象 ID'}, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), batchable:false, mutates:true }, async (a) => {
    const command=compileInteractionIntent({id:'direct-place',actorId:a.actorId,supportId:a.supportId,capability:'PLACE'},{worldRevisionId:runtime.currentWorldRevision?.revision?.id});
    const result=await runtime.interactions.approachAndPlace(a.actorId,a.supportId,{surfaceId:a.surfaceId,speed:a.speed});
    recordBehaviorEvidence(runtime,command,result,'approachAndPlace');
    return result;
  });
  add('dropHeld', { ...meta('释放 Agent 当前 kinematic-anchor held object，恢复其原始 Physics body type。', ['world.write','physics.read'], ['actorId'], { actorId:string }), batchable:false, mutates:true }, (a) => runtime.interactions.dropHeld(a.actorId));
  add('getCarryStatus', meta('读取 Agent 当前 held-object ownership；held 只表示 kinematic-anchor attachment，不等于 graspVerified。', ['world.read','physics.read'], ['actorId'], { actorId:string }), (a) => runtime.interactions.carryStatus(a.actorId));
}
