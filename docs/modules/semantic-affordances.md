# AgentScape 结构与物理驱动的交互能力

本阶段不再通过 `cup`、`vase` 等物体名称决定可执行的 `pickup/drop/place`。名称与节点名仅帮助生成 **待审核语义候选**；能否执行由实际 Asset Manifest、物理结构、Agent 状态与 Runtime 检查决定。

## 可拿取性：物理条件而非类别白名单

- `modules/world/runtime/interaction/CarryCapability.js` 中的 `inferCarryCapability(manifest,{scale})` 不修改物体。它读取真实的 Physics Manifest，并报告 `eligible`、`reason`、`source`、`mode`。
- 对当前单锚点 Agent，保守默认：**动态刚体**、非 Sensor、无锁定的平移自由度、无独立关节部件、有限正质量（缩放后质量不超过 15 kg）、可传输的 box/cylinder/capsule 碰撞体（最多 16 个）、碰撞体包围盒各轴跨度不超过 1.25 m。其它 Agent 形态将来需要独立的容量策略。
- 支持 `physics.carryable: false` 明确否决；声明了旧 `pickup` 的资产也不能越过该否决。普通非准备状态的编译资产不会被自动授予可执行拿取；唯一受限例外是已经通过 `allowProvisional:true` 明确晋升到编辑态、`authoringPromotion.usage==='movable'` 且物理参数/碰撞体满足当前拿取策略的对象。此时只是编辑态下可执行的锚点搬运，不代表资产完整准入通过。
- `InteractionSystem.supports`、`CarryRuntime.assertAgentCarryable`、`ObjectAffordances` 与 `WorldBehaviorCompiler` 均调用同一物理判断。物体可以完全没有 `pickup/drop/place` 动作声明；只要满足上述条件，Runtime 就能动态提供能力。
- 这只是 **kinematic-anchor 持有与路径碰撞验证**，`graspVerified` 始终为 `false`；不得描述为仿真机械手的真实抓握力验证。触达检查、视线、搬运转移、支撑与稳定性仍要在执行时完成。

## 如何使用

```js
const inspection = scene.inspect('unknown_artefact',{actor:'worker'});
const pickup = inspection.capabilities.find(cap => cap.name === 'pickup');
// 新物体无需具有预定义名称，也无需把 pickup 写入 Manifest.actions
if (pickup?.available || pickup?.canApproach) {
  const job = scene.interact({action:'pickup',actor:'worker',target:'unknown_artefact'});
  const completed = await scene.waitJob(job.id);
  // 要检查 completed.result.verification，不等同于真实抓握力验证
}
```

不满足资格的动态资产会在 `inspect().capabilityCandidates` 中给出否决原因，但不会展示可以直接调用的 `pickup` 动作。`scene.observe`、Agent Skills 与 MCP 的 `scene_observe` 共用能力数据，MCP 不需要新增按物体名称区分的专用工具。

对于 `generateAndCompileAsset`，若生成物应被用于拿取，需显式传递 `authoringIntent:{usage:'movable'}`。编译器才会申请动态刚体与相关动作，并继续走质量、碰撞体、Admission 验证；未明确声明时不能根据 `apple`、`cup` 或物体名称推断为可移动实体。

## 新 GLB 的部件与语义候选

`ArticulationCandidatePass` 将节点名、已存在的 URDF/Part Proposal 关节类型结合，提出 `turnPage`、`open/close`、`adjust`、`slide` 等**候选动作**；`AssetCompiler.proposeInteraction()` 可对几何允许的小型物体提出 `pickup/drop/place` 的审核建议。

所有此类操作必须具有 `executable:false`、`physicsVerified:false`，并说明缺失的质量、关节轴、锚点、限位、交互目标和真实运行验证。用户完成资产审阅、提供可靠关节/碰撞体及目标状态后，才能像第一批的 `invoke` 一样执行；书本翻页的页码推进与内容变化应由项目状态机或自定义代码管理，不是凭几何形状自动产生的魔法交互。

## 状态、证据与持久化

真实拿取/放置完成后，Scene Job、Interaction Evidence 与 World Acceptance 使用同一权威状态。保存、重新加载资产不会丢失质量、碰撞体和显式否决字段；能力会根据恢复后物理状态重新计算。不能把历史动作完成记录当作重开后新的实时物理证据。

## 当前明确边界

- 不支持自动抓取带独立关节的整件物体、非当前 Carry 兼容碰撞体、超重超尺寸对象及受物理锁定的对象。
- 动作可以自动派生自已声明物理参数，但不推断未知质量、不把视觉模型自动升级成动态刚体，也不自动执行未审阅的 GLB 关节猜测。
- 尚未提供基于 VLM 的复杂语义推断、双手/多指抓握、通用状态机或把 `turnPage` 自动转成完整书页动画。这些都是独立的后续能力。
