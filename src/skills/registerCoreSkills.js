import { EmbodiedGenAdapter } from '../adapters/EmbodiedGenAdapter.js';

const string = { type: 'string' };
const number = { type: 'number' };
const vec3 = { type: 'array', items: number, minItems: 3, maxItems: 3 };
const meta = (description, permissions, required = [], properties = {}) => ({ description, permissions, required, properties });

const syncLiveVerification = (runtime, assetId, manifest) => {
  for (const record of runtime.store?.values?.() || []) {
    if (record.assetId !== assetId) continue;
    record.manifest.verification = structuredClone(manifest.verification || {});
    if (manifest.compiler?.quality && record.manifest.compiler) {
      record.manifest.compiler.quality = structuredClone(manifest.compiler.quality);
    }
    if (record.object?.userData?.manifest) {
      record.object.userData.manifest.verification = structuredClone(record.manifest.verification);
      if (record.manifest.compiler?.quality && record.object.userData.manifest.compiler) {
        record.object.userData.manifest.compiler.quality = structuredClone(record.manifest.compiler.quality);
      }
    }
  }
};

export function registerCoreSkills(registry, runtime) {
  const add = (name, options, handler) => registry.register({ name, ...options, handler });

  add('compileAsset', {
    ...meta('把 GLB 编译为可运行的 Agent 资产。', ['asset.write'], [], { url:string, sourceName:string, assetId:string, label:string, partProposal:{type:'object'}, partSegmentation:{type:'object'} }),
    validate: (input) => input?.url || input?.bytes ? { ok: true } : { ok: false, message: 'url or bytes required' }
  }, async (input) => {
    const compiler = await runtime.getAssetCompiler();
    const result = await compiler.compile(input);
    runtime.assets.registerManifest(result.manifest);
    runtime.events.emit('asset.compiled', { assetId: result.manifest.id, report: result });
    return result;
  });
  add('verifyAssetArticulation', { ...meta('在隔离的 Rapier World 中执行 Part/Joint 运动轨迹验证（目标、碰撞、停滞、回程），并把结果写回 Manifest。', ['asset.write', 'physics.read'], ['assetId'], { assetId: string }), mutates: false }, async (a) => {
    const report = await runtime.articulationVerifier.verify(a.assetId);
    const manifest = structuredClone(runtime.assets.getManifest(a.assetId));
    manifest.verification = { ...(manifest.verification || {}), articulation: report };
    const quality = manifest.compiler?.quality;
    if (quality) {
      quality.advisory = (quality.advisory || []).filter((item) => item.code !== 'ARTICULATION_UNVERIFIED');
      if (!report.ok) quality.advisory.push({ code: 'ARTICULATION_VERIFICATION_FAILED', message: '可执行 Part/Joint 未通过运行时运动轨迹验证。' });
      quality.status = quality.hard?.length ? 'rejected' : quality.advisory.length ? 'provisional' : 'ready';
    }
    runtime.assets.registerManifest(manifest, { replace: true });
    syncLiveVerification(runtime, a.assetId, manifest);
    runtime.events.emit('asset.verified', { assetId: a.assetId, articulation: report });
    return { ...report, readiness: quality?.status || null };
  });
  add('inspectCompiledAsset', meta('读取已编译资产的编译报告。', ['asset.read'], ['assetId'], { assetId: string }), (a) => runtime.assets.getManifest(a.assetId).compiler || null);
  add('listAssets', meta('列出资产库。', ['asset.read']), () => runtime.assetLibrary.list());
  add('searchAssets', meta('按名称、类型、标签或别名搜索可复用资产。', ['asset.read'], ['query'], { query: string, limit: { type: 'integer', minimum: 1, maximum: 20 } }), (a) => runtime.assetLibrary.search(a.query, { limit: a.limit ?? 8 }));
  add('generateAsset', meta('使用已配置的生成后端创建并注册缺失资产；调用前应先搜索。', ['asset.write'], ['prompt'], { prompt: string }), (a) => runtime.assetLibrary.generate(a.prompt));
  add('importEmbodiedGenAsset', meta('把 EmbodiedGen 风格资产规范化并注册到浏览器运行时。', ['asset.write'], ['payload'], { payload: { type: 'object' }, id: string, glbUrl: string }), (a) => {
    const manifest = new EmbodiedGenAdapter().toManifest(a.payload, { id: a.id, glbUrl: a.glbUrl });
    runtime.assets.registerManifest(manifest);
    runtime.events.emit('asset.registered', { assetId: manifest.id, provider: 'embodiedgen' });
    return runtime.assetLibrary.summary(manifest);
  });

  add('listObjects', meta('列出当前世界中的对象及其位置和能力。', ['world.read']), () => runtime.listObjects());
  add('spawnAsset', { ...meta('实例化一个已注册资产。', ['world.write'], ['assetId', 'position'], { assetId: string, position: vec3, instanceId: string }), mutates: true }, (a) => runtime.spawn(a.assetId, { position: a.position, id: a.instanceId }));
  add('moveObject', { ...meta('移动对象到世界坐标。', ['world.write'], ['id', 'position'], { id: string, position: vec3 }), mutates: true }, (a) => runtime.interactions.move(a.id, a.position));
  add('pickup', { ...meta('低层 Human/scene pickup 原语：对象跟随 Human Camera；具身 Agent 不应调用它，应使用 approachAndPickup。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => runtime.interactions.pickup(a.id));
  add('drop', { ...meta('低层 Human/scene drop 原语；具身 Agent 应使用 dropHeld。', ['world.write'], [], { id: string }), mutates: true }, (a) => runtime.interactions.drop(a.id));
  add('place', { ...meta('低层 Human/scene deterministic place 原语：直接移动对象到支撑面；具身 Agent 持有物体时应使用 approachAndPlace。', ['world.write'], ['id', 'targetId'], { id: string, targetId: string, surfaceId: string, clearance: { type: 'number', minimum: 0 } }), mutates: true }, (a) => runtime.interactions.place(a.id, a.targetId, { surfaceId: a.surfaceId, clearance: a.clearance }));
  add('open', { ...meta('打开可开合对象；多部件对象可指定 partName。', ['world.write'], ['id'], { id: string, partName: string }), mutates: true }, (a) => runtime.interactions.setArticulationAction(a.id, 'open', { partName: a.partName }));
  add('close', { ...meta('关闭可开合对象；多部件对象可指定 partName。', ['world.write'], ['id'], { id: string, partName: string }), mutates: true }, (a) => runtime.interactions.setArticulationAction(a.id, 'close', { partName: a.partName }));
  add('duplicateObject', { ...meta('复制对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => runtime.duplicate(a.id));
  add('removeObject', { ...meta('删除对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => runtime.remove(a.id));

  add('getBounds', meta('获取对象的世界空间包围盒。', ['spatial.read'], ['id'], { id: string }), (a) => runtime.spatial.getBounds(a.id));
  add('findNearby', meta('查询对象附近的其他对象。', ['spatial.read'], ['id'], { id: string, radius: { type: 'number', minimum: 0 } }), (a) => runtime.spatial.findNearby(a.id, a.radius ?? 2));
  add('raycast', meta('向场景发射射线并返回命中对象。', ['spatial.read'], ['origin', 'direction'], { origin: vec3, direction: vec3, maxDistance: { type: 'number', minimum: 0 } }), (a) => runtime.spatial.raycast(a.origin, a.direction, a.maxDistance ?? 100));
  add('isColliding', meta('检查对象是否与其他对象重叠。', ['physics.read'], ['id'], { id: string, ignore: { type: 'array', items: string }, margin: number }), (a) => runtime.spatial.isColliding(a.id, { ignore: a.ignore ?? [], margin: a.margin ?? 0.01 }));
  add('findSupportSurface', meta('查询目标对象的支撑面。', ['spatial.read'], ['targetId'], { targetId: string, surfaceId: string }), (a) => {
    const surface = runtime.spatial.getSupportSurface(a.targetId, a.surfaceId);
    return surface ? { ...surface, center: surface.center.toArray().map((value) => Number(value.toFixed(3))) } : null;
  });
  add('findFreeSpace', meta('在支撑面上寻找无碰撞放置位置。', ['spatial.read'], ['id', 'targetId'], { id: string, targetId: string, surfaceId: string, clearance: { type: 'number', minimum: 0 } }), (a) => runtime.spatial.findFreeSpace(a.id, a.targetId, { surfaceId: a.surfaceId, clearance: a.clearance })?.toArray() ?? null);
  add('canReach', meta('基于 Recast/Detour 与当前 Rapier 动态障碍判断两个世界位置是否可达；与 findFreeSpace 不同，它回答连通性。', ['spatial.read'], ['start', 'end'], { start: vec3, end: vec3, maxSnapDistance: { type: 'number', minimum: 0 } }), (a) => runtime.navigation.canReach(a.start, a.end, { maxSnapDistance: a.maxSnapDistance }));
  add('findPath', meta('基于 Recast/Detour 与当前 Rapier 动态障碍计算路径、路径长度与端点吸附信息。', ['spatial.read'], ['start', 'end'], { start: vec3, end: vec3, maxSnapDistance: { type: 'number', minimum: 0 } }), (a) => runtime.navigation.findPath(a.start, a.end, { maxSnapDistance: a.maxSnapDistance }));
  add('suggestNavigationActions', meta('当当前路径不可达时，基于动态障碍 provenance 做只读反事实诊断；建议是 provisional，执行真实动作后必须重新 findPath。', ['spatial.read'], ['start', 'end'], { start:vec3, end:vec3, maxSnapDistance:{type:'number',minimum:0}, maxCandidates:{type:'integer',minimum:1,maximum:8} }), (a) => runtime.navigation.suggestActions(a.start, a.end, { maxSnapDistance:a.maxSnapDistance, maxCandidates:a.maxCandidates }));
  add('navigateTo', { ...meta('纯坐标导航：让 Agent Body 沿 Detour 路径真实行走到明确世界坐标；Rapier CharacterController 负责碰撞/台阶，直到 arrived 或 blocked 才返回。若目的是靠近对象并 open/close，不要把对象中心当终点，应直接使用 approachAndInteract。', ['world.write', 'spatial.read', 'physics.read'], ['id', 'end'], { id:string, end:vec3, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), mutates:true }, (a) => runtime.locomotion.navigate(a.id, a.end, { speed:a.speed }));
  add('getLocomotionStatus', meta('读取 Agent Body 当前或最近一次 locomotion 状态。', ['world.read', 'physics.read'], ['id'], { id:string }), (a) => runtime.locomotion.status(a.id));
  add('findInteractionPose', meta('只读诊断/预览：按 Runtime 固定 1.5m 交互距离，为 Agent 与目标寻找满足 Detour 可达和 Rapier 视线的交互位；可选 action/partName 时排除 Agent 阻挡 articulation sweep 的位姿。若目标是实际走过去并 open/close，应直接调用 approachAndInteract，不要手工拆链。', ['spatial.read', 'physics.read'], ['actorId','targetId'], { actorId:string, targetId:string, action:{type:'string',enum:['open','close']}, partName:string }), (a) => runtime.interactions.findInteractionPose(a.actorId, a.targetId, { action:a.action, partName:a.partName }));
  add('approachAndInteract', { ...meta('具身 open/close 的首选单一工具：内部按 Runtime 固定 1.5m 交互距离完成 pose 搜索、navigateTo、到达后的物理视线/action-sweep 二次验证，再请求 motor target；不要预先手工调用 findInteractionPose 或 navigateTo。返回 interaction-requested，不冒充关节已完全 settled。整个任务是一个 mutation。', ['world.write','spatial.read','physics.read'], ['actorId','targetId','action'], { actorId:string, targetId:string, action:{type:'string',enum:['open','close']}, partName:string, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), mutates:true }, (a) => runtime.interactions.approachAndInteract(a.actorId, a.targetId, a.action, { partName:a.partName, speed:a.speed }));
  add('approachAndPickup', { ...meta('具身 pickup：Agent 先走到固定 1.5m 交互位并复核 Rapier LOS，再对对象到 hold anchor 做 shape-sweep；成功后记录 heldBy 并以 kinematic anchor 携带。不是 grasp force verification。', ['world.write','spatial.read','physics.read'], ['actorId','targetId'], { actorId:string, targetId:string, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), mutates:true }, (a) => runtime.interactions.approachAndPickup(a.actorId,a.targetId,{speed:a.speed}));
  add('approachAndPlace', { ...meta('具身 place 的首选单一工具：被放置物由 actor 当前 held ownership 自动推导，不要传 held object id。supportId 是接收物体的支撑对象 ID（例如 table_01）；surfaceId 只是该支撑对象 Manifest 中可选的 surface 名（例如 top），绝不是对象 ID。内部完成 carry-aware approach、三段 Rapier shape-cast release、Dynamic settle 与 ON/SUPPORTS post-condition。只有 status=placed 且 supportVerified=true 才表示最终放置成功。', ['world.write','spatial.read','physics.read'], ['actorId','supportId'], { actorId:{type:'string',description:'持有物体的 Agent ID，例如 agent_01'}, supportId:{type:'string',description:'接收放置物的支撑对象 ID，例如 table_01；不要填 cup_01'}, surfaceId:{type:'string',description:'可选 surface 名，例如 top；不要填对象 ID'}, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), mutates:true }, (a) => runtime.interactions.approachAndPlace(a.actorId,a.supportId,{surfaceId:a.surfaceId,speed:a.speed}));
  add('dropHeld', { ...meta('释放 Agent 当前 kinematic-anchor held object，恢复其原始 Physics body type。', ['world.write','physics.read'], ['actorId'], { actorId:string }), mutates:true }, (a) => runtime.interactions.dropHeld(a.actorId));
  add('getCarryStatus', meta('读取 Agent 当前 held-object ownership；held 只表示 kinematic-anchor attachment，不等于 graspVerified。', ['world.read','physics.read'], ['actorId'], { actorId:string }), (a) => runtime.interactions.carryStatus(a.actorId));
  add('getNavigationStatus', meta('读取 NavMesh 派生状态、构建版本与 Agent 导航配置。', ['spatial.read']), () => runtime.navigation.status());
  add('listRelations', meta('查询 ON、NEAR、INSIDE 等语义空间关系。', ['spatial.read'], [], { subject: string, predicate: string, object: string }), (a) => { runtime.sceneGraph.update(); return runtime.sceneGraph.list(a); });
  add('describeObjectRelations', meta('查询一个对象的全部语义空间关系。', ['spatial.read'], ['id'], { id: string }), (a) => { runtime.sceneGraph.update(); return runtime.sceneGraph.describe(a.id); });

  add('validateWorld', meta('执行确定性的几何、物理与关系校验。', ['world.read', 'physics.read']), () => runtime.validator.run());
  add('repairWorld', { ...meta('修复硬错误，并拒绝使结果更差的修复。', ['world.write', 'physics.read'], [], { report: { type: 'object' }, maxRepairs: { type: 'integer' } }), mutates: true }, (a) => runtime.repair.repair(a.report || runtime.validator.run(), { maxRepairs: a.maxRepairs ?? 20 }));
  add('getTrace', meta('读取近期引擎审计事件。', ['world.read'], [], { type: string, actor: string, sinceSeq: { type: 'integer' }, limit: { type: 'integer' } }), (a) => runtime.trace.list(a));
  add('verifyTrace', meta('验证审计事件链的一致性。', ['world.read']), () => runtime.trace.verify());

  add('executeBatch', { ...meta('把多项修改作为一个原子批次执行；任一失败则回滚。', ['world.write'], ['calls'], { calls: { type: 'array', items: { type: 'object' } } }), mutates: true }, async (a, { context }) => {
    const before = runtime.snapshot();
    const results = [];
    for (const call of a.calls) {
      const result = await registry.invoke(call.name, call.args || {}, { ...context, skipHistory: true });
      results.push({ name: call.name, ...result });
      if (!result.success) {
        await runtime.restore(before);
        return { committed: false, rolledBack: true, results };
      }
    }
    runtime.sceneGraph.changed();
    return { committed: true, rolledBack: false, results };
  });

  add('runWorldPipeline', { ...meta('执行资产解析、实例化、关系应用、校验、修复和最终序列化流水线。', ['world.write', 'asset.read', 'asset.write', 'physics.read'], ['plan'], { plan: { type: 'object' }, stages: { type: 'array', items: string } }), mutates: true }, (a) => runtime.worldPipeline.run(a.plan, { stages: a.stages }));
  return registry;
}
