# Agent 任务执行：分阶段的单任务上下文

`ToolCallingAgent` 对外保留现有构造参数、`mode` 与 `run(text, {signal, actor})`。
每次 `run()` 创建独立闭包状态；不会把任务的消息、重试计数、世界修订或未解决操作保存为 Agent 实例的跨任务共享属性。

## 执行职责

| 模块 | 职责 |
| --- | --- |
| `ToolCallingAgent.js` | 公开入口、配置与模式判断 |
| `execution/AgentRunSession.js` | 单次运行的观察 → 规划 → 执行 → 重新规划循环；当前世界和场景观测每轮重新读取 |
| `execution/AgentExecutionRules.js` | 工具调用归一化、语义操作身份、世界修订血缘与辅助恢复身份等纯规则 |
| `execution/AgentToolInvoker.js` | 单次工具调用、可信内部上下文、异常归一化、结果策略及世界验收证据读取 |
| `execution/AgentRunResults.js` | 成功、未完成、无变更与规划预算结束时的证据判定 |

`AgentRunSession` 内有四个显式阶段：`preparePlanningRound()` 提供新鲜 Runtime 观测并请求模型决策；`executeToolBatch()` 强制顺序屏障与恢复规则；`finishModelResponse()` 按实时证据结束；`finishAtLimit()` 在预算耗尽时做最终验证。

## 不变量

1. **不创建影子世界**：真实世界状态继续由 `WorldRuntime` 和 `AgentTools` 提供，代理只维护当次任务的证据账本。
2. **每次世界变更后重新规划**：同轮剩余模型工具调用按原协议标记为未执行，必须读取新的世界观察。
3. **未验证不算成功**：世界验收、Scene Task 的目标验证与 `unresolvedMutations` 同时参与结束判定，不能依靠模型自然语言宣布完成。
4. **失败恢复不替代原目标**：辅助恢复独立计数，同一失败证据纪元内不重复应用已验证恢复，直到原始操作重试验证。
5. **权限与注入上下文不变**：工具仍由原 `AgentTools` 授权；取消信号、世界修订来源和底层提案仅通过可信内部上下文传递。
6. **取消不回滚已完成的物理动作**：运行中的工具会在自身安全边界返回，并保留已提交的世界变化。

## 验收

`tests/agent/tool-calling-agent-sequencing.test.js` 覆盖世界修订、屏障、恢复与预算；
`tests/agent/task-cancellation.test.js` 覆盖取消与安全边界；
`tests/agent/agent-execution-stages.test.js` 覆盖新工具调用和结果策略边界、并发任务状态隔离。

本批次只重排执行控制结构，不修改公共工具协议或世界运行时行为。
