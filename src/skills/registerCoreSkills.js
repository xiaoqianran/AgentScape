import { EmbodiedGenAdapter } from '../adapters/EmbodiedGenAdapter.js';

const string = { type: 'string' };
const number = { type: 'number' };
const vec3 = { type: 'array', items: number, minItems: 3, maxItems: 3 };
const meta = (description, permissions, required = [], properties = {}) => ({ description, permissions, required, properties });

export function registerCoreSkills(registry, runtime) {
  const add = (name, options, handler) => registry.register({ name, ...options, handler });

  add('compileAsset', {
    ...meta('把 GLB 编译为可运行的 Agent 资产。', ['asset.write'], [], { url: string, sourceName: string, assetId: string, label: string }),
    validate: (input) => input?.url || input?.bytes ? { ok: true } : { ok: false, message: 'url or bytes required' }
  }, async (input) => {
    const compiler = await runtime.getAssetCompiler();
    const result = await compiler.compile(input);
    runtime.assets.registerManifest(result.manifest);
    runtime.events.emit('asset.compiled', { assetId: result.manifest.id, report: result });
    return result;
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
  add('pickup', { ...meta('拿起可拾取对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => runtime.interactions.pickup(a.id));
  add('drop', { ...meta('放下当前持有对象。', ['world.write'], [], { id: string }), mutates: true }, (a) => runtime.interactions.drop(a.id));
  add('place', { ...meta('使用空间检测把对象放到支撑面。', ['world.write'], ['id', 'targetId'], { id: string, targetId: string, surfaceId: string, clearance: { type: 'number', minimum: 0 } }), mutates: true }, (a) => runtime.interactions.place(a.id, a.targetId, { surfaceId: a.surfaceId, clearance: a.clearance }));
  add('open', { ...meta('打开可开合对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => runtime.interactions.setDoor(a.id, true));
  add('close', { ...meta('关闭可开合对象。', ['world.write'], ['id'], { id: string }), mutates: true }, (a) => runtime.interactions.setDoor(a.id, false));
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
