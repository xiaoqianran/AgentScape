import { meta, number, string, vec3 } from '../skillPrimitives.js';

import { WorldCommands } from '../../../modules/world/runtime/WorldCommands.js';

export function registerSceneSkills(add,runtime) {
  const queries = runtime.queries;
  const commands = runtime.commands ||= new WorldCommands(runtime);
  if (!queries) throw new TypeError('registerSceneSkills requires runtime.queries');
  if (!commands) throw new TypeError('registerSceneSkills requires runtime.commands');
  add('listObjects', meta('列出当前世界中的对象及其位置和能力。', ['world.read']), () => queries.listObjects());
  add('spawnAsset', { ...meta('实例化一个已注册资产。WorldCommands 统一执行 Asset admission；provisional 只进入编辑态，rejected 不会实例化。', ['world.write'], ['assetId', 'position'], { assetId: string, position: vec3, instanceId: string }), mutates: true }, (a) => commands.spawn(a.assetId,{position:a.position,id:a.instanceId}));
  add('moveObject', { ...meta('移动世界实例到指定世界坐标。通过统一 Transform mutation contract 同步 Physics / Navigation / History。', ['world.write'], ['id', 'position'], { id: string, position: vec3 }), mutates: true }, (a) => commands.transform(a.id,{position:a.position},{source:'agent'}));
  add('rotateObject', { ...meta('按 XYZ 欧拉角（度）旋转世界实例。用于场景编排，不修改原始 Asset。', ['world.write'], ['id', 'rotation'], { id:string, rotation:vec3 }), mutates:true }, (a) => commands.transform(a.id,{rotationDegrees:a.rotation},{source:'agent'}));
  add('scaleObject', { ...meta('统一缩放世界实例。当前仅支持 0.05–20 倍的 uniform scale；articulated 资产暂不允许缩放。', ['world.write'], ['id', 'scale'], { id:string, scale:{...number,minimum:0.05,maximum:20} }), mutates:true }, (a) => commands.transform(a.id,{scale:a.scale},{source:'agent'}));
  add('transformObject', { ...meta('一次性修改世界实例的位置、旋转和统一缩放。只修改 Instance，不修改 Asset。', ['world.write'], ['id'], { id:string, position:vec3, rotation:vec3, scale:{...number,minimum:0.05,maximum:20} }), mutates:true }, (a) => commands.transform(a.id,{position:a.position,rotationDegrees:a.rotation,scale:a.scale},{source:'agent'}));
  add('pickup', { ...meta('低层 Human/scene pickup 原语：对象跟随 Human Camera；具身 Agent 不应调用它，应使用 approachAndPickup。', ['world.write'], ['id'], { id: string }), batchable:false, mutates: true }, (a) => commands.pickup(a.id));
  add('drop', { ...meta('低层 Human/scene drop 原语；具身 Agent 应使用 dropHeld。', ['world.write'], [], { id: string }), batchable:false, mutates: true }, (a) => commands.drop(a.id));
  add('place', { ...meta('低层 Human/scene deterministic place 原语：直接移动对象到支撑面；具身 Agent 持有物体时应使用 approachAndPlace。', ['world.write'], ['id', 'targetId'], { id: string, targetId: string, surfaceId: string, clearance: { type: 'number', minimum: 0 } }), mutates: true }, (a) => commands.place(a.id, a.targetId, { surfaceId: a.surfaceId, clearance: a.clearance }));
  add('open', { ...meta('低层 articulation motor request：只请求 open target；不要把返回当成关节已完成。具身 Agent 应使用 approachAndInteract 获得 live completion。', ['world.write'], ['id'], { id: string, partName: string }), batchable:false, mutates: true }, (a) => commands.setArticulationAction(a.id, 'open', { partName: a.partName }));
  add('close', { ...meta('低层 articulation motor request：只请求 close target；不要把返回当成关节已完成。具身 Agent 应使用 approachAndInteract 获得 live completion。', ['world.write'], ['id'], { id: string, partName: string }), batchable:false, mutates: true }, (a) => commands.setArticulationAction(a.id, 'close', { partName: a.partName }));
  add('duplicateObject', { ...meta('复制对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => commands.duplicate(a.id));
  add('removeObject', { ...meta('删除对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => commands.remove(a.id));

}
