import { assetAdmission } from '../../../asset/admission.js';
import { meta, string, vec3 } from '../skillPrimitives.js';

export function registerSceneSkills(add,runtime) {
  add('listObjects', meta('列出当前世界中的对象及其位置和能力。', ['world.read']), () => runtime.listObjects());
  add('spawnAsset', { ...meta('实例化一个已注册资产。若资产 admission 不是 ready，仍可作为编辑态实例化，但返回 asset-provisional，不能当作 verified world mutation。', ['world.write'], ['assetId', 'position'], { assetId: string, position: vec3, instanceId: string }), mutates: true }, async (a) => {
    const admission=assetAdmission(runtime.assets.getManifest(a.assetId));
    if (admission.status==='rejected') return {status:'asset-rejected',assetId:a.assetId,admission};
    const id=await runtime.spawn(a.assetId,{position:a.position,id:a.instanceId});
    return admission.status==='ready' ? id : {status:'asset-provisional',id,assetId:a.assetId,admission};
  });
  add('moveObject', { ...meta('移动对象到世界坐标。', ['world.write'], ['id', 'position'], { id: string, position: vec3 }), mutates: true }, (a) => runtime.interactions.move(a.id, a.position));
  add('pickup', { ...meta('低层 Human/scene pickup 原语：对象跟随 Human Camera；具身 Agent 不应调用它，应使用 approachAndPickup。', ['world.write'], ['id'], { id: string }), batchable:false, mutates: true }, (a) => runtime.interactions.pickup(a.id));
  add('drop', { ...meta('低层 Human/scene drop 原语；具身 Agent 应使用 dropHeld。', ['world.write'], [], { id: string }), batchable:false, mutates: true }, (a) => runtime.interactions.drop(a.id));
  add('place', { ...meta('低层 Human/scene deterministic place 原语：直接移动对象到支撑面；具身 Agent 持有物体时应使用 approachAndPlace。', ['world.write'], ['id', 'targetId'], { id: string, targetId: string, surfaceId: string, clearance: { type: 'number', minimum: 0 } }), mutates: true }, (a) => runtime.interactions.place(a.id, a.targetId, { surfaceId: a.surfaceId, clearance: a.clearance }));
  add('open', { ...meta('低层 articulation motor request：只请求 open target；不要把返回当成关节已完成。具身 Agent 应使用 approachAndInteract 获得 live completion。', ['world.write'], ['id'], { id: string, partName: string }), batchable:false, mutates: true }, (a) => runtime.interactions.setArticulationAction(a.id, 'open', { partName: a.partName }));
  add('close', { ...meta('低层 articulation motor request：只请求 close target；不要把返回当成关节已完成。具身 Agent 应使用 approachAndInteract 获得 live completion。', ['world.write'], ['id'], { id: string, partName: string }), batchable:false, mutates: true }, (a) => runtime.interactions.setArticulationAction(a.id, 'close', { partName: a.partName }));
  add('duplicateObject', { ...meta('复制对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => runtime.duplicate(a.id));
  add('removeObject', { ...meta('删除对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => runtime.remove(a.id));

}
