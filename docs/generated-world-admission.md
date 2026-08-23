# Generated World Admission

AgentScape 1.32 把原本分散存在的 Asset Generator、`EmbodiedGenAdapter`、World Pipeline、Validator / Repair 串成第一条真正的 generated-world admission 主链。

目标不是“让 LLM 随便生成然后 spawn”，而是：

```text
WorldSpec
→ resolve / generate
→ provider adapter
→ asset admission
→ instantiate
→ relations
→ validate / repair
→ world admission
```

## 1. `EmbodiedGenAdapter` 从孤立桥接器进入主干

以前 `EmbodiedGenAdapter.toManifest(...)` 可以手工调用，但默认 `HttpAssetGenerator` 要求后端直接返回 `{ manifest }`。

1.32 后 Generator Gateway 可以返回：

```text
{ manifest }
```

或 raw provider payload：

```text
{
  provider: "embodiedgen",
  asset: {...}
}
```

`AssetLibrary.generate()` 会把后者交给 `EmbodiedGenAdapter`，再经过 `validateAssetManifest()` 与 `AssetManager.registerManifest()`。

## 2. Adapter 结果不是 Verified Asset

EmbodiedGen raw payload 目前只能可靠给出 provider semantics、尺寸、质量参数和浏览器可达 GLB。

Adapter 使用 conservative box collider fallback，所以 Manifest 明确记录：

```text
provenance.admission.status = provisional
reasons = [
  FALLBACK_BOX_COLLIDER,
  UNVERIFIED_PROVIDER_SEMANTICS
]
```

Provider 的 `open / close` affordance 仍只留在 provenance，不会因为上游说“能开”就虚构 Runtime articulation。

## 3. 单一 `assetAdmission()`

1.32 新增一个很小的资产准入判断函数，供 AssetLibrary、WorldPipeline 和 Skills 共用。

优先级：

```text
explicit provenance.admission
→ compiler.quality.status
→ generated external manifest defaults provisional
→ repo/trusted existing asset defaults ready
```

Compiler `rejected` 的 generated manifest 不注册、不实例化。

## 4. 外部 schema-valid 不等于 ready

外部 Generator 即使直接返回一个通过 Schema 的 Manifest，也不会仅因 JSON 格式正确而变成 ready。

没有 Compiler ready evidence 时：

```text
UNVERIFIED_GENERATOR_MANIFEST
→ provisional
```

这避免把“格式验证”冒充“运行时验证”。

## 5. `WorldSpec`

1.32 增加纯函数 `normalizeWorldSpec()`，先把松散 world intent 规范化，再进入 mutation pipeline。

当前 v1 只承认：

```text
name / description
generation.provider
generation.generate
assets[]
relations[]: ON | NEAR
```

Asset request 可以提供：

```text
assetId
query
prompt
type
instance id
position
generate
provider
```

缺省值由 normalizer 一次性确定。

## 6. Deterministic Reject Before Mutation

WorldSpec 在进入 Runtime mutation 前拒绝：

```text
非法 position
重复 instance id
空 asset intent
不支持的 relation predicate
非法 distance
```

LLM 不负责解释 malformed spec。

## 7. Canonical World Pipeline

默认阶段现在是：

```text
normalize_spec
resolve_assets
asset_admission
instantiate
apply_relations
validate
repair
finalize
```

内部 `PipelineEngine.run(...,{stages})` 仍可用于测试/开发；Agent skill 不再暴露 stage selection。

所以 LLM 不能只跑：

```text
resolve → instantiate
```

然后跳过 validation / finalize。

## 8. Reuse Before Generation

`resolve_assets` 仍优先：

```text
explicit existing assetId
→ AssetLibrary.search/resolve
→ generator only when generate=true and no reuse match
```

这保持现有“成熟资产优先、生成作为缺失补充”的策略。

## 9. Asset Admission Gate

所有 asset resolution 完成后，统一产生：

```text
ready
provisional
rejected
```

如果存在 unresolved/rejected asset：

```text
assetAdmission = rejected
```

后续 `instantiate / apply_relations / repair` 不得产生部分世界 mutation。

## 10. 不允许半成品 World

专项测试包含：

```text
1 个 repo chair 已存在
+ 1 个 EmbodiedGen asset 无 generator
```

虽然 chair 可解析，整个 asset admission 仍 rejected：

```text
spawn count = 0
```

不会留下“成功一半”的 world。

## 11. World Validation / Repair 仍是现有 Owner

1.32 没有新建 World Validator。

实例化后的世界继续由：

```text
WorldValidator
RepairEngine
SceneGraph
SceneSerializer
```

承担原有职责。

Generated world 不拥有第二套几何/关系真值。

## 12. World Admission

`finalize` 汇总：

```text
asset admission
+ validationAfterRepair
```

得到：

```text
world-ready
world-provisional
world-rejected
```

规则：

```text
hard validation finding / unresolved asset
→ rejected

advisory finding / provisional asset
→ provisional

无上述 evidence
→ ready
```

## 13. Skill Outcome 进入 Agent Contract

`SkillRegistry` 现在理解：

```text
world-ready       → verified
world-provisional → unverified
world-rejected    → failed
```

所以 LLM 不能把 provisional world 的 tool success 包装成“任务已验证完成”。

## 14. Rejected World Rollback

`runWorldPipeline` 在调用前 snapshot scene。

如果最终：

```text
worldAdmission.status = rejected
```

则恢复调用前 scene，并返回：

```text
status = world-rejected
rolledBack = true
```

Asset registry 的已准入资产可以保留，但 rejected world objects 不保留。

## 15. 低层生成 / import 仍保留，但不拥有 World Success

`generateAsset` 和 `importEmbodiedGenAsset` 仍用于资产级工作流。

它们现在返回：

```text
asset-ready
asset-provisional
asset-rejected
```

不是 world admission。

## 16. Provisional `spawnAsset` 也不冒充 Verified

低层编辑仍允许把 provisional asset 放进 scene 观察。

但 `spawnAsset` 对 provisional manifest 返回：

```text
status = asset-provisional
```

Skill outcome 是 unverified。

Compiler rejected asset 则：

```text
asset-rejected
→ 不 spawn
```

因此低层 `generate → spawn` 不能绕过 trust semantics。

## 17. Real Raw EmbodiedGen Pipeline Test

专项测试真实走：

```text
WorldSpec
→ fake raw EmbodiedGen provider response
→ EmbodiedGenAdapter
→ validateAssetManifest
→ AssetManager registration
→ spawn request
→ Validator hard=0
→ worldAdmission=provisional
→ serialized scene artifact
```

Provisional 原因来自真实 Adapter evidence，不是测试硬编码的最终世界状态。

## 18. 当前 Claim

AgentScape 现在可以说：

> EmbodiedGen 风格 raw asset payload 已经可以通过默认 AssetLibrary generation path 进入 AgentScape Manifest；生成资产必须经过统一 asset admission，WorldSpec 再通过不可由 Agent 跳阶段的 canonical pipeline 进入实例化、关系、validation/repair 和 world admission。`ready / provisional / rejected` 已进入 Tool outcome 语义，rejected world 会恢复调用前 scene。

不能说：

> 1.32 已经能从自然语言自动规划完整 WorldSpec、自动设计房间布局或自动决定 regenerate strategy。

这些属于下一阶段。

## 19. 下一阶段

下一步是：

```text
Prompt
→ WorldSpec Planner
→ reuse / generate decisions
→ deterministic World Composer
→ 1.32 admission pipeline
→ validation findings
→ bounded repair / regenerate proposal
```

Planner 只产生 specification/proposal；Runtime validation 继续拥有最终 truth。
