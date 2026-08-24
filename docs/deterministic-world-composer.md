# Deterministic World Composer

AgentScape 1.33 把 1.32 的 Generated World Admission 往前推进一层：自然语言 Agent 可以产出受约束的 WorldSpec，而资产的世界坐标与默认 NEAR 间距不再由 LLM 猜。

核心原则：

```text
LLM proposes intent / identity / relations
Runtime owns geometry / placement / admission
```

## 1. Strong WorldSpec Tool Schema

`runWorldPipeline.plan` 不再只是 `{type:'object'}`。

Agent 看到的 schema 明确区分：

```text
id      = 新世界里的 instance id
assetId = 已注册 catalog asset id
```

并明确：

```text
position
= optional exact constraint
= 用户没要求坐标时应省略
```

`NEAR.distance` 同样可省略；省略表示让 Runtime 根据 collider footprint 推导安全中心距。

## 1.1 Runtime 也拒绝 Schema 外字段

Tool schema 只是第一层约束。`normalizeWorldSpec()` 本身还会 deterministic reject top-level / generation / asset / relation 的未知字段；例如顶层 `type:"world"` 不会被静默丢弃。Strict live probe 会真实调用同一个 normalizer，因此 Gateway 是否完整执行 JSON Schema validation 都不会成为 Runtime 信任前提。

## 2. Prompt → WorldSpec 仍由现有 ToolCallingAgent 完成

1.33 没有新增第二个 Planner class。

现有 `ToolCallingAgent` 负责：

```text
prompt
→ searchAssets
→ reuse/generate intent
→ WorldSpec
→ runWorldPipeline
```

Planner 只提交 specification；它不拥有最终 world truth。

## 3. Search / Reuse First

Agent contract 继续要求：

```text
searchAssets first
→ reuse when suitable
→ generate only for unresolved requests
```

Strict live probe 要求 table / cabinet / cup 都先 search，再调用一次 `runWorldPipeline`；禁止 `generateAsset / importEmbodiedGenAsset / spawnAsset` 绕过 canonical pipeline。

## 4. `WorldComposer`

1.33 新增一个纯计算模块：

```text
src/pipeline/WorldComposer.js
```

它没有 ObjectStore、Physics world 或 Scene state。

输入只来自：

```text
Manifest collider truth
Environment layout bounds
read-only Physics pose query
```

输出是 placement proposal / admission evidence。

## 5. Manifest Footprint

`manifestFootprint()` 从 root colliders 推导：

```text
horizontal conservative radius
minimum local Y
coverage
```

当前覆盖仓库真实 root collider 类型：

```text
box
cylinder
capsule
convexHull
```

如果 root collider 缺失/不支持：

```text
ROOT_COLLIDER_UNAVAILABLE
ROOT_COLLIDER_UNSUPPORTED
```

自动布局 fail closed。

## 6. Articulated Asset Coverage

如果 Manifest 有 executable Part colliders，而 layout 只使用 root collider：

```text
coverage = root-only
layoutAdmission = provisional
reason = ARTICULATED_LAYOUT_ROOT_ONLY
```

不会把静态 root footprint 冒充完整 articulation sweep coverage。

## 7. Environment Pack Layout Contract

三个 curated worlds 现在都暴露：

```text
layout.bounds.min
layout.bounds.max
layout.groundY
layout.margin
```

它只是 composer 搜索区域，不复制 Environment collision geometry。

真实 Environment collider truth 仍在 Rapier。

## 8. Auto Placement

WorldSpec asset 没有 `position` 时：

```text
Manifest footprint
→ deterministic candidate grid
→ batch footprint reservation
→ Rapier pose preflight
→ first valid candidate
```

候选排序固定，因此同一个 WorldSpec + 同一个 world state 得到相同 placement。

## 9. Batch Collision Coverage

同一批尚未 spawn 的 assets 还没有 Rapier body。

Composer 对它们使用 conservative horizontal circles：

```text
radiusA + radiusB + clearance
```

避免两个待实例化对象被分配到重叠位置。

这只是 batch pre-layout；spawn 后仍由 Runtime validation 负责最终 truth。

## 10. `PhysicsSystem.manifestPoseClear`

为了在 spawn 前检查 Environment / 已存在对象，1.33 增加纯查询：

```text
manifestPoseClear(manifest, position)
```

它从 Manifest root collider spec 创建临时 Rapier Shape 并调用：

```text
world.intersectionsWithShape(...)
```

没有：

```text
RigidBody creation
ObjectStore mutation
spawn
motor request
```

## 11. Environment / Existing-world Preflight

Auto placement 因此能避开：

```text
Environment fixed colliders
existing Runtime objects
```

专项测试用真实 Rapier floor + obstacle 验证：

```text
blocked pose → clear=false
free pose    → clear=true
entries size unchanged
```

## 12. Exact Position 仍受验证

如果用户明确给了：

```text
position:[x,y,z]
```

Runtime 不会自动悄悄改坐标。

该 exact pose 若：

```text
outside layout bounds
batch-overlap
Rapier blocked
```

则 layout rejected。

## 13. Ground Placement

自动 Y 不是固定 `0`。

Runtime 使用：

```text
groundY - manifestFootprint.minY + epsilon
```

因此不同 collider local translation / height 都能把最低点放在当前 world ground 上方。

## 14. `compose_layout` Canonical Stage

Pipeline 现在是：

```text
normalize_spec
resolve_assets
asset_admission
compose_layout
instantiate
apply_relations
validate
repair
finalize
```

如果 layout rejected：

```text
instantiate = no-op
```

不会先生成错误位置再寄希望于后续修复。

## 15. Runtime-derived NEAR

`NEAR` 不再要求 LLM 发明米数。

若没有显式 distance：

```text
safe distance
= subject footprint radius
+ target footprint radius
+ runtime clearance
```

当前 clearance 为 0.35 world units。

## 16. NEAR Direction Search

Runtime 以 target 为中心按固定顺序检查：

```text
+X
-X
+Z
-Z
```

每个候选都用 `manifestPoseClear()` 检查当前 live world。

第一条 clear candidate 被采用。

## 17. User Distance Too Small

如果用户明确指定 NEAR distance，但小于两个 collider footprint 的安全中心距：

```text
NEAR_DISTANCE_TOO_SMALL
```

Runtime 拒绝，而不是偷偷扩大用户约束。

## 18. Relation Admission

`apply_relations` 现在输出：

```text
relationAdmission:
  ready | rejected
  applied[]
  issues[]
```

`NEAR` 找不到安全方向时：

```text
NEAR_NO_CLEAR_POSE
→ relationAdmission rejected
→ worldAdmission rejected
```

`runWorldPipeline` skill 最终仍会 restore 调用前 snapshot。

## 19. ON 仍复用 Existing Placement Runtime

`ON` 没有另写 composer surface solver。

它继续调用：

```text
InteractionSystem.place
→ SpatialSystem.findFreeSpace
→ Physics setPosition
```

所以支撑面 truth 没有复制。

## 20. Strict Live Planner Probe

1.33 新增 `generated-world` live probe。

任务：

```text
创建 table + chair + cup 工作区
cup ON table
chair NEAR table
```

要求：

```text
searchAssets(table/chair/cup)
→ runWorldPipeline exactly once
→ no positions in WorldSpec
→ no low-level generation/spawn bypass
→ correct relation direction
→ world-ready
```

Nemotron 与 Muse 均通过。

Nemotron 使用：

```text
type → AssetLibrary reuse resolve
instance ids = table / chair / cup
```

Muse 使用：

```text
assetId = table / chair / cup
instance ids = table_01 / chair_01 / cup_01
```

两种都属于合法 WorldSpec。

## 21. Agent 不拥有最终坐标

即使模型 final 文本描述 placement，真正可信的是：

```text
runWorldPipeline tool result
→ layoutAdmission
→ worldAdmission
```

模型生成的文字不是 placement verification。

## 22. 当前 Claim

AgentScape 现在可以说：

> 自然语言任务可以由现有 ToolCallingAgent 在 search/reuse-first 约束下转成强类型 WorldSpec；当用户没有约束坐标时，Runtime 会根据 Manifest root collider footprint、Environment layout bounds、同批资产 conservative footprint 与 live Rapier world collision query 确定性地选择 spawn pose。NEAR 关系可省略数值距离，由 Runtime 根据两侧 collider footprint 推导并做方向 preflight。所有结果仍进入 1.32 canonical asset/layout/relation/validation/world admission。

不能说：

> 1.33 已经完成 room synthesis、全局优化布局、动态家具 rearrangement search 或自动 regenerate loop。

## 23. 下一阶段

下一阶段优先：

```text
validation/rejection findings
→ bounded repair / regenerate proposal
→ only missing/rejected assets or failed constraints
→ retry canonical pipeline
→ bounded attempts
```

仍然保持：

```text
Generator proposes
Runtime validates
```


## 24. 1.34：Composer Rejection 不靠原样重跑解决

1.34 的 bounded retry 不会自动修改 position、NEAR 或 relation，也不会对 `WORLD_POSE_BLOCKED / NEAR_NO_CLEAR_POSE` 原样重试。只有 upstream missing asset 可以自动开启 generation。详见 [`bounded-world-regeneration.md`](./bounded-world-regeneration.md)。
