# V2-PR-14：多物体任务与失败恢复

本阶段扩展现有 `ToolCallingAgent` 循环。模型根据每轮 Scene 观察提出目标、选择下一步；Runtime 验证动作和最终目标。ObjectStore、SceneGraph、Physics 和环境契约仍是世界状态来源，没有新增世界副本或按模型名称编写整理脚本。

## 执行流程

1. 从 `context.scene` 发现物体 ID、空间关系、可操作能力与所选 Agent。
2. 调用 `planSceneTask` 声明 1–32 个结果条件。支持现有 `state-equals`、`relation-exists` 验证；可声明无环目标依赖。
3. 调用 `interactScene({goalId, interaction})`。它使用现有 `scene.interact()` Job、碰撞和导航检查，并等待动作验证。
4. 每次动作后重新观察世界和验证目标，再选择下一步。一次响应中的后续动作被原有执行屏障拦截，防止复用过时的动作批次。
5. 最终答复前重新验证全部目标。模型文字不能覆盖未满足条件、未解决的动作失败或世界验收失败。

目标声明在单次任务中不可改写。`relation-exists` 可用 `objectAnyOf` 指定多个经观察且符合用户意图的等价支撑物，例如允许杯子放在两张桌子的任意一张；它与 `object` 互斥。不允许失败后缩小目标范围或把期望状态改成当前状态来制造成功。

失败后，模型可根据证据更换路线、操作或目标允许的支撑物。同一个目标已通过实时验证时，才清除其关联的历史失败。相同动作在场景未发生实质变化时默认最多失败两次；Studio 的任务规划轮数上限为 32。取消会传到 Scene Job、持物交互、导航和环境动作，保留已发生的世界变化。

## Agent 选择与环境接近

`scene.actors()` 每次读取当前 ObjectStore。仅有一个 Agent 时自动使用它；多个 Agent 时需通过检查器或任务面板明确选择，两个界面共享 `scene.selectActor(id)`。任务开始时固定执行者，运行期间界面禁用切换。该选择是界面偏好，不是额外世界状态，也不会修改物体。

环境契约的 Scene 交互会搜索可导航、可达且无射线遮挡的接近位置，使用现有 locomotion 移动，抵达后重新检查契约与前置条件。失败返回 `NO_APPROACH_POSE`、`APPROACH_FAILED` 等原因。`canApproach` 只表示允许尝试接近，不代表当前可执行或保证路径成功；`available: null` 仍表示未检查。

环境动作后使导航缓存失效。`device-state`、`text-state`、`animated-transform` 的验证仍与真实物理关节验证区分，`physicsVerified` 保持 false。通用目标验证不绕过文字契约的 Agent 阅读权限。

## SDK 与 MCP

Scene API 保持原有观察、交互、Job 和验证接口。SDK 补充 Agent 选择及 `canApproach` 类型。MCP 继续使用 `scene_observe`、`scene_interact`、`scene_job`、`scene_cancel`、`scene_verify`；验证条件支持原生环境 ID 和 `objectAnyOf`，没有为整理任务或每一种动作添加 MCP 工具。外部 AI 可以自行循环这些接口。

## 验证范围

`tests/integration/autonomous-scene-tasks.test.js` 使用生产 Runtime、导航和物理模拟，以及确定性的模型协议夹具，覆盖：

- 两组不同 ID 和镜像布局；两个杯子逐个整理，遇到被固定碰撞体占据的桌面后改放另一张允许的桌子。
- 原生环境契约的真实接近、遮挡拒绝和接近中取消。
- 多 Agent 显式选择；目标依赖与环路拒绝；不可改写目标；相同失败重试上限。
- 模型响应等待期间环境变化后，拒绝使用旧证据宣称完成。

HTTP MCP 测试覆盖同一验证契约；浏览器回归覆盖检查器、任务面板和发送给模型的执行者一致性。

这些测试验证规划循环与真实执行的连接，不等同于在线大模型对任意“整理房间”意图的理解质量。目标含义仍由配置的模型解释；不明确的归类规则、缺失的容器能力或无法到达的位置应报告未完成范围。没有接入多 Agent 协作调度、机器人手部控制或跨会话任务持久化。
