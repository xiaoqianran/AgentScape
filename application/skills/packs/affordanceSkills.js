import { meta,string } from '../skillPrimitives.js';

import { WorldCommands } from '../../../modules/world/runtime/WorldCommands.js';

export function registerAffordanceSkills(add,runtime) {
  const queries = runtime.queries;
  const commands = runtime.commands ||= new WorldCommands(runtime);
  if (!queries) throw new TypeError('registerAffordanceSkills requires runtime.queries');
  if (!commands) throw new TypeError('registerAffordanceSkills requires runtime.commands');
  add('listWorldAffordances',meta('发现世界交互契约：门窗、灯、抽屉、书与文字的稳定 ID、状态、动作、距离/遮挡限制。未列出的装饰不代表 Agent 能力。', ['world.read'],[],{query:string,actorId:string,limit:{type:'integer',minimum:1,maximum:100}}),(args,execution)=>queries.listAffordances({...args,actorId:args.actorId || execution.context.actor}));
  add('inspectWorldAffordance',meta('读取物件状态、动作条件和验证类型。状态验证与物理验证分别报告。', ['world.read'],['targetId'],{targetId:string,actorId:string}),(args,execution)=>queries.inspectAffordance(args.targetId,{actorId:args.actorId || execution.context.actor}));
  add('executeWorldAction',{
    ...meta('执行已发现的世界交互，必须在 1.5 米内且无遮挡。OUT_OF_REACH 时先 navigateTo 到目标附近可站立位置。write 必须传 text。等待实际状态稳定或返回未验证；verified 不等于 physicsVerified。', ['world.write','physics.read'],['targetId','action'],{targetId:string,actorId:string,action:{type:'string',enum:['open','close','turn_on','turn_off','read','write','pull_out','return']},text:{type:'string',maxLength:100}}),
    mutates:true,batchable:false
  },(args,execution)=>commands.executeAffordance({...args,actorId:args.actorId || execution.context.actor,args:{text:args.text}}));
}
