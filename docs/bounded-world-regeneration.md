# Bounded World Regeneration

AgentScape 1.34 在 1.32–1.33 的 Generated World Admission / Deterministic Composer 之上增加**有限次数、机器可解释的生成重试**。

目标不是“失败了让 LLM 多试几次”，而是：

```text
world-rejected
→ classify findings
→ only retriable missing-asset case
→ one Runtime-owned retry
→ canonical pipeline again
→ stop
```

## 1. 为什么不能把所有失败都自动重试

很多 rejection 是 deterministic 的：

```text
WORLD_POSE_BLOCKED
NEAR_DISTANCE_TOO_SMALL
NEAR_NO_CLEAR_POSE
VALIDATION_HARD
```

原样再跑不会产生新事实。

1.34 因此只自动处理一种会因 Generator 介入而改变输入事实的失败：

```text
AssetLibrary search miss
+ request.generate != true
+ generator configured
```

## 2. `WorldRetry`

新增纯函数：

```text
buildWorldRetryPlan(pipeline, {
  generatorConfigured,
  attempt,
  budget
})
```

它只读取 pipeline artifacts / reports，不修改 Runtime。

输出 schema：

```text
agentscape.world-retry.v1
```

包含：

```text
status
attempt / budget
findings[]
actions[]
nextPlan（仅 retry-proposed 时）
```

## 3. Machine-readable Findings

当前 finding stage：

```text
asset
layout
relation
validation
```

Asset miss 示例：

```text
stage      = asset
code       = missing
instanceId = fixture_01
query      = calibration fixture
retriable  = true
```

## 4. 唯一自动动作：Enable Generation

当前自动 retry action 只有：

```text
kind = enable-generation
```

它只把真正 search-missing 的 request：

```text
generate: false / omitted
```

改成：

```text
generate: true
```

不会修改其它 asset 或 world constraint。

## 5. 不自动改用户约束

1.34 明确不自动：

```text
改 explicit position
扩大/缩小 NEAR distance
删除 relation
交换 ON direction
扩大 Environment layout bounds
忽略 collision
忽略 validation hard finding
```

这些情况返回：

```text
status = not-retriable
```

需要新的 WorldSpec proposal，而不是 Runtime 偷改意图。

## 6. Pre-repair Validation Noise 不抢主因

如果 pipeline 在 `asset_admission / layout / relation` 已提前 reject，后面的 validation 只是对未完成世界或调用前世界的观察。

因此只有真正到达 repair 阶段之后仍存在 hard finding，才生成：

```text
stage = validation
code = VALIDATION_HARD
retriable = false
```

上游 asset miss 不会被无关的 validation noise 掩盖。

## 7. 固定 Budget = 2

一次 `runWorldPipeline` Agent mutation 内：

```text
attempt 1
→ rejected
→ retry-proposed
→ restore before-scene
→ attempt 2
→ final result
```

最多两次 canonical pipeline execution。

第二次如果仍 rejected：

```text
status = exhausted
retriable = false
```

不存在 attempt 3。

## 8. 每次 Attempt 都是完整 Canonical Pipeline

Retry 不是从中间 stage 继续。

第二次仍然完整执行：

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

Agent 仍不能选择 stages。

## 9. Retry 前 Restore

第一次 world rejection 后，`runWorldPipeline` 先恢复调用前 scene snapshot，再执行第二次。

所以 retry 不会在 rejected partial world 上叠加对象。

## 10. Asset Registry 与 Scene Ownership

Retry 不创建第二套 Asset/Scene store。

生成成功的 Manifest 仍由：

```text
AssetManager
```

拥有；scene objects 仍由：

```text
ObjectStore / WorldRuntime
```

拥有。

`WorldRetry` 只有瞬态 plan evidence。

## 11. Real Generator E2E

真实专项 E2E 使用：

```text
WorldSpec:
  fixture query
  generate omitted
```

第一次：

```text
AssetLibrary.search
→ missing
→ asset/world rejected
```

Runtime 构造 retry：

```text
enable-generation(fixture_01)
```

`runWorldPipeline` 的 Runtime 编排层会在两次 canonical execution 之间调用 Generator；canonical resolver 本身仍不访问 Provider。生成并发布完成后，Runtime 把已发布 `assetId` 写入 retry revision，再执行第二次完整 canonical pipeline：

```text
Runtime retry orchestration
→ Generator
→ Artifact / Compiler
→ AssetManager.registerManifest
→ retry WorldIR.assetId
→ canonical resolve(existing assetId)
→ compose layout
→ spawn
→ validate
→ world-ready
```

Generator 只调用一次，scene restore 只发生一次。

## 12. Tool Result 保留 Attempt Evidence

成功 result 示例：

```text
status = world-ready
attempts = [
  { attempt:1, admission:rejected, retry:retry-proposed },
  { attempt:2, admission:ready }
]
```

模型可以解释发生过内部 retry，但不需要自己重新发 tool call。

## 13. World-ready 后不需要二次 Validate

`world-ready` 已经意味着 canonical pipeline 的：

```text
validation
repair
final admission
```

全部结束。

Agent prompt 和 strict probe 都要求：

```text
runWorldPipeline → world-ready
→ final response
```

不能再冗余调用 `validateWorld`。

## 14. Agent-level Exact-plan Gate

单次 tool call 内 budget=2 还不够。

如果模型下一 planning round 原样再次提交同一个 rejected WorldSpec，就会绕成：

```text
2 attempts + 2 attempts + 2 attempts ...
```

因此 ToolCallingAgent 还维护当前 run 内的 ephemeral：

```text
attemptedWorldPlans
```

同一 normalized tool-call payload 的 stable identity 第二次出现时：

```text
WORLD_PIPELINE_PLAN_ALREADY_ATTEMPTED
executed = false
replanRequired = true
```

## 15. Plan Identity 不等于 Unresolved Identity

WorldSpec fingerprint 只用于 exact-plan duplicate gate。

原始任务 unresolved identity 仍保持：

```text
runWorldPipeline:{}
```

因此：

```text
plan A rejected
→ plan B genuinely revised
→ plan B world-ready
```

可以清掉同一个“构建世界” unresolved task。

如果把 fingerprint 当 unresolved identity，plan A 会永远残留；1.34 明确避免这种错误。

## 16. Revised WorldSpec 仍允许执行

Exact duplicate 被阻止，不代表禁止修复 proposal。

只要 WorldSpec 实际变化：

```text
plan A != plan B
```

Agent 可以再次执行 canonical pipeline。

全局 planning steps 仍由 ToolCallingAgent 的已有 maxSteps 限制。

## 17. Strict Live Retry Probe

新增：

```bash
npm run agent:probe -- generated-world-retry
```

任务要求：

```text
search table               → hit
search calibration fixture → miss
fixture NEAR table          → distance omitted
runWorldPipeline exactly once
```

禁止模型：

```text
position
 generate=true
 generateAsset
 retired-provider-specific-import
 spawnAsset
 第二次 runWorldPipeline
 world-ready 后 validateWorld
```

Probe 返回真实结构的内部 evidence：

```text
attempt1 rejected
→ retry-proposed
→ attempt2 ready
→ relation mode=runtime-derived
```

Nemotron 与 Muse 均通过。

## 18. 当前 Claim

AgentScape 现在可以说：

> Generated-world canonical pipeline 在唯一安全的 search-miss 场景下，可以由 Runtime 在同一 Agent mutation 内执行一次受限 regeneration retry；只为缺失 asset 开启 generation，先恢复调用前 scene，再完整重跑 pipeline，最多两次。Runtime 返回机器可读 findings/actions/attempt evidence；Agent 不能原样重复同一个 WorldSpec 来绕过 budget。

不能说：

> 1.34 已经能自动修正所有 layout / relation / validation failure，或进行无限自我改写与搜索。

## 19. 下一阶段

下一阶段优先考虑：

```text
non-retriable finding
→ compact repair proposal evidence
→ WorldSpec-level constrained revision
→ Agent proposes revised spec
→ Runtime revalidates
```

仍然保持：

```text
LLM proposes
Runtime validates
bounded execution
```
