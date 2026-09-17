# Agent

负责模型交互、工具调用循环、提示上下文和恢复策略选择。
入口：ToolCallingAgent.js；模型传输位于 gateway/HttpLLMGateway.js。

产品 Skills、AgentTools 和跨域观察已归 application。Agent 消费传入的 tools/gateway，不反向导入 application。
恢复建议仍包含世界任务语义，但只通过 WorldRuntime 暴露的 `observation` / `recovery` 只读边界读取 Runtime evidence；Agent core 不直接访问 `store`、Physics、Spatial、Interaction、Navigation 或 Locomotion 内部对象。

Agent 对 World 的写操作继续统一经过 Skills → `WorldRuntime.mutate()`；`observation` / `recovery` 不拥有状态，也不提供 mutation bypass。

任务见 tasks.jsonl。验证：npm run test:agent。
