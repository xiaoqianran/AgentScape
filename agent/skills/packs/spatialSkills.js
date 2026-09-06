import { composeObservedNearPlacement } from '../../../world/compiler/WorldComposer.js';
import { listObservedEntities, resolveObservedEntity } from '../../../world/runtime/ObservedEntity.js';
import { meta, string, number, vec3 } from '../skillPrimitives.js';

export function registerSpatialSkills(add,runtime) {
  const observedEntity=(id)=>resolveObservedEntity(runtime.sceneGraph,{id}).entity;
  add('getBounds', meta('获取对象的世界空间包围盒。', ['spatial.read'], ['id'], { id: string }), (a) => runtime.spatial.getBounds(a.id));
  add('findNearby', meta('查询对象附近的其他对象。', ['spatial.read'], ['id'], { id: string, radius: { type: 'number', minimum: 0 } }), (a) => runtime.spatial.findNearby(a.id, a.radius ?? 2));
  add('raycast', meta('向场景发射射线并返回命中对象。', ['spatial.read'], ['origin', 'direction'], { origin: vec3, direction: vec3, maxDistance: { type: 'number', minimum: 0 } }), (a) => runtime.spatial.raycast(a.origin, a.direction, a.maxDistance ?? 100));
  add('isColliding', meta('检查对象是否与其他对象重叠。', ['physics.read'], ['id'], { id: string, ignore: { type: 'array', items: string }, margin: number }), (a) => runtime.spatial.isColliding(a.id, { ignore: a.ignore ?? [], margin: a.margin ?? 0.01 }));
  add('findSupportSurface', meta('查询目标对象的支撑面。', ['spatial.read'], ['targetId'], { targetId: string, surfaceId: string }), (a) => {
    const surface = runtime.spatial.getSupportSurface(a.targetId, a.surfaceId);
    return surface ? { ...surface, center: surface.center.toArray().map((value) => Number(value.toFixed(3))) } : null;
  });
  add('findFreeSpace', meta('在支撑面上寻找无碰撞放置位置。', ['spatial.read'], ['id', 'targetId'], { id: string, targetId: string, surfaceId: string, clearance: { type: 'number', minimum: 0 } }), (a) => runtime.spatial.findFreeSpace(a.id, a.targetId, { surfaceId: a.surfaceId, clearance: a.clearance })?.toArray() ?? null);
  add('canReach', meta('基于当前 navigation backend 与 physics backend 提供的动态障碍判断两个世界位置是否可达；与 findFreeSpace 不同，它回答连通性。', ['spatial.read'], ['start', 'end'], { start: vec3, end: vec3, maxSnapDistance: { type: 'number', minimum: 0 } }), (a) => runtime.navigation.canReach(a.start, a.end, { maxSnapDistance: a.maxSnapDistance }));
  add('findPath', meta('基于当前 navigation backend 与 physics backend 提供的动态障碍计算路径、路径长度与端点吸附信息。', ['spatial.read'], ['start', 'end'], { start: vec3, end: vec3, maxSnapDistance: { type: 'number', minimum: 0 } }), (a) => runtime.navigation.findPath(a.start, a.end, { maxSnapDistance: a.maxSnapDistance }));
  add('suggestNavigationActions', meta('当当前路径不可达时，基于动态障碍 provenance 做只读反事实诊断；建议是 provisional，执行真实动作后必须重新 findPath。', ['spatial.read'], ['start', 'end'], { start:vec3, end:vec3, maxSnapDistance:{type:'number',minimum:0}, maxCandidates:{type:'integer',minimum:1,maximum:8} }), (a) => runtime.navigation.suggestActions(a.start, a.end, { maxSnapDistance:a.maxSnapDistance, maxCandidates:a.maxCandidates }));
  add('navigateTo', { ...meta('纯坐标导航：让 Agent Body 沿当前 navigation backend 生成的路径真实行走到明确世界坐标；当前 physics backend 必须提供 character-controller capability 来负责碰撞/台阶，直到 arrived 或 blocked 才返回。若目的是靠近对象并 open/close，不要把对象中心当终点，应直接使用 approachAndInteract。', ['world.write', 'spatial.read', 'physics.read'], ['id', 'end'], { id:string, end:vec3, speed:{type:'number',exclusiveMinimum:0,maximum:8} }), batchable:false, mutates:true }, (a) => runtime.locomotion.navigate(a.id, a.end, { speed:a.speed }));
  add('getLocomotionStatus', meta('读取 Agent Body 当前或最近一次 locomotion 状态。', ['world.read', 'physics.read'], ['id'], { id:string }), (a) => runtime.locomotion.status(a.id));
  add('findInteractionPose', meta('只读诊断/预览：按 Runtime 固定 1.5m 交互距离，为 Agent 与目标寻找满足当前 navigation backend 可达和 physics scene-query 视线的交互位；可选 action/partName 时排除 Agent 阻挡 articulation sweep 的位姿。若目标是实际走过去并 open/close，应直接调用 approachAndInteract，不要手工拆链。', ['spatial.read', 'physics.read'], ['actorId','targetId'], { actorId:string, targetId:string, action:{type:'string',enum:['open','close']}, partName:string }), (a) => runtime.interactions.findInteractionPose(a.actorId, a.targetId, { action:a.action, partName:a.partName }));
  add('getNavigationStatus', meta('读取 NavMesh 派生状态、构建版本与 Agent 导航配置。', ['spatial.read']), () => runtime.navigation.status());
  add('listObservedEntities', meta('列出 Generated World 中仅用于感知/导航的语义实例证据；这些实例不是 ObjectStore 对象，也不代表可抓取、可打开或其他已验证能力。', ['world.read','spatial.read'], [], { label:string }), (a) => {
    const label=typeof a.label==='string' ? a.label.trim().toLocaleLowerCase() : '';
    return listObservedEntities(runtime.sceneGraph,{label});
  });
  add('getObservedEntity', meta('读取一个 Generated World 语义实例的观测证据；返回值仍不是 executable Object。', ['world.read','spatial.read'], ['id'], { id:string }), (a) => observedEntity(a.id));
  add('planAssetNearObservedEntity', meta('为已注册资产规划一个靠近 Generated World 观测实例、且经当前 Physics Environment 碰撞预检通过的位置。这里只规划，不实例化；真正生成对象仍必须调用 spawnAsset。', ['asset.read','world.read','spatial.read'], ['assetId','id'], { assetId:string, id:string, distance:{type:'number',minimum:0}, maxDistance:{type:'number',minimum:0} }), (a) => {
    const observed=observedEntity(a.id);
    if (!observed) return {status:'observed-entity-missing',id:a.id};
    const manifest=runtime.assets.getManifest(a.assetId);
    const result=composeObservedNearPlacement(manifest,observed,{
      layout:runtime.environment?.layout,
      poseClear:(candidate,position)=>runtime.physics.manifestPoseClear(candidate,position),
      distance:a.distance,maxDistance:a.maxDistance
    });
    return result.checked ? {...result,status:'placement-ready',assetId:a.assetId,observedEntityId:observed.id,observationId:observed.observationId} : {...result,status:'placement-rejected',assetId:a.assetId,observedEntityId:observed.id,observationId:observed.observationId};
  });
  add('findObservedEntityApproach', meta('为 Generated World 观测实例寻找 Recast 可达的附近位置。语义中心只是感知证据，可能落在物体几何内；此工具只返回导航 approach，不把观测实例提升为 Runtime Object。', ['world.read','spatial.read'], ['id','start'], { id:string, start:vec3, maxSnapDistance:{type:'number',minimum:0} }), async (a) => {
    const observed=observedEntity(a.id);
    if (!observed) return {status:'observed-entity-missing',id:a.id};
    const center=observed.localization?.kind==='point-scale' ? observed.localization.center : observed.center;
    if (!Array.isArray(center) || center.length!==3 || !center.every(Number.isFinite)) return {status:'approach-unavailable',id:observed.id,reason:'LOCALIZATION_UNAVAILABLE'};
    const scale=Number.isFinite(observed.localization?.scale) ? observed.localization.scale : 0;
    const maxSnapDistance=Number.isFinite(a.maxSnapDistance) ? a.maxSnapDistance : Math.max(.75,Math.min(2,scale+.75));
    const route=await runtime.navigation.findPath(a.start,center,{maxSnapDistance});
    if (!route.reachable) return {status:'approach-unreachable',id:observed.id,observationId:observed.observationId,targetCenter:[...center],maxSnapDistance,route};
    const approach=route.end?.snapped || route.path?.at?.(-1) || null;
    const standoffDistance=Array.isArray(approach) ? Number(Math.hypot(approach[0]-center[0],approach[1]-center[1],approach[2]-center[2]).toFixed(3)) : null;
    return {status:'approach-ready',id:observed.id,observationId:observed.observationId,targetCenter:[...center],approach,maxSnapDistance,standoffDistance,route};
  });
  add('listRelations', meta('查询 ON、NEAR、INSIDE 等语义空间关系。', ['spatial.read'], [], { subject: string, predicate: string, object: string }), (a) => { runtime.sceneGraph.update(); return runtime.sceneGraph.list(a); });
  add('describeObjectRelations', meta('查询一个对象的全部语义空间关系。', ['spatial.read'], ['id'], { id: string }), (a) => { runtime.sceneGraph.update(); return runtime.sceneGraph.describe(a.id); });
}
