import { meta,string } from '../skillPrimitives.js';

import { WorldCommands } from '../../../modules/world/runtime/WorldCommands.js';

export function registerAffordanceSkills(add,runtime) {
  const queries = runtime.queries;
  const commands = runtime.commands ||= new WorldCommands(runtime);
  if (!queries) throw new TypeError('registerAffordanceSkills requires runtime.queries');
  if (!commands) throw new TypeError('registerAffordanceSkills requires runtime.commands');
  add('listWorldAffordances',meta('发现世界交互契约：门窗、灯、抽屉、书与文字的稳定 ID、状态、动作、距离/遮挡限制。环境里还有更多原生 Three.js 交互（座椅、摆件、魔镜等），用 listInteractablesNearMe 或 listEnvironmentInteractables 查看；未列出且无 contractId 的原生交互仅为 provisional 场景能力。', ['world.read'],[],{query:string,actorId:string,limit:{type:'integer',minimum:1,maximum:100}}),(args,execution)=>queries.listAffordances({...args,actorId:args.actorId || execution.context.actor}));
  add('listEnvironmentInteractables', meta('列出当前环境的原生 Three.js 交互目录（如魔女小屋的门/窗/座椅/摆件），含 label、contractId、距离与执行入口。用于“这个场景里还能摸什么”。大世界请把 radius 调到 8–20。', ['world.read','spatial.read'], [], { actorId:string, radius:{type:'number',exclusiveMinimum:0,maximum:20} }), (args, execution) => queries.listEnvironmentInteractables({
    actorId: args.actorId || execution?.context?.actor || null,
    radius: args.radius
  }));
  add('activateEnvironmentInteract', {
    ...meta('激活环境原生 Three.js 交互（魔女小屋等场景自带物件）。interactionId 来自 listInteractablesNearMe.nativeInteractables 或 listEnvironmentInteractables。必须已在 1.5m 内；若距离不够请改用 approachAndActivateEnvironmentInteract。有 contractId 的会尽量走 WorldAffordances 验证；无契约的原生交互返回 environment-interaction-activated + provisional，不得当作力/关节物理已验证。', ['world.write','physics.read','world.read'], ['interactionId'], { interactionId:string, actorId:string }),
    mutates:true, batchable:false
  }, (args, execution) => commands.activateEnvironmentInteraction(args.interactionId, {
    actorId: args.actorId || execution?.context?.actor || null
  }));
  add('approachAndActivateEnvironmentInteract', {
    ...meta('具身操作环境原生 Three.js 交互的首选单一工具：Runtime 在 interactionId 周围采样多个可站立 approach 点（不把门轴/物件中心当终点）→ Recast 寻路 → locomotion → 1.5m 内激活/契约验证。返回 phase=activated 后若 navigationInvalidated=true，必须 fresh replan 再 navigateTo/findPath 进屋或上楼。不要手工拼 navigateTo 坐标，也不要 navigate 到 agent 自身 id。', ['world.write','spatial.read','physics.read','world.read'], ['interactionId'], { interactionId:string, actorId:string, speed:{type:'number',exclusiveMinimum:0,maximum:8} }),
    mutates:true, batchable:false
  }, (args, execution) => commands.approachAndActivateEnvironmentInteract(args.interactionId, {
    actorId: args.actorId || execution?.context?.actor || null,
    speed: args.speed
  }));
  add('findEnvironmentInteractApproach', meta('只读诊断：为环境原生交互计算可达的可站立 approach 点（门外/楼梯口等），不移动也不激活。当 approachAndActivate 报 unreachable，或需要先确认能否进屋上楼时使用。', ['world.read','spatial.read','physics.read'], ['interactionId'], { interactionId:string, actorId:string }), (args, execution) => commands.findEnvironmentInteractApproach(args.interactionId, {
    actorId: args.actorId || execution?.context?.actor || null
  }));
  add('inspectWorldAffordance',meta('读取物件状态、动作条件和验证类型。状态验证与物理验证分别报告。', ['world.read'],['targetId'],{targetId:string,actorId:string}),(args,execution)=>queries.inspectAffordance(args.targetId,{actorId:args.actorId || execution.context.actor}));
  add('executeWorldAction',{
    ...meta('执行已发现的世界交互，必须在 1.5 米内且无遮挡。OUT_OF_REACH 时先 navigateTo 到目标附近可站立位置。write 必须传 text。等待实际状态稳定或返回未验证；verified 不等于 physicsVerified。', ['world.write','physics.read'],['targetId','action'],{targetId:string,actorId:string,action:{type:'string',enum:['open','close','turn_on','turn_off','read','write','pull_out','return']},text:{type:'string',maxLength:100}}),
    mutates:true,batchable:false
  },(args,execution)=>commands.executeAffordance({...args,actorId:args.actorId || execution.context.actor,args:{text:args.text}}));
}
