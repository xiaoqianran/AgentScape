/**
 * Physics public API surface.
 *
 * Declarative description of the complete public `PhysicsSystem` surface: one entry per
 * capability, and every entry only forwards to the production `PhysicsSystem` reached
 * through `target.physics`.
 *
 * `target` is duck-typed on purpose — a scenario context, a headless harness context, or any
 * object exposing `physics` plus the few host helpers used below. That keeps this module
 * dependency-free, so the Observatory workbench and the standalone physics harness can share
 * exactly one definition instead of drifting apart.
 *
 * `physicsApiCoverage()` diffs this surface against `PhysicsSystem.prototype` so completeness
 * is machine-checked instead of asserted by hand.
 */

const ROOT_PART = '$root';

const obj = (properties = {}, required = []) => ({ type:'object', properties, required, additionalProperties:false });
const NUM = { type:'number' };
const STR = { type:'string' };
const BOOL = { type:'boolean' };
const NUMS = { type:'array', items:{ type:'number' } };
const ID = { type:'string', description:'对象实例 ID' };
const PART = { type:'string', description:`部件名，默认 ${ROOT_PART}` };
const POSITION = { type:'array', items:{ type:'number' }, minItems:3, maxItems:3, description:'世界坐标 [x, y, z]' };
const ROTATION = { type:'array', items:{ type:'number' }, minItems:4, maxItems:4, description:'四元数 [x, y, z, w]' };
const IDS = { type:'array', items:{ type:'string' }, description:'排除的对象 ID 列表' };
const SHAPE = {
  type:'object',
  description:'归一化形状，如 { kind:"box", halfExtents:[.5,.5,.5] }',
  properties:{ kind:STR, halfExtents:NUMS, radius:NUM, halfHeight:NUM },
  required:['kind']
};

const physicsOf = (ctx) => {
  const physics = ctx?.physics;
  if (!physics) throw new Error('当前场景尚未准备 PhysicsSystem');
  return physics;
};

const recordOf = (ctx, id) => {
  if (!id) throw new Error('缺少对象实例 ID');
  const store = ctx?.store;
  if (!store?.has?.(id)) throw new Error(`未知对象实例：${id}`);
  const record = store.get(id);
  if (!record?.object) throw new Error(`未知对象实例：${id}`);
  return record;
};

const part = (a) => a.partName || ROOT_PART;

const DROPPED_KEYS = new Set(['shapeRef', 'native', 'world', 'handle', 'rawSet', 'body', 'collider']);
const MAX_DEPTH = 8;

/**
 * Tool results must survive being shown in the workbench: strip opaque backend handles,
 * summarize typed arrays and break cycles instead of handing WASM objects to the DOM.
 */
export function toPlainValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null || value === undefined) return null;
  const type = typeof value;
  if (type === 'number' || type === 'string' || type === 'boolean') return value;
  if (type === 'bigint') return Number(value);
  if (type === 'function') return '[function]';
  if (type === 'symbol') return String(value);
  if (ArrayBuffer.isView(value)) return { kind:value.constructor?.name || 'TypedArray', length:value.length };
  if (value instanceof Date) return value.toISOString();
  if (depth > MAX_DEPTH) return '[depth-limit]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => toPlainValue(item, depth + 1, seen));
    if (value instanceof Map) return { kind:'Map', size:value.size, entries:[...value.entries()].map(([key, item]) => [toPlainValue(key, depth + 1, seen), toPlainValue(item, depth + 1, seen)]) };
    if (value instanceof Set) return { kind:'Set', size:value.size, values:[...value].map((item) => toPlainValue(item, depth + 1, seen)) };
    const plain = {};
    for (const [key, item] of Object.entries(value)) {
      if (DROPPED_KEYS.has(key)) continue;
      plain[key] = toPlainValue(item, depth + 1, seen);
    }
    return plain;
  } catch (error) {
    return `[unreadable: ${error?.message || 'unknown'}]`;
  } finally {
    seen.delete(value);
  }
}

export const PHYSICS_API_EXCLUDED = Object.freeze({
  constructor:'Lab host lifecycle',
  init:'Lab host lifecycle (backend + world creation)',
  dispose:'Lab host lifecycle',
  step:'Lab host owns the fixed-step loop via workbench.step',
  writeback:'Runtime internal, invoked by step()',
  updateCollisionEvents:'Runtime internal, invoked by step()',
  resetWorld:'Destroys the observed world; the Lab re-creates the scenario instead',
  addEnvironment:'Host-owned environment topology',
  addFloor:'Host-owned environment topology',
  setEnvironmentPose:'Host-owned environment topology',
  addColliders:'Host-owned environment topology (toolkit uses workbench.spawnBox)',
  unregisterBodyColliders:'Host-owned environment topology',
  addObject:'Host-owned spawn, exposed as workbench.spawnBox / workbench.spawnAsset',
  addTransformState:'Host-owned spawn for render-only transform state',
  removeObject:'Host-owned despawn, exposed as workbench.remove',
  ownerOfBody:'Requires an opaque backend body handle',
  provenanceOfCollider:'Requires an opaque backend collider handle'
});

export const PHYSICS_API_GROUPS = Object.freeze([
  '工作台',
  '位姿',
  '运动与动力学',
  '碰撞',
  '位姿检查与查询',
  '角色控制器',
  '携带与锚点',
  '关节与铰接',
  '反事实证据',
  '诊断'
]);

const definitions = [
  // ---------------------------------------------------------------- 工作台
  {
    name:'workbench.spawnBox', group:'工作台', readOnly:false,
    description:'【工作台】按 Manifest 契约放入一个刚体（box collider），走真实 PhysicsSystem.addObject。',
    parameters:obj({
      id:ID, position:POSITION, halfExtents:{ type:'array', items:{ type:'number' }, minItems:3, maxItems:3 },
      type:{ type:'string', enum:['dynamic','fixed','kinematic'], description:'默认 dynamic' },
      mass:NUM, friction:NUM, accent:BOOL
    }, ['id']),
    invoke:(ctx, a) => {
      const object = ctx.addBox({
        id:a.id, position:a.position || [0,2,0], halfExtents:a.halfExtents || [.5,.5,.5],
        type:a.type || 'dynamic', mass:a.mass ?? 1, friction:a.friction ?? .7, accent:Boolean(a.accent)
      });
      return { id:a.id, body:physicsOf(ctx).debugSnapshot ? 'spawned' : 'spawned', position:physicsOf(ctx).getPosition(a.id), visual:object?.name || a.id };
    }
  },
  {
    name:'workbench.spawnAsset', group:'工作台', readOnly:false,
    description:'【工作台】用生产 AssetLoader 实例化内置资产并注册进 PhysicsSystem。',
    parameters:obj({ id:ID, assetId:STR, position:POSITION }, ['id','assetId']),
    invoke:async (ctx, a) => {
      if (typeof ctx.spawnAssetInstance !== 'function') throw new Error('当前宿主未提供 spawnAssetInstance，无法实例化资产');
      const { manifest } = await ctx.spawnAssetInstance({ id:a.id, assetId:a.assetId, position:a.position || [0,2,0] });
      return { id:a.id, assetId:a.assetId, manifestId:manifest.id, colliders:manifest.physics?.colliders?.length ?? 0, position:physicsOf(ctx).getPosition(a.id) };
    }
  },
  {
    name:'workbench.remove', group:'工作台', readOnly:false,
    description:'【工作台】移除对象（physics.removeObject + 隐藏视觉）。',
    parameters:obj({ id:ID }, ['id']),
    invoke:(ctx, a) => {
      const record = recordOf(ctx, a.id);
      const removed = physicsOf(ctx).removeObject(a.id);
      record.object.visible = false;
      return { id:a.id, removed };
    }
  },
  {
    name:'workbench.step', group:'工作台', readOnly:false,
    description:'【工作台】以固定 1/60 步长推进物理若干帧（不渲染也生效）。',
    parameters:obj({ frames:{ type:'integer', minimum:1, maximum:600 } }, ['frames']),
    invoke:(ctx, a) => {
      const frames = a.frames ?? 1;
      for (let i = 0; i < frames; i += 1) ctx.step(1/60);
      return { frames };
    }
  },
  {
    name:'workbench.manifestSnapshot', group:'工作台', readOnly:true,
    description:'【工作台】导出 Manifest 声明的碰撞体快照（与物理真值对比用）。',
    parameters:obj({}),
    invoke:(ctx) => ctx.manifestSnapshot()
  },
  {
    name:'workbench.truthComparison', group:'工作台', readOnly:true,
    description:'【工作台】对比 Manifest 声明与物理真值，返回缺失/形状不匹配/最大位姿偏差。',
    parameters:obj({}),
    invoke:(ctx) => ctx.truthComparison()
  },

  // ---------------------------------------------------------------- 位姿
  {
    name:'physics.getPosition', group:'位姿', readOnly:true,
    description:'【位姿】读取对象世界坐标。',
    parameters:obj({ id:ID }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).getPosition(a.id)
  },
  {
    name:'physics.getRotation', group:'位姿', readOnly:true,
    description:'【位姿】读取对象世界旋转四元数。',
    parameters:obj({ id:ID }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).getRotation(a.id)
  },
  {
    name:'physics.setPosition', group:'位姿', readOnly:false,
    description:'【位姿】强制设置对象世界坐标（teleport，不走求解器）。',
    parameters:obj({ id:ID, position:POSITION }, ['id','position']),
    invoke:(ctx, a) => physicsOf(ctx).setPosition(a.id, a.position)
  },
  {
    name:'physics.beginTransform', group:'位姿', readOnly:false,
    description:'【位姿】进入变换意图窗口：把刚体临时改为 kinematic，允许场景图接管。',
    parameters:obj({ id:ID }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).beginTransform(a.id) ?? true
  },
  {
    name:'physics.syncTransform', group:'位姿', readOnly:false,
    description:'【位姿】把场景图当前世界变换推入物理（配合 beginTransform/endTransform）。',
    parameters:obj({ id:ID }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).syncTransform(a.id, recordOf(ctx, a.id).object) ?? true
  },
  {
    name:'physics.endTransform', group:'位姿', readOnly:false,
    description:'【位姿】结束变换意图窗口并恢复原刚体类型。',
    parameters:obj({ id:ID }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).endTransform(a.id) ?? true
  },

  // ---------------------------------------------------------------- 运动与动力学
  {
    name:'physics.getMotion', group:'运动与动力学', readOnly:true,
    description:'【运动与动力学】读取线速度/角速度/速度模长/休眠状态。',
    parameters:obj({ id:ID, partName:PART }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).getMotion(a.id, { partName:part(a) })
  },
  {
    name:'physics.setMotion', group:'运动与动力学', readOnly:false,
    description:'【运动与动力学】直接设置线速度/角速度。',
    parameters:obj({ id:ID, linearVelocity:NUMS, angularVelocity:NUMS, sleeping:BOOL, partName:PART }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).setMotion(a.id, {
      ...(a.linearVelocity ? { linearVelocity:a.linearVelocity } : {}),
      ...(a.angularVelocity ? { angularVelocity:a.angularVelocity } : {}),
      ...(a.sleeping === undefined ? {} : { sleeping:Boolean(a.sleeping) })
    }, { partName:part(a) })
  },
  {
    name:'physics.applyImpulse', group:'运动与动力学', readOnly:false,
    description:'【运动与动力学】施加瞬时冲量（立即改变速度）。',
    parameters:obj({ id:ID, impulse:NUMS, point:POSITION, wake:BOOL, partName:PART }, ['id','impulse']),
    invoke:(ctx, a) => physicsOf(ctx).applyImpulse(a.id, a.impulse, { partName:part(a), point:a.point || null, wake:a.wake !== false })
  },
  {
    name:'physics.applyForce', group:'运动与动力学', readOnly:false,
    description:'【运动与动力学】施加持续力，只作用于下一次 simulation step。',
    parameters:obj({ id:ID, force:NUMS, point:POSITION, wake:BOOL, partName:PART }, ['id','force']),
    invoke:(ctx, a) => physicsOf(ctx).applyForce(a.id, a.force, { partName:part(a), point:a.point || null, wake:a.wake !== false })
  },
  {
    name:'physics.applyTorque', group:'运动与动力学', readOnly:false,
    description:'【运动与动力学】施加力矩，只作用于下一次 simulation step。',
    parameters:obj({ id:ID, torque:NUMS, wake:BOOL, partName:PART }, ['id','torque']),
    invoke:(ctx, a) => physicsOf(ctx).applyTorque(a.id, a.torque, { partName:part(a), wake:a.wake !== false })
  },
  {
    name:'physics.setMaterial', group:'运动与动力学', readOnly:false,
    description:'【运动与动力学】设置摩擦与弹性系数。',
    parameters:obj({ id:ID, friction:NUM, restitution:NUM, partName:PART }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).setMaterial(a.id, {
      ...(a.friction === undefined ? {} : { friction:a.friction }),
      ...(a.restitution === undefined ? {} : { restitution:a.restitution })
    }, { partName:part(a) })
  },
  {
    name:'physics.setDynamics', group:'运动与动力学', readOnly:false,
    description:'【运动与动力学】设置线阻尼/角阻尼/重力缩放。',
    parameters:obj({ id:ID, linearDamping:NUM, angularDamping:NUM, gravityScale:NUM, partName:PART }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).setDynamics(a.id, {
      ...(a.linearDamping === undefined ? {} : { linearDamping:a.linearDamping }),
      ...(a.angularDamping === undefined ? {} : { angularDamping:a.angularDamping }),
      ...(a.gravityScale === undefined ? {} : { gravityScale:a.gravityScale })
    }, { partName:part(a) })
  },
  {
    name:'physics.setCcd', group:'运动与动力学', readOnly:false,
    description:'【运动与动力学】开关连续碰撞检测（CCD）。',
    parameters:obj({ id:ID, enabled:BOOL, partName:PART }, ['id','enabled']),
    invoke:(ctx, a) => physicsOf(ctx).setCcd(a.id, Boolean(a.enabled), { partName:part(a) })
  },
  {
    name:'physics.sleep', group:'运动与动力学', readOnly:false,
    description:'【运动与动力学】让刚体进入休眠。',
    parameters:obj({ id:ID, partName:PART }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).sleep(a.id, { partName:part(a) })
  },
  {
    name:'physics.wake', group:'运动与动力学', readOnly:false,
    description:'【运动与动力学】唤醒刚体。',
    parameters:obj({ id:ID, partName:PART }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).wake(a.id, { partName:part(a) })
  },

  // ---------------------------------------------------------------- 碰撞
  {
    name:'physics.setSensor', group:'碰撞', readOnly:false,
    description:'【碰撞】把刚体设为传感器（穿透但不产生碰撞响应）。',
    parameters:obj({ id:ID, enabled:BOOL, partName:PART }, ['id','enabled']),
    invoke:(ctx, a) => physicsOf(ctx).setSensor(a.id, Boolean(a.enabled), { partName:part(a) })
  },
  {
    name:'physics.setCollisionFilter', group:'碰撞', readOnly:false,
    description:'【碰撞】双向许可的碰撞分组：groups（我属于谁）+ collidesWith（我接受谁）。',
    parameters:obj({ id:ID, groups:{ type:'array', items:{ type:'string' } }, collidesWith:{ type:'array', items:{ type:'string' } }, partName:PART }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).setCollisionFilter(a.id, {
      groups:a.groups || [], collidesWith:a.collidesWith || []
    }, { partName:part(a) })
  },
  {
    name:'physics.getCollisionEvents', group:'碰撞', readOnly:true,
    description:'【碰撞】取出累积的 collision-started / ended / sensor-entered / exited 事件。',
    parameters:obj({ clear:BOOL }),
    invoke:(ctx, a) => physicsOf(ctx).getCollisionEvents({ clear:a.clear !== false })
  },
  {
    name:'physics.getNavigationObstacles', group:'碰撞', readOnly:true,
    description:'【碰撞】导出可导航障碍（collider 派生，含 quality 标记）。',
    parameters:obj({}),
    invoke:(ctx) => physicsOf(ctx).getNavigationObstacles()
  },

  // ---------------------------------------------------------------- 位姿检查与查询
  {
    name:'physics.checkBodyPose', group:'位姿检查与查询', readOnly:true,
    description:'【位姿检查与查询】假设把对象移到目标位姿，返回结构化检测结果（checked/clear/reason/blockedBy）。',
    parameters:obj({ id:ID, targetPosition:POSITION, targetRotation:ROTATION, excludeIds:IDS }, ['id','targetPosition']),
    invoke:(ctx, a) => physicsOf(ctx).checkBodyPose(a.id, a.targetPosition, a.targetRotation || null, { excludeIds:a.excludeIds || [] })
  },
  {
    name:'physics.checkBodyMotion', group:'位姿检查与查询', readOnly:true,
    description:'【位姿检查与查询】检查对象沿目标位姿运动（sweep）是否引入新碰撞。',
    parameters:obj({ id:ID, targetPosition:POSITION, targetRotation:ROTATION, excludeIds:IDS }, ['id','targetPosition']),
    invoke:(ctx, a) => physicsOf(ctx).checkBodyMotion(a.id, a.targetPosition, a.targetRotation || null, { excludeIds:a.excludeIds || [] })
  },
  {
    name:'physics.checkManifestPose', group:'位姿检查与查询', readOnly:true,
    description:'【位姿检查与查询】在未实例化的情况下用 Manifest 预检某个位姿是否可放置。',
    parameters:obj({
      manifest:{ type:'object', description:'Manifest（含 physics.colliders）' },
      targetPosition:POSITION, quaternion:ROTATION, excludeIds:IDS
    }, ['manifest','targetPosition']),
    invoke:(ctx, a) => physicsOf(ctx).checkManifestPose(a.manifest, a.targetPosition, { excludeIds:a.excludeIds || [], quaternion:a.quaternion || [0,0,0,1] })
  },
  {
    name:'physics.raycast', group:'位姿检查与查询', readOnly:true,
    description:'【位姿检查与查询】从 origin 向 target 投射射线，返回命中对象/部件/距离/命中点。',
    parameters:obj({ origin:POSITION, target:POSITION, excludeId:ID, excludeIds:IDS }, ['origin','target']),
    invoke:(ctx, a) => physicsOf(ctx).raycast(a.origin, a.target, { excludeId:a.excludeId || null, excludeIds:a.excludeIds || [] })
  },

  // ---------------------------------------------------------------- 角色控制器
  {
    name:'physics.moveCharacter', group:'角色控制器', readOnly:false,
    description:'【角色控制器】用 Kinematic Character Controller 移动角色，返回实际位移与碰撞明细。',
    parameters:obj({ id:ID, desiredTranslation:NUMS, ignoreIds:IDS }, ['id','desiredTranslation']),
    invoke:(ctx, a) => physicsOf(ctx).moveCharacter(a.id, a.desiredTranslation, { ignoreIds:a.ignoreIds || [] })
  },
  {
    name:'physics.cancelCharacterMovement', group:'角色控制器', readOnly:false,
    description:'【角色控制器】取消角色当前移动。',
    parameters:obj({ id:ID }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).cancelCharacterMovement(a.id)
  },
  {
    name:'physics.faceCharacter', group:'角色控制器', readOnly:false,
    description:'【角色控制器】让角色朝向某个方向（仅 kinematic 角色可转向）。',
    parameters:obj({ id:ID, direction:NUMS }, ['id','direction']),
    invoke:(ctx, a) => physicsOf(ctx).faceCharacter(a.id, a.direction)
  },
  {
    name:'physics.setCharacterYaw', group:'角色控制器', readOnly:false,
    description:'【角色控制器】按 yaw 角设置角色朝向。',
    parameters:obj({ id:ID, yaw:NUM }, ['id','yaw']),
    invoke:(ctx, a) => physicsOf(ctx).setCharacterYaw(a.id, a.yaw)
  },

  // ---------------------------------------------------------------- 携带与锚点
  {
    name:'physics.setHeld', group:'携带与锚点', readOnly:false,
    description:'【携带与锚点】声明对象被持有（持有后不再作为导航障碍）。',
    parameters:obj({ id:ID, held:BOOL }, ['id','held']),
    invoke:(ctx, a) => physicsOf(ctx).setHeld(a.id, Boolean(a.held))
  },
  {
    name:'physics.setHeldTarget', group:'携带与锚点', readOnly:false,
    description:'【携带与锚点】设置持有目标点与可选旋转。',
    parameters:obj({ id:ID, target:POSITION, rotation:ROTATION }, ['id','target']),
    invoke:(ctx, a) => physicsOf(ctx).setHeldTarget(a.id, a.target, a.rotation || null)
  },
  {
    name:'physics.setHeldPose', group:'携带与锚点', readOnly:false,
    description:'【携带与锚点】直接设置被持有对象的位姿。',
    parameters:obj({ id:ID, position:POSITION, rotation:ROTATION }, ['id','position']),
    invoke:(ctx, a) => physicsOf(ctx).setHeldPose(a.id, a.position, a.rotation || null)
  },
  {
    name:'physics.anchorPose', group:'携带与锚点', readOnly:false,
    description:'【携带与锚点】读取/推进对象的锚点姿态（next=true 时推进到下一锚点）。',
    parameters:obj({ id:ID, anchor:STR, next:BOOL }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).anchorPose(a.id, a.anchor, { next:Boolean(a.next) })
  },

  // ---------------------------------------------------------------- 关节与铰接
  {
    name:'physics.setCharacterControllerOptions', group:'角色控制器', readOnly:false,
    description:'【角色控制器】重建 KCC 并设置 offset / autostep / snapToGround / 坡度限制；重置传 reset=true。',
    parameters:obj({
      offset:NUM, autostepHeight:NUM, autostepMinWidth:NUM, snapToGround:NUM,
      maxSlopeClimbAngle:NUM, minSlopeSlideAngle:NUM, reset:BOOL
    }),
    invoke:(ctx, a) => {
      const physics = physicsOf(ctx);
      const { reset, ...options } = a || {};
      physics.setCharacterControllerOptions(reset ? null : options);
      return { applied:reset ? 'backend-defaults' : options, available:Boolean(physics.characterController) };
    }
  },

  {
    name:'physics.getArticulationState', group:'关节与铰接', readOnly:true,
    description:'【关节与铰接】读取关节部件状态：jointType/coordinate/target/error/tolerance/limits。',
    parameters:obj({ id:ID, partName:PART, target:NUM }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).getArticulationState(a.id, a.partName || 'door', { target:a.target ?? null })
  },
  {
    name:'physics.setArticulationTarget', group:'关节与铰接', readOnly:false,
    description:'【关节与铰接】驱动 revolute / prismatic 关节到目标坐标（fixed 不可驱动）。',
    parameters:obj({ id:ID, partName:PART, target:NUM }, ['id','target']),
    invoke:(ctx, a) => physicsOf(ctx).setArticulationTarget(a.id, a.partName || 'door', a.target)
  },
  {
    name:'physics.holdArticulationCurrent', group:'关节与铰接', readOnly:false,
    description:'【关节与铰接】保持关节在当前坐标（冻结）。',
    parameters:obj({ id:ID, partName:PART }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).holdArticulationCurrent(a.id, a.partName || 'door')
  },
  {
    name:'physics.articulationContacts', group:'关节与铰接', readOnly:true,
    description:'【关节与铰接】读取关节部件的接触证据（含 totalImpulse / evidenceKind）。',
    parameters:obj({ id:ID, partName:PART }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).articulationContacts(a.id, a.partName || 'door')
  },
  {
    name:'physics.articulationPenetrations', group:'关节与铰接', readOnly:true,
    description:'【关节与铰接】读取关节部件的穿透深度（可选 refresh 重建场景查询）。',
    parameters:obj({ id:ID, partName:PART, refresh:BOOL }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).articulationPenetrations(a.id, a.partName || 'door', { refresh:Boolean(a.refresh) })
  },
  {
    name:'physics.getPartRestPose', group:'关节与铰接', readOnly:true,
    description:'【关节与铰接】读取部件静止位姿（rest pose，关节坐标的零点参考）。',
    parameters:obj({ id:ID, partName:PART }, ['id']),
    invoke:(ctx, a) => physicsOf(ctx).getPartRestPose(a.id, a.partName || 'door')
  },
  {
    name:'physics.articulationColliderPoses', group:'关节与铰接', readOnly:true,
    description:'【关节与铰接】按给定关节坐标求算部件各 collider 的世界位姿（假设位姿，不改世界）。',
    parameters:obj({ id:ID, partName:PART, coordinate:NUM }, ['id','coordinate']),
    invoke:(ctx, a) => physicsOf(ctx).articulationColliderPoses(a.id, a.partName || 'door', a.coordinate)
  },

  // ---------------------------------------------------------------- 反事实证据
  {
    name:'physics.articulationCounterfactualSampleCount', group:'反事实证据', readOnly:true,
    description:'【反事实证据】为一次关节反事实计算自适应采样点数。',
    parameters:obj({ id:ID, partName:PART, current:NUM, target:NUM, minSamples:{ type:'integer' }, maxSamples:{ type:'integer' } }, ['id','current','target']),
    invoke:(ctx, a) => physicsOf(ctx).articulationCounterfactualSampleCount(
      a.id, a.partName || 'door', a.current, a.target,
      { ...(a.minSamples === undefined ? {} : { minSamples:a.minSamples }), ...(a.maxSamples === undefined ? {} : { maxSamples:a.maxSamples }) }
    )
  },
  {
    name:'physics.articulationPairCounterfactual', group:'反事实证据', readOnly:true,
    description:'【反事实证据】成对形状反事实：假设 blocker 部件换一个动作后，与原始运动轨迹的冲突是否减少。',
    parameters:obj({
      originalId:ID, originalPartName:PART, originalTarget:NUM,
      blockerId:ID, blockerPartName:PART, blockerTarget:NUM,
      originalSamples:{ type:'integer' }, blockerSamples:{ type:'integer' }
    }, ['originalId','originalTarget','blockerId','blockerTarget']),
    invoke:(ctx, a) => {
      const samples = (a.originalSamples || a.blockerSamples)
        ? { original:a.originalSamples ?? 12, blocker:a.blockerSamples ?? 12 }
        : null;
      return physicsOf(ctx).articulationPairCounterfactual(
        a.originalId, a.originalPartName || 'door', a.originalTarget,
        a.blockerId, a.blockerPartName || 'door', a.blockerTarget,
        { samples }
      );
    }
  },
  {
    name:'physics.articulationWorldCounterfactual', group:'反事实证据', readOnly:true,
    description:'【反事实证据】世界级形状查询反事实：目标位姿/动作包络是否引入新的第三方碰撞。',
    parameters:obj({ id:ID, partName:PART, target:NUM, excludeObjectIds:IDS, excludeParts:{ type:'array', items:{ type:'string' } }, samples:{ type:'integer' } }, ['id','target']),
    invoke:(ctx, a) => physicsOf(ctx).articulationWorldCounterfactual(a.id, a.partName || 'door', a.target, {
      excludeObjectIds:a.excludeObjectIds || [],
      excludeParts:a.excludeParts || [],
      ...(a.samples === undefined ? {} : { samples:a.samples })
    })
  },
  {
    name:'physics.articulationPairCounterfactualConvergence', group:'反事实证据', readOnly:true,
    description:'【反事实证据】用更密采样重算成对反事实，返回 status=stable/unstable 的收敛证据。',
    parameters:obj({
      originalId:ID, originalPartName:PART, originalTarget:NUM,
      blockerId:ID, blockerPartName:PART, blockerTarget:NUM, multiplier:NUM
    }, ['originalId','originalTarget','blockerId','blockerTarget']),
    invoke:(ctx, a) => physicsOf(ctx).articulationPairCounterfactualConvergence(
      a.originalId, a.originalPartName || 'door', a.originalTarget,
      a.blockerId, a.blockerPartName || 'door', a.blockerTarget,
      { ...(a.multiplier === undefined ? {} : { multiplier:a.multiplier }) }
    )
  },

  // ---------------------------------------------------------------- 诊断
  {
    name:'physics.profile', group:'诊断', readOnly:true,
    description:'【诊断】后端能力矩阵：backend/runtime capabilities、execution modes、qualities、solver 状态。',
    parameters:obj({}),
    invoke:(ctx) => physicsOf(ctx).profile()
  },
  {
    name:'physics.debugSnapshot', group:'诊断', readOnly:true,
    description:'【诊断】Runtime Debug Contract：bodies / colliders / joints / contacts / nativeGeometry / metrics（nativeGeometry 默认关闭以免返回巨量顶点）。',
    parameters:obj({ nativeGeometry:BOOL, contacts:BOOL }),
    invoke:(ctx, a) => physicsOf(ctx).debugSnapshot({ nativeGeometry:a.nativeGeometry === true, contacts:a.contacts !== false })
  },
  {
    name:'physics.runtimeCapabilities', group:'诊断', readOnly:true,
    description:'【诊断】Runtime 层补充能力（transform-state / articulation-pose / counterfactual-query / collision-events）。',
    parameters:obj({}),
    invoke:(ctx) => physicsOf(ctx).runtimeCapabilities()
  },
  {
    name:'physics.runtimeExecutionModes', group:'诊断', readOnly:true,
    description:'【诊断】Runtime 层执行模式。',
    parameters:obj({}),
    invoke:(ctx) => physicsOf(ctx).runtimeExecutionModes()
  },
  {
    name:'physics.hasCapability', group:'诊断', readOnly:true,
    description:'【诊断】查询某项能力是否可用（backend + runtime 合并判断）。',
    parameters:obj({ capability:STR }, ['capability']),
    invoke:(ctx, a) => physicsOf(ctx).hasCapability(a.capability)
  },
  {
    name:'physics.supportsExecutionMode', group:'诊断', readOnly:true,
    description:'【诊断】查询是否支持某种执行模式。',
    parameters:obj({ mode:STR }, ['mode']),
    invoke:(ctx, a) => physicsOf(ctx).supportsExecutionMode(a.mode)
  },
  {
    name:'physics.shapeBoundingRadius', group:'诊断', readOnly:true,
    description:'【诊断】按归一化形状求包围球半径。',
    parameters:obj({ shape:SHAPE }, ['shape']),
    invoke:(ctx, a) => physicsOf(ctx).shapeBoundingRadius(a.shape)
  }
];

export const PHYSICS_API_CATALOG = Object.freeze(definitions.map((entry) => Object.freeze(entry)));

export const PHYSICS_API_TOOLS = Object.freeze(PHYSICS_API_CATALOG.map(({ name, description, parameters }) => Object.freeze({ name, description, parameters })));

export function physicsApiToolDefinitions() {
  return PHYSICS_API_TOOLS;
}

export function physicsApiEntry(name) {
  return PHYSICS_API_CATALOG.find((entry) => entry.name === name) || null;
}

export async function invokePhysicsApi(ctx, name, args = {}) {
  const entry = physicsApiEntry(name);
  if (!entry) throw Object.assign(new Error(`未知物理 API：${name}`), { code:'PHYSICS_API_UNKNOWN' });
  const started = performance.now();
  const elapsed = () => Number((performance.now() - started).toFixed(3));
  try {
    const raw = await entry.invoke(ctx, args || {});
    return {
      tool:name, group:entry.group, readOnly:entry.readOnly === true, elapsedMs:elapsed(),
      result:raw === undefined ? true : toPlainValue(raw)
    };
  } catch (error) {
    return {
      tool:name, group:entry.group, readOnly:entry.readOnly === true, elapsedMs:elapsed(),
      error:{ message:error?.message || String(error), code:error?.code || null }
    };
  }
}

/**
 * Diff the catalog against the production PhysicsSystem surface so "all features"
 * stays machine-checked. `missing` must be empty for the workbench to be complete.
 */
export function physicsApiCoverage(PhysicsSystemClass) {
  const prototype = PhysicsSystemClass?.prototype;
  if (!prototype) throw new TypeError('physicsApiCoverage requires the PhysicsSystem class');
  const publicMethods = Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && !name.startsWith('_') && typeof prototype[name] === 'function')
    .sort();
  const directNames = new Set(PHYSICS_API_CATALOG.map((entry) => entry.exposedMethod || entry.name.split('.').pop()));
  // Host-side tools cover these production methods even though they have no 1:1 tool.
  const hostCovered = new Map([
    ['addObject', ['workbench.spawnBox', 'workbench.spawnAsset']],
    ['removeObject', ['workbench.remove']],
    ['step', ['workbench.step']]
  ]);

  // Each public method lands in exactly one bucket: direct > host > declared exclusion.
  const direct = [];
  const host = [];
  const excluded = [];
  const missing = [];
  for (const name of publicMethods) {
    if (directNames.has(name)) { direct.push(name); continue; }
    if (hostCovered.has(name)) { host.push({ method:name, tools:hostCovered.get(name) }); continue; }
    if (name in PHYSICS_API_EXCLUDED) { excluded.push(name); continue; }
    missing.push(name);
  }
  const exposedNames = new Set(PHYSICS_API_CATALOG.map((entry) => entry.name));
  const unexpected = [...hostCovered.values()].flat().filter((name) => !exposedNames.has(name));
  return {
    publicMethods,
    direct,
    covered:direct,
    hostCovered:host,
    excluded,
    missing,
    unexpected,
    complete:missing.length === 0 && unexpected.length === 0
  };
}
