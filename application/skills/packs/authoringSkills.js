import { meta, string } from '../skillPrimitives.js';

export function registerAuthoringSkills(add, promotion) {
  const usage = { type:'string', enum:['static', 'movable', 'interactive'] };
  const options = { nodeId:string, usage, allowProvisional:{ type:'boolean' } };
  add('listAuthoringNodes', meta('列出创作对象、晋升状态、待更新状态及运行验证结果。', ['world.read']), () => promotion.list());
  add('prepareAuthoringAsset', { ...meta('把创作节点或分组准备成正式 Asset；保留原稿，准备成功不代表世界行为验证成功。', ['world.read', 'asset.read', 'asset.write'], ['nodeId'], { nodeId:string, usage }), batchable:false }, a => promotion.prepare(a.nodeId, a));
  for (const [name, update] of [['promoteAuthoringNode', false], ['updateAuthoringEntity', true]]) {
    add(name, { ...meta(update ? '显式更新已晋升实体；失败恢复旧实体，原稿撤销不会触发此操作。' : '把创作节点晋升到当前 World；执行资产准入、放置预检和运行时检查。allowProvisional 仅允许编辑态，不宣称行为已验证。',
      ['world.write', 'asset.read', 'asset.write', 'physics.read'], ['nodeId'], options),
      mutates:true, manualMutation:true, batchable:false }, a => promotion.promote(a.nodeId, { ...a, update }));
  }
  add('restoreAuthoringEntities', { ...meta('恢复当前创作存档关联且缺失的正式实体；不覆盖冲突 ID，不跨世界恢复。', ['world.write', 'asset.read', 'physics.read'], [], { allowProvisional:{ type:'boolean' } }), mutates:true, manualMutation:true, batchable:false }, a => promotion.restore(a));
  add('detachAuthoringEntity', { ...meta('解除原稿与正式实体的关联，保留正式实体，并重新显示独立原稿。', ['world.write'], ['nodeId'], { nodeId:string }), mutates:true, manualMutation:true, batchable:false }, a => promotion.detach(a.nodeId));
  add('verifyAuthoringEntity', { ...meta('检查已晋升实体的物理位置与导航，并可显式执行 Agent 交互验证；验证不会提升 Asset 准入状态。', ['world.write', 'physics.read', 'spatial.read'], ['nodeId'], { nodeId:string, exerciseInteraction:{ type:'boolean' } }), mutates:true, manualMutation:true, batchable:false }, a => promotion.verifyEntity(a.nodeId, a));
}
